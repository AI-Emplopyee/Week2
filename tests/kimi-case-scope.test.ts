import assert from 'node:assert/strict';
import test from 'node:test';
import {applyAction,createEmptyWorkspace} from '../lib/engine.ts';
import type {ShipmentDocument,WorkspaceState} from '../lib/types.ts';
const actor={id:'scope-reviewer',name:'Synthetic reviewer',email:'reviewer@example.invalid'};
function document(state:WorkspaceState,caseId:string,id:string,kimi:boolean):ShipmentDocument {
  const doc:ShipmentDocument={id,caseId,name:id+'.txt',type:'bill_of_lading',mime:'text/plain',size:1,sha256:id,version:1,active:true,uploadedAt:'',synthetic:true,extractionStatus:'extracted',...(kimi?{extractionPipeline:'kimi',aiProcessedPages:[1]}:{}),pages:[{page:1,text:'HBL: SYNTHETIC-MATCH',...(kimi?{aiReadability:'clear',documentType:'bill_of_lading'}:{})}]};
  state.documents.push(doc);state.cases.find(shipment=>shipment.id===caseId)!.documentIds.push(id);return doc;
}
function fixture(){
  let state=applyAction(createEmptyWorkspace('reread-scope'),{type:'create_case',title:'Selected shipment'},actor);
  const selected=state.cases[0].id;state=applyAction(state,{type:'create_case',title:'Unrelated history'},actor);
  const unrelated=state.cases.find(shipment=>shipment.id!==selected)!;unrelated.groupingConfirmed=true;unrelated.groupingConfidence='medium';
  document(state,selected,'selected-source',true);const legacy=document(state,unrelated.id,'legacy-source',false);
  state.candidates.push({id:'legacy-importer',caseId:unrelated.id,documentId:legacy.id,documentVersion:1,page:1,field:'importer',value:'Historical buyer',originalText:'Historical buyer',location:'Legacy source',method:'historical_parser',confidence:'high',normalizations:[]});
  unrelated.fields.importer={value:'Historical buyer',source:'candidate',candidateId:'legacy-importer',reason:'Previously reviewed.',reviewedBy:actor.name,reviewedAt:'2026-01-01T00:00:00Z',stale:false,unverified:true};
  unrelated.goods=[{id:'legacy-row',description:'Historical unreviewed goods',quantity:'1',unit:'PCS',unitPrice:'10',amount:'10',hsCode:'',origin:'',dutyRate:'',vatRate:'',reviewed:false,manual:false,sourceDocumentId:legacy.id,sourcePage:1}];
  unrelated.declarationDraft={schemaVersion:1,fields:[{fieldId:'1.13',applicability:'applicable',basis:'Historical source',value:{kind:'text',text:'Historical buyer'},provenance:[{kind:'document',documentId:legacy.id,documentVersion:1,page:1,quote:'Historical buyer'}],reason:'Prior extracted draft',review:null,stale:false,updatedBy:actor.id,updatedAt:'2026-01-01T00:00:00Z',codeVerification:'unverified',generatedBy:'shipment_extraction'}]};
  return{state,selected,unrelatedId:unrelated.id};
}
function reread(state:WorkspaceState,caseId:string){return applyAction(state,{type:'add_ai_candidates',caseId,documentId:'selected-source',documentVersion:1,model:'synthetic-kimi',pages:[1],pageReadings:[{page:1,documentType:'bill_of_lading',readability:'clear'}],proposals:[{field:'houseBillOfLading',value:'SYNTHETIC-MATCH',quote:'HBL: SYNTHETIC-MATCH',page:1,confidence:'high',readability:'clear'}]},actor);}

test('selected Kimi rereads leave unrelated legacy rows, reviewed fields and draft history unchanged',()=>{
  const {state,selected,unrelatedId}=fixture();const before=structuredClone(state);
  const result=reread(state,selected);
  assert.deepEqual(result.cases.find(shipment=>shipment.id===unrelatedId),before.cases.find(shipment=>shipment.id===unrelatedId));
  assert.deepEqual(result.documents.filter(doc=>doc.caseId===unrelatedId),before.documents.filter(doc=>doc.caseId===unrelatedId));
  assert.deepEqual(result.candidates.filter(candidate=>candidate.caseId===unrelatedId),before.candidates.filter(candidate=>candidate.caseId===unrelatedId));
  assert.deepEqual(result.audit.slice(0,before.audit.length),before.audit);
  assert.equal(result.audit.slice(before.audit.length).some(entry=>entry.caseId===unrelatedId),false);
  assert.deepEqual(state,before);
});

test('selected rereads still discover genuinely matching shipment membership without refreshing unrelated history',()=>{
  const setup=fixture();const {selected,unrelatedId}=setup;let state=setup.state;state=applyAction(state,{type:'create_case',title:'Related source'},actor);
  const related=state.cases.find(shipment=>![selected,unrelatedId].includes(shipment.id))!;
  const source=document(state,related.id,'related-source',true);
  state.candidates.push({id:'matching-bill',caseId:related.id,documentId:source.id,documentVersion:1,page:1,field:'houseBillOfLading',value:'SYNTHETIC-MATCH',originalText:'HBL: SYNTHETIC-MATCH',location:'Page 1',method:'kimi:synthetic',confidence:'high',readability:'clear',normalizations:[]});
  const untouched=structuredClone(state.cases.find(shipment=>shipment.id===unrelatedId));
  const result=reread(state,selected);
  assert.equal(result.documents.find(doc=>doc.id==='selected-source')!.caseId,result.documents.find(doc=>doc.id==='related-source')!.caseId);
  assert.ok(result.cases.find(shipment=>shipment.id===related.id)!.mergedInto||result.cases.find(shipment=>shipment.id===selected)!.mergedInto);
  assert.deepEqual(result.cases.find(shipment=>shipment.id===unrelatedId),untouched);
});


test('automatic missing-information drafts follow a selected reread into its merged destination',()=>{
  const setup=fixture();let state=setup.state;const {selected,unrelatedId}=setup;
  state=applyAction(state,{type:'create_case',title:'Earlier related source'},actor);
  const related=state.cases.find(shipment=>![selected,unrelatedId].includes(shipment.id))!;
  related.createdAt='2020-01-01T00:00:00Z';
  const source=document(state,related.id,'related-source',true);
  state.candidates.push({id:'matching-bill',caseId:related.id,documentId:source.id,documentVersion:1,page:1,field:'houseBillOfLading',value:'SYNTHETIC-MATCH',originalText:'HBL: SYNTHETIC-MATCH',location:'Page 1',method:'kimi:synthetic',confidence:'high',readability:'clear',normalizations:[]});
  const untouched=structuredClone(state.cases.find(shipment=>shipment.id===unrelatedId));
  const result=reread(state,selected);
  assert.equal(result.cases.find(shipment=>shipment.id===selected)!.mergedInto,related.id);
  const draft=result.emailDrafts?.find(draft=>draft.caseId===related.id);
  assert.ok(draft,'The active merged destination receives its unresolved information requests.');
  assert.ok(draft.issueIds.length>0);assert.ok(draft.issueIds.every(id=>id.startsWith(related.id+':')));
  assert.equal(draft.approval,undefined);assert.equal(draft.status,'draft');
  assert.equal(result.emailDrafts?.some(draft=>draft.caseId===selected||draft.caseId===unrelatedId),false);
  assert.deepEqual(result.cases.find(shipment=>shipment.id===unrelatedId),untouched);
});
