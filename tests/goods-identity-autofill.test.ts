import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, applyAction } from '../lib/engine.ts';
import { ECUS_FORM_FIELDS, ecusFormValue } from '../lib/ecus-form.ts';
import { getDeclarationEntry, isDeclarationSourceCurrent, saveDeclarationField } from '../lib/declaration.ts';
import { syncShipmentDeclaration } from '../lib/shipment-autofill.ts';
import type { DocumentType, GoodsLine, ShipmentDocument, WorkspaceState } from '../lib/types.ts';

const actor = { id: 'identity-reviewer', name: 'Synthetic reviewer', email: 'reviewer@example.invalid' };
function fixture() {
  const state = applyAction(createEmptyWorkspace('goods-identity'), { type: 'create_case', title: 'Synthetic goods identity' }, actor);
  const shipment = state.cases[0]; shipment.groupingConfirmed = true;
  return { state, shipment };
}
function addRow(state: WorkspaceState, docId: string, role: DocumentType, row: number, fields: Record<string,string>, page = 1) {
  const shipment = state.cases[0];
  let doc = state.documents.find(doc => doc.id === docId);
  if (!doc) {
    doc = { id:docId,caseId:shipment.id,name:docId+'.txt',type:role,mime:'text/plain',size:1,sha256:docId,active:true,version:1,uploadedAt:'',synthetic:true,extractionPipeline:'kimi',extractionStatus:'extracted',pages:[],aiProcessedPages:[] } satisfies ShipmentDocument;
    state.documents.push(doc); shipment.documentIds.push(docId);
  }
  let sourcePage = doc.pages.find(source => source.page === page);
  if (!sourcePage) { sourcePage={page,text:'',aiReadability:'clear',documentType:role};doc.pages.push(sourcePage);doc.aiProcessedPages!.push(page); }
  const lineId=`${docId}:p${page}:row${row}`;
  for (const [field,value] of Object.entries(fields)) {
    const quote=`Row ${row} ${field}: ${value}`;sourcePage.text += quote+'\n';
    state.candidates.push({id:`${lineId}:${field}`,caseId:shipment.id,documentId:docId,documentVersion:1,page,lineId,field,value,originalText:quote,location:`Page ${page}`,method:'kimi:synthetic',confidence:'high',confidenceScore:96,readability:'clear',normalizations:[]});
  }
  if (role === 'invoice' && docId === 'invoice') shipment.goods.push({id:lineId,description:fields.description??'',quantity:fields.quantity??'',unit:fields.unit??'',unitPrice:fields.unitPrice??'',amount:fields.amount??'',hsCode:fields.hsCode??'',origin:'',dutyRate:'',vatRate:'',reviewed:false,manual:false,sourceDocumentId:docId,sourcePage:page} satisfies GoodsLine);
  return lineId;
}
const value = (state: WorkspaceState, key: string, lineId=state.cases[0].goods[0].id) => ecusFormValue(ECUS_FORM_FIELDS.find(field=>field.key===key)!,state.cases[0].declarationDraft,lineId);
const sync=(state:WorkspaceState)=>syncShipmentDeclaration(state,state.cases[0],actor);
function pair(field='goodsModel') {
  const {state,shipment}=fixture();
  const own=addRow(state,'invoice','invoice',1,{[field]:'MODEL-2000',description:'Complete invoice description MODEL-2000',quantity:'1',unit:'PCS',unitPrice:'100',amount:'100'});
  const other=addRow(state,'origin','certificate_of_origin',1,{[field]:'MODEL-2000',description:'Certificate description differs',quantity:'2',unit:'PCS',unitPrice:'80',amount:'160',hsCode:'870510',origin:'CN',vatRate:'8'});
  return {state,shipment,own,other};
}

test('unique explicit model or product code joins source cells while retaining invoice wording and amounts',()=>{
  for(const field of ['goodsModel','goodsCode']) {
    const {state,shipment,own}=pair(field);const originals=structuredClone(state.candidates);sync(state);assert.deepEqual(state.candidates,originals);
    assert.equal(value(state,'hsCode'),'870510');assert.equal(value(state,'origin'),'CN');assert.equal(value(state,'vatRate'),'8');
    assert.equal(value(state,'description'),'Complete invoice description MODEL-2000');
    for(const key of ['quantity','unitPrice','amount']) assert.equal(value(state,key),key==='quantity'?'1':'100');
    if(field==='goodsModel') assert.equal(value(state,'goodsCode'),'','An explicit model must not become a goods code.');
    const hs=getDeclarationEntry(shipment.declarationDraft,ECUS_FORM_FIELDS.find(field=>field.key==='hsCode')!.fieldId,own)!;
    const quotes=hs.provenance.filter(source=>source.kind==='document').map(source=>source.quote);
    assert.ok(quotes.includes('Row 1 hsCode: 870510'));assert.ok(quotes.includes(`Row 1 ${field}: MODEL-2000`));
    assert.deepEqual(new Set(hs.provenance.filter(source=>source.kind==='document').map(source=>source.documentId)),new Set(['origin','invoice']));
    assert.ok(hs.provenance.every(source=>isDeclarationSourceCurrent(source,{caseId:shipment.id,documents:state.documents,candidates:state.candidates,goods:shipment.goods})));
  }
});

test('mixed-file page roles do not collapse invoice and quality rows, but repeated models within one role never join',()=>{
  const {state}=pair();addRow(state,'invoice','other',1,{goodsModel:'MODEL-2000',description:'Quality certificate'},3);sync(state);assert.equal(value(state,'hsCode'),'870510');
  for(const field of ['goodsModel','goodsCode']) for(const duplicated of ['invoice','origin']) {
    const {state}=pair(field);addRow(state,duplicated,duplicated==='invoice'?'invoice':'certificate_of_origin',2,{[field]:'MODEL-2000',description:'Another distinct row'},2);sync(state);assert.equal(value(state,'hsCode'),'');
  }
});

test('uncertain identities, conflicting product codes and nonmatching exact models cannot transfer tax cells',()=>{
  const mutations: ((state:WorkspaceState)=>void)[]=[
    state=>{state.candidates.find(candidate=>candidate.field==='goodsModel'&&candidate.documentId==='origin')!.confidence='low';},
    state=>{state.candidates.find(candidate=>candidate.field==='goodsModel'&&candidate.documentId==='invoice')!.readability='uncertain';},
    state=>{state.documents.find(doc=>doc.id==='origin')!.pages[0].aiReadability='uncertain';},
    state=>{state.documents.find(doc=>doc.id==='origin')!.aiProcessedPages=[];},
    state=>{const source=state.candidates.find(candidate=>candidate.field==='goodsModel'&&candidate.documentId==='origin')!;source.value='MODEL-2000-A';source.originalText='goodsModel: MODEL-2000-A';state.documents.find(doc=>doc.id==='origin')!.pages[0].text+='\n'+source.originalText;},
    state=>{for(const [docId,code] of [['invoice','SKU-A'],['origin','SKU-B']]){const model=state.candidates.find(candidate=>candidate.documentId===docId&&candidate.field==='goodsModel')!;const quote='goodsCode: '+code;state.documents.find(doc=>doc.id===docId)!.pages[0].text+='\n'+quote;state.candidates.push({...model,id:model.id+'code',field:'goodsCode',value:code,originalText:quote});}},
    state=>{const model=state.candidates.find(candidate=>candidate.documentId==='invoice'&&candidate.field==='goodsModel')!;const quote='goodsCode: SKU-B';state.documents[0].pages[0].text+='\n'+quote;state.candidates.push({...model,id:model.id+'code1',field:'goodsCode',value:'SKU-A',originalText:'goodsCode: SKU-A'},{...model,id:model.id+'code2',field:'goodsCode',value:'SKU-B',originalText:quote});},
  ];
  for(const mutate of mutations){const {state}=pair();mutate(state);sync(state);assert.equal(value(state,'hsCode'),'');assert.equal(value(state,'vatRate'),'');}
});

test('description text alone never supplies an implicit model, and same-authority invoice price conflicts remain unresolved',()=>{
  const {state}=pair();state.candidates=state.candidates.filter(candidate=>candidate.field!=='goodsModel');sync(state);assert.equal(value(state,'hsCode'),'');
  const matched=pair();addRow(matched.state,'invoice2','invoice',1,{goodsModel:'MODEL-2000',description:'Another invoice description',unit:'PCS',unitPrice:'120',amount:'120'});sync(matched.state);
  assert.equal(value(matched.state,'unitPrice'),'');assert.equal(value(matched.state,'amount'),'');
});

test('joined evidence never overwrites human values, and a lost identity link marks its retained review stale',()=>{
  const {state,shipment,own}=pair();sync(state);
  const fieldId=ECUS_FORM_FIELDS.find(field=>field.key==='hsCode')!.fieldId;
  const saved=getDeclarationEntry(shipment.declarationDraft,fieldId,own)!;
  shipment.declarationDraft=saveDeclarationField(shipment.declarationDraft,{type:'save_declaration_field',caseId:shipment.id,fieldId,goodsLineId:own,applicability:'applicable',basis:'Confirmed original and model association',value:{kind:'code',code:'870590'},provenance:saved.provenance,reason:'Reviewer correction.',review:true},{caseId:shipment.id,documents:state.documents,candidates:state.candidates,goods:shipment.goods,actor,at:'2026-10-15T00:00:00Z'});
  sync(state);assert.equal(value(state,'hsCode'),'870590');
  state.candidates.find(candidate=>candidate.field==='goodsModel'&&candidate.documentId==='origin')!.readability='uncertain';sync(state);
  const retained=getDeclarationEntry(shipment.declarationDraft,fieldId,own)!;assert.deepEqual(retained.value,{kind:'code',code:'870590'});assert.ok(retained.review);assert.equal(retained.stale,true);
});

test('long Kimi goods descriptions and their source quotations remain complete',()=>{
  const {state,shipment}=fixture();const description='Complete source specification '.repeat(85);
  const own=addRow(state,'invoice','invoice',1,{description});sync(state);
  assert.equal(value(state,'description'),description);
  const fieldId=ECUS_FORM_FIELDS.find(field=>field.key==='description')!.fieldId;
  assert.equal(getDeclarationEntry(shipment.declarationDraft,fieldId,own)!.provenance[0].kind,'document');
  const proof=getDeclarationEntry(shipment.declarationDraft,fieldId,own)!.provenance[0];
  assert.ok(proof.kind==='document'&&proof.quote===`Row 1 description: ${description}`);
});
