import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction, createEmptyWorkspace, getIssues } from '../lib/engine.ts';
import type { DocumentType, ShipmentDocument, WorkspaceState } from '../lib/types.ts';
const actor={id:'list-reviewer',name:'Synthetic reviewer',email:'reviewer@example.invalid'};
function fixture(){
  const state=applyAction(createEmptyWorkspace('goods-list-comparison'),{type:'create_case',title:'Synthetic goods lists'},actor);
  state.cases[0].groupingConfirmed=true;return state;
}
function row(state:WorkspaceState,documentId:string,role:DocumentType,page:number,index:number,description:string,unit?:string){
  const shipment=state.cases[0];let document=state.documents.find(document=>document.id===documentId);
  if(!document){document={id:documentId,caseId:shipment.id,name:documentId+'.txt',type:role,mime:'text/plain',size:1,sha256:documentId,active:true,version:1,uploadedAt:'',synthetic:true,extractionPipeline:'kimi',extractionStatus:'extracted',aiProcessedPages:[],pages:[]} satisfies ShipmentDocument;state.documents.push(document);shipment.documentIds.push(documentId);}
  let source=document.pages.find(source=>source.page===page);
  if(!source){source={page,text:'',documentType:role,aiReadability:'clear'};document.pages.push(source);document.aiProcessedPages!.push(page);}
  const lineId=`${documentId}:p${page}:row${index}`;
  for(const [field,value] of Object.entries({description,quantity:'1',...(unit?{unit}:{})})){
    const quote=`Row ${index} ${field}: ${value}`;source.text+=quote+'\n';
    state.candidates.push({id:`${lineId}:${field}`,caseId:shipment.id,documentId,documentVersion:1,page,lineId,field,value,originalText:quote,location:`Page ${page}`,method:'kimi:synthetic',confidence:'high',readability:'clear',normalizations:[]});
  }
  if(documentId==='invoice')shipment.goods.push({id:lineId,description,quantity:'1',unit:unit??'',unitPrice:'',amount:'',hsCode:'',origin:'',dutyRate:'',vatRate:'',reviewed:false,manual:false,sourceDocumentId:documentId,sourcePage:page});
}
const listConflict=(state:WorkspaceState)=>getIssues(state,state.cases[0].id).find(issue=>issue.id.endsWith(':goods-description-conflict'));

test('unitless detailed packing components do not conflict with a single commercial goods row',()=>{
  const state=fixture();row(state,'invoice','invoice',1,1,'Complete machine','UNIT');
  for(let index=1;index<=12;index++)row(state,'detailed-packing','packing_list',1,index,`Component ${index}`);
  const before=structuredClone(state);assert.equal(listConflict(state),undefined);assert.equal(state.cases[0].goods.length,1);assert.deepEqual(state,before);
});

test('invoice continuation pages form one list and can match a consolidated packing list',()=>{
  const state=fixture();row(state,'invoice','invoice',1,1,'First product','PCS');row(state,'invoice','invoice',2,1,'Second product','PCS');
  assert.equal(listConflict(state),undefined,'Pages within one invoice are not separate complete lists.');
  row(state,'packing','packing_list',1,1,'First product','PCS');row(state,'packing','packing_list',1,2,'Second product','PCS');
  assert.equal(listConflict(state),undefined);
});

test('comparable separate invoices and packing lists retain real description and count discrepancies',()=>{
  for(const role of ['invoice','packing_list'] as const){
    const state=fixture();row(state,'invoice','invoice',1,1,'First product','PCS');row(state,'invoice','invoice',2,1,'Second product','PCS');
    row(state,'other',role,1,1,'First product','PCS');let conflict=listConflict(state);assert.ok(conflict,role);assert.equal(conflict.candidateIds.length,3);
    row(state,'other',role,1,2,'Different product','PCS');conflict=listConflict(state);assert.ok(conflict,role);assert.equal(conflict.candidateIds.length,4);
  }
});

test('partly missing, unclear or incompatible row units cannot establish list comparability',()=>{
  for(const mode of ['missing','uncertain','different'] as const){
    const state=fixture();row(state,'invoice','invoice',1,1,'Complete machine','UNIT');
    row(state,'packing','packing_list',1,1,'Component A',mode==='different'?'KG':'UNIT');
    row(state,'packing','packing_list',1,2,'Component B',mode==='missing'?undefined:mode==='different'?'KG':'UNIT');
    if(mode==='uncertain')state.candidates.find(candidate=>candidate.id==='packing:p1:row2:unit')!.readability='uncertain';
    assert.equal(listConflict(state),undefined,mode);
  }
});

test('mixed-file roles remain separate and unrelated unitless sources do not hide a real comparable conflict',()=>{
  const state=fixture();row(state,'components','packing_list',1,1,'Unrelated component');
  row(state,'invoice','invoice',1,1,'Original product','PCS');row(state,'invoice','packing_list',2,1,'Different product','PCS');
  const conflict=listConflict(state);assert.ok(conflict);assert.equal(conflict.candidateIds.length,2);
  assert.ok(conflict.candidateIds.every(id=>id.startsWith('invoice:')));
  state.documents.reverse();assert.ok(listConflict(state),'Document order must not decide which lists can be compared.');
});
