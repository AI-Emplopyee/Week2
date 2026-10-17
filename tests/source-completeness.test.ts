import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction, createEmptyWorkspace, getIssues } from '../lib/engine.ts';
import { assessPageRejections, documentSourceReady, sourcePageNeedsKimi } from '../lib/source-completeness.ts';
import { readyForAutomaticQuestions, syncAutomaticQuestionDrafts } from '../lib/shipment-correspondence.ts';
import { runCaseKimi } from '../lib/client-case-automation.ts';
import { runDocumentAi } from '../lib/client-vision.ts';
import type { ShipmentDocument, WorkspaceState } from '../lib/types.ts';
const actor={id:'supersession-reviewer',name:'Synthetic reviewer',email:'reviewer@example.invalid'};
const status={configured:true,model:'synthetic',endpoint:'https://api.moonshot.ai/v1',provider:'Moonshot',limits:{maxPages:5,maxTextCharacters:24000,maxCandidates:500}};
function fixture(){
  const state=applyAction(createEmptyWorkspace('guide-supersession'),{type:'create_case',title:'Synthetic guide priority'},actor);
  const shipment=state.cases[0];shipment.groupingConfirmed=true;
  const invoice:ShipmentDocument={id:'invoice',caseId:shipment.id,name:'invoice.txt',type:'invoice',mime:'text/plain',size:1,sha256:'invoice',active:true,version:1,uploadedAt:'',synthetic:true,extractionPipeline:'kimi',extractionStatus:'extracted',aiProcessedPages:[1],aiRejectedPages:[],pages:[{page:1,text:'Currency: USD',documentType:'invoice',aiReadability:'clear'}]};
  const secondary:ShipmentDocument={...structuredClone(invoice),id:'certificate',name:'certificate.txt',type:'certificate_of_origin',sha256:'certificate',aiRejectedPages:[1],aiError:'A rejected secondary reading remains in the evidence trace.',pages:[{page:1,text:'Currency: EUR',documentType:'certificate_of_origin',aiReadability:'clear'}]};
  state.documents.push(invoice,secondary);shipment.documentIds=[invoice.id,secondary.id];
  state.candidates.push({id:'invoice-currency',caseId:shipment.id,documentId:invoice.id,documentVersion:1,page:1,field:'currency',value:'USD',originalText:'Currency: USD',location:'Page 1',method:'kimi:synthetic',confidence:'high',readability:'clear',normalizations:[]});
  state.audit.push({id:'reading',caseId:shipment.id,at:'2026-10-15T00:00:00Z',actor:actor.name,action:'ai_header_proposals_received',reason:'Synthetic source reading.',after:{documentId:secondary.id,documentVersion:1,pages:[1],rejected:1,rejectionDiagnostics:[{index:0,page:1,field:'currency',reasons:['row_scope_mismatch']}]}});
  return{state,shipment,invoice,secondary};
}
const reading=(state:WorkspaceState)=>state.audit.find(entry=>entry.id==='reading')!.after as {documentVersion:number;pages:number[];rejected:number;rejectionDiagnostics:{index:number;page:number;field:string;reasons:string[]}[]};
test('a rejected secondary currency remains in the trace while clear invoice authority completes questions',()=>{
  const {state,shipment,secondary}=fixture();const before=structuredClone(state);
  assert.deepEqual(assessPageRejections(state,secondary,1),{blocking:false,supersededFields:['currency']});
  assert.ok(documentSourceReady(state,secondary));assert.ok(readyForAutomaticQuestions(state,shipment));
  const issues=getIssues(state,shipment.id);assert.ok(issues.some(issue=>issue.ecusFieldKey==='declarationType'&&issue.id.endsWith(':required')));
  assert.deepEqual(state,before);syncAutomaticQuestionDrafts(state,actor,issues,'en',shipment.id);assert.equal(state.emailDrafts![0].automation?.state,'ready');
  assert.deepEqual(secondary.aiRejectedPages,[1]);assert.equal(state.candidates.length,1);
});
test('unrelated rejected fields, unknown fields and other evidence failures still block missing questions',()=>{
  for(const field of ['contractNumber','contractDate','exporterAddress','[unsupported]']){
    const {state,shipment,secondary}=fixture();const audit=reading(state);audit.rejected++;audit.rejectionDiagnostics.push({index:1,page:1,field,reasons:['row_scope_mismatch']});
    assert.ok(assessPageRejections(state,secondary,1).blocking,field);assert.equal(readyForAutomaticQuestions(state,shipment),false);
    assert.ok(!getIssues(state,shipment.id).some(issue=>issue.id.endsWith(':required')),field);
  }
  for(const reason of ['missing_bounds','value_not_in_quote','quote_not_in_source','unselected_page']){
    const {state,secondary}=fixture();reading(state).rejectionDiagnostics[0].reasons=[reason];assert.ok(assessPageRejections(state,secondary,1).blocking,reason);
  }
});
test('missing, partial, stale-version or unscoped diagnostics cannot certify a page',()=>{
  const mutations:((state:WorkspaceState)=>void)[]=[
    state=>{state.audit=state.audit.filter(entry=>entry.id!=='reading');},state=>{reading(state).documentVersion=0;},
    state=>{reading(state).rejected=2;},state=>{reading(state).rejectionDiagnostics=[];},state=>{reading(state).rejectionDiagnostics[0].page=2;},state=>{reading(state).pages=[2];},
    state=>{state.audit.push({...structuredClone(state.audit.at(-1)!),id:'new-reading',after:{documentId:'certificate',documentVersion:1,pages:[1],rejected:1}});},
  ];
  for(const mutate of mutations){const {state,secondary}=fixture();mutate(state);assert.ok(assessPageRejections(state,secondary,1).blocking);}
});
test('a later unrelated page read cannot replace this page current diagnostics',()=>{
  const {state,secondary}=fixture();secondary.pages.push({page:2,text:'Supplement',documentType:'other',aiReadability:'clear'});secondary.aiProcessedPages!.push(2);
  state.audit.push({...structuredClone(state.audit.at(-1)!),id:'page-two-reading',after:{documentId:'certificate',documentVersion:1,pages:[2],rejected:0,rejectionDiagnostics:[]}});
  assert.ok(documentSourceReady(state,secondary));
});
test('same-authority rejection, conflicting invoices or uncertain primary evidence cannot be superseded',()=>{
  const mutations:((state:WorkspaceState,invoice:ShipmentDocument,secondary:ShipmentDocument)=>void)[]=[
    (_state,_invoice,secondary)=>{secondary.pages[0].documentType='invoice';},
    state=>{state.candidates.push({...state.candidates[0],id:'conflicting-currency',value:'EUR',originalText:'Currency: EUR'});state.documents[0].pages[0].text+='\nCurrency: EUR';},
    state=>{state.candidates[0].value='NOT-A-CODE';state.candidates[0].originalText='Currency: NOT-A-CODE';state.documents[0].pages[0].text='Currency: NOT-A-CODE';},
    state=>{state.candidates[0].confidence='low';},state=>{state.candidates[0].originalText='Invented source';},
    (_state,invoice)=>{invoice.pages[0].aiReadability='uncertain';},(_state,invoice)=>{invoice.aiProcessedPages=[];},(_state,invoice)=>{invoice.aiRejectedPages=[1];},
    (state,invoice)=>{invoice.caseId='different-case';state.candidates[0].caseId='different-case';},
  ];
  for(const mutate of mutations){const {state,invoice,secondary}=fixture();mutate(state,invoice,secondary);assert.ok(assessPageRejections(state,secondary,1).blocking);}
});
test('automatic queues skip only safely superseded pages and keep unresolved rejections queued once',async()=>{
  const {state,shipment,secondary}=fixture();const workspace={state,actor,role:'owner' as const,issues:[]};
  assert.equal(sourcePageNeedsKimi(state,secondary,secondary.pages[0]),false);
  await runCaseKimi({workspace,caseId:shipment.id,status},{run:async()=>{throw new Error('Superseded readings must not loop on reopening.');}});
  const result=await runDocumentAi({workspace,documentId:secondary.id,status},{fetch:async()=>{throw new Error('The default queue must not resend this page.');}});assert.equal(result.processed,0);
  reading(state).rejectionDiagnostics[0].field='contractDate';const calls:string[]=[];
  await runCaseKimi({workspace,caseId:shipment.id,status},{run:async options=>{calls.push(options.documentId);return{workspace,added:0,rejected:1,processed:1};}});assert.deepEqual(calls,[secondary.id]);
});
