import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createEmptyWorkspace, getIssues } from '../lib/engine.ts';
import { applyCorrespondenceAction, automaticQuestionIssues, syncAutomaticQuestionDrafts } from '../lib/shipment-correspondence.ts';
import { ECUS_FORM_FIELDS, getEcusRequiredIssues } from '../lib/ecus-form.ts';
import type { Action, Candidate, GoodsLine, Issue, WorkspaceState } from '../lib/types.ts';
const actor = { id: 'reviewer-a', name: 'Reviewer A', email: 'reviewer@example.invalid' };
const create = () => {
  let state = applyAction(createEmptyWorkspace('test-ws'), { type: 'intake', documents: [{ id: 'invoice-test', name: 'invoice.txt', mime: 'text/plain', size: 100, sha256: 'invoice-test', extractionPipeline: 'kimi', extractionStatus: 'extracted', aiPageReadings: [{page: 1, documentType: 'invoice', readability: 'clear'}], pages: [{ page: 1, text: 'COMMERCIAL INVOICE\nInvoice No: SYNTHETIC-42\nGross Weight: 10 KG' }] }] }, actor);
  state = applyAction(state, { type: 'confirm_grouping', caseId: state.cases[0].id, reason: 'Synthetic fixture: this single document is a shipment.' }, actor);
  return state;
};

test('questions become editable local drafts; duplicates do not append and no send action exists', () => {
  let state = create(); const caseId = state.cases[0].id; const issue = getIssues(state, caseId).find(issue => issue.ecusFieldKey === 'declarationType' && issue.id.endsWith(':required'))!;
  assert.ok(issue);
  const action: Action = { type: 'draft_questions', caseId, issueIds: [issue.id], locale: 'en' };
  state = applyAction(state, action, actor); assert.equal(state.emailDrafts?.length, 1);
  const draft = state.emailDrafts![0]; assert.equal(draft.status, 'draft'); assert.equal(draft.recipient, ''); assert.match(draft.body, /Please provide .*not found/);
  state = applyAction(state, action, actor); assert.equal(state.emailDrafts?.length, 1); assert.equal(state.emailDrafts![0].body, draft.body);
  state = applyAction(state, { type: 'save_email_draft', draftId: draft.id, subject: 'Reviewed subject', body: 'Reviewed question' }, actor);
  assert.equal(state.emailDrafts![0].body, 'Reviewed question'); assert.equal(state.audit.at(-1)?.actor, actor.name);
  assert.throws(() => applyAction(state, { ...action, issueIds: ['another-case:missing'] }, actor));
});

test('questions cannot be drafted from a resolved finding and unknown drafts cannot be edited', () => {
  const state = create();
  assert.throws(() => applyAction(state, { type: 'save_email_draft', draftId: 'missing', subject: 'S', body: 'B' }, actor));
  assert.throws(() => applyAction(state, { type: 'draft_questions', caseId: state.cases[0].id, issueIds: [] }, actor));
});

const row = (index: number): GoodsLine => ({ id: `row-${index}`, description: '', quantity: '', unit: '', unitPrice: '', amount: '', hsCode: '', origin: '', dutyRate: '', vatRate: '', reviewed: false, manual: true });
function automaticFixture(goodsCount = 2) {
  const state = create();
  const shipment = state.cases[0];
  state.emailDrafts = [];
  shipment.goods = Array.from({length: goodsCount}, (_, index) => row(index + 1));
  const issues = getEcusRequiredIssues(undefined, {caseId:shipment.id,goods:shipment.goods,documents:state.documents});
  return {state, shipment, issues};
}
function sender(state: WorkspaceState, address: string, id = 'sender', documentIds = [state.documents[0].id]) {
  state.emails.push({id,messageId:id,sender:address,subject:'Synthetic shipment',receivedAt:'2026-10-15T12:00:00Z',originalName:`${id}.eml`,sha256:id,documentIds});
}
function evidenceIssue(state: WorkspaceState, key: string, values: string[], goodsLineId?: string): Issue {
  const field = ECUS_FORM_FIELDS.find(field => field.key === key)!;
  const shipment = state.cases[0], document = state.documents[0];
  const candidates: Candidate[] = values.map((value,index) => ({id:`proof-${key}-${goodsLineId ?? 'header'}-${index}`,caseId:shipment.id,documentId:document.id,documentVersion:document.version,
    field:key,value,originalText:value,page:1,location:'Synthetic source',method:'kimi:synthetic',confidence:'low',readability:'uncertain',normalizations:[],...(goodsLineId?{lineId:goodsLineId}:{})}));
  state.candidates.push(...candidates);
  return {id:`${shipment.id}:ecus-evidence:${JSON.stringify([key,goodsLineId??null])}:${values.length>1?'conflict':'uncertain'}`,caseId:shipment.id,kind:'declaration',severity:'error',field:field.fieldId,ecusFieldKey:key,...(goodsLineId?{goodsLineId}:{}),title:'Synthetic question',description:'Synthetic ambiguity',candidateIds:candidates.map(candidate=>candidate.id),documentIds:[document.id],resolved:false,fingerprint:JSON.stringify(values)};
}

test('complete Kimi reading automatically prepares one idempotent local draft with compact goods questions', () => {
  const {state,issues}=automaticFixture(); sender(state,'supplier@example.invalid');
  syncAutomaticQuestionDrafts(state,actor,issues,'en');
  assert.equal(state.emailDrafts!.length,1);
  const draft=state.emailDrafts![0];
  assert.equal(draft.status,'draft'); assert.equal(draft.approval,undefined); assert.equal(draft.recipient,'supplier@example.invalid');
  assert.equal(draft.automation?.state,'ready'); assert.equal(draft.issueIds.length,issues.length);
  assert.match(draft.body,/VAT amount — goods rows 1–2/);
  assert.equal((draft.body.match(/VAT amount/g)||[]).length,1);
  const before=JSON.stringify(state); syncAutomaticQuestionDrafts(state,actor,issues,'en'); assert.equal(JSON.stringify(state),before);
});

test('automatic questions wait for Kimi to read all original pages, including legacy text', () => {
  const mutations: ((state: WorkspaceState)=>void)[] = [
    state=>{delete state.documents[0].extractionPipeline;},
    state=>{state.documents[0].extractionStatus='pending_ai';},
    state=>{state.documents[0].pages.push({page:2,text:'Unread page'});},
    state=>{state.documents[0].aiRejectedPages=[1];},
    state=>{state.cases[0].groupingConfirmed=false;},
    state=>{state.documents.push({...structuredClone(state.documents[0]),id:'another',aiProcessedPages:[]});},
  ];
  for(const mutate of mutations){const {state,issues}=automaticFixture();mutate(state);syncAutomaticQuestionDrafts(state,actor,issues,'en');assert.equal(state.emailDrafts!.length,0);}
  const {state,issues}=automaticFixture();sender(state,'supplier@example.invalid');syncAutomaticQuestionDrafts(state,actor,issues,'en');
  const draft=state.emailDrafts![0]; applyCorrespondenceAction(state,{type:'approve_email_draft',draftId:draft.id},actor,issues);
  state.documents[0].aiProcessedPages=[];syncAutomaticQuestionDrafts(state,actor,issues,'en');
  assert.equal(draft.automation!.state,'waiting_for_sources');assert.equal(draft.approval,undefined);
  assert.throws(()=>applyCorrespondenceAction(state,{type:'approve_email_draft',draftId:draft.id},actor,issues),/Review the current/);
});

test('automatic requests exclude local approvals and absent optional fields and prefer conflicting evidence over missing', () => {
  const {state,shipment,issues}=automaticFixture();
  const required=issues.find(issue=>issue.ecusFieldKey==='invoiceTotal')!;
  const conflict=evidenceIssue(state,'invoiceTotal',['123.00','456.00']);
  const internal={...required,id:`${shipment.id}:field:review:review`,ecusFieldKey:undefined};
  const optional={...required,id:`${shipment.id}:optional:review`,ecusFieldKey:'invoiceNumber'};
  const chosen=automaticQuestionIssues(state,shipment,[required,conflict,internal,optional,{...required,id:'foreign',caseId:'other'}]);
  assert.deepEqual(chosen.map(issue=>issue.id),[conflict.id]);
  syncAutomaticQuestionDrafts(state,actor,[required,conflict,internal,optional],'en');
  assert.match(state.emailDrafts![0].body,/123.00 \/ 456.00/);assert.doesNotMatch(state.emailDrafts![0].body,/not found/);
});

test('manual text and recipient survive updated questions until a human reviews and approves the local draft', () => {
  const {state,issues}=automaticFixture();sender(state,'supplier@example.invalid');
  syncAutomaticQuestionDrafts(state,actor,issues.slice(0,1),'en'); const draft=state.emailDrafts![0];
  applyCorrespondenceAction(state,{type:'save_email_draft',draftId:draft.id,subject:'My subject',body:'My carefully edited question',recipient:'chosen@example.invalid'},actor,issues.slice(0,1));
  applyCorrespondenceAction(state,{type:'approve_email_draft',draftId:draft.id},actor,issues.slice(0,1));assert.equal(draft.approval?.actorId,actor.id);
  syncAutomaticQuestionDrafts(state,actor,issues.slice(0,2),'en');
  assert.equal(draft.subject,'My subject');assert.equal(draft.body,'My carefully edited question');assert.equal(draft.recipient,'chosen@example.invalid');
  assert.equal(draft.automation!.state,'needs_review');assert.ok(draft.automation!.pendingBody);assert.equal(draft.approval,undefined);
  assert.throws(()=>applyCorrespondenceAction(state,{type:'approve_email_draft',draftId:draft.id},actor,issues.slice(0,2)),/Review the current/);
  applyCorrespondenceAction(state,{type:'save_email_draft',draftId:draft.id,subject:draft.automation!.pendingSubject!,body:draft.automation!.pendingBody!},actor,issues.slice(0,2));
  assert.equal(draft.automation!.state,'ready'); assert.equal(draft.automation!.editedByUser,false);
  applyCorrespondenceAction(state,{type:'approve_email_draft',draftId:draft.id},actor,issues.slice(0,2));
  const after=JSON.stringify(state);applyCorrespondenceAction(state,{type:'approve_email_draft',draftId:draft.id},actor,issues.slice(0,2));assert.equal(JSON.stringify(state),after);
  assert.equal(draft.status,'draft');
  state.documents[0].version++;syncAutomaticQuestionDrafts(state,actor,issues.slice(0,2),'en');assert.equal(draft.approval,undefined);
});

test('resolved requests retire the generated request text and remove approval without deleting its audit trail', () => {
  const {state,issues}=automaticFixture();sender(state,'supplier@example.invalid');syncAutomaticQuestionDrafts(state,actor,issues,'en');const draft=state.emailDrafts![0];
  applyCorrespondenceAction(state,{type:'approve_email_draft',draftId:draft.id},actor,issues);
  syncAutomaticQuestionDrafts(state,actor,[],'en');assert.equal(draft.automation!.state,'resolved');assert.equal(draft.issueIds.length,0);assert.equal(draft.approval,undefined);
  assert.match(draft.body,/No outstanding information requests/);assert.ok(state.audit.some(entry=>entry.action==='email_draft_approved'));
});

test('recipient selection uses only one current external sender and never overwrites a chosen address', () => {
  const {state,issues}=automaticFixture();state.settings.inboxAddress='own@example.invalid';
  sender(state,'own@example.invalid');sender(state,'supplier@example.invalid','external');sender(state,'SUPPLIER@example.invalid','duplicate');sender(state,'foreign@example.invalid','foreign',['foreign-document']);
  syncAutomaticQuestionDrafts(state,actor,issues,'en');const draft=state.emailDrafts![0];assert.equal(draft.recipient.toLowerCase(),'supplier@example.invalid');
  sender(state,'second@example.invalid','second');syncAutomaticQuestionDrafts(state,actor,issues,'en');assert.equal(draft.recipient,'');
  assert.throws(()=>applyCorrespondenceAction(state,{type:'approve_email_draft',draftId:draft.id},actor,issues),/valid recipient/);
  applyCorrespondenceAction(state,{type:'save_email_draft',draftId:draft.id,subject:draft.subject,body:draft.body,recipient:'chosen@example.invalid'},actor,issues);
  syncAutomaticQuestionDrafts(state,actor,issues,'en');assert.equal(draft.recipient,'chosen@example.invalid');
});

test('large missing goods grids fit one draft with every required issue retained', () => {
  const {state,issues}=automaticFixture(500);syncAutomaticQuestionDrafts(state,actor,issues,'en');const draft=state.emailDrafts![0];
  assert.ok(draft.body.length<20_000);assert.equal(draft.issueIds.length,14+24*500);assert.match(draft.body,/VAT amount — goods rows 1–500/);
});

test('oversized ambiguous evidence uses a complete field and row matrix without truncating targets', () => {
  const {state,issues}=automaticFixture(500);
  const conflict=evidenceIssue(state,'invoiceTotal',['A'.repeat(21_000),'B'.repeat(21_000)]);
  syncAutomaticQuestionDrafts(state,actor,[...issues,conflict],'en');const draft=state.emailDrafts![0];
  assert.ok(draft.body.length<20_000);assert.equal(draft.issueIds.length,issues.length);assert.match(draft.body,/full evidence remains in the shipment review/);
  for(const field of ECUS_FORM_FIELDS.filter(field=>field.tab==='goods'&&!field.readOnly))assert.ok(draft.body.includes(field.labelEn),field.key);
  assert.match(draft.body,/1–500: -none/);
});

test('a case-scoped synchronization cannot resolve another case draft from an incomplete issue list', () => {
  const {state,issues}=automaticFixture();syncAutomaticQuestionDrafts(state,actor,issues,'en');
  const other={...structuredClone(state.cases[0]),id:'other-case',documentIds:['other-doc']};state.cases.push(other);
  state.documents.push({...structuredClone(state.documents[0]),id:'other-doc',caseId:other.id});
  const otherIssues=getEcusRequiredIssues(undefined,{caseId:other.id,goods:other.goods,documents:state.documents});syncAutomaticQuestionDrafts(state,actor,otherIssues,'en',other.id);
  assert.equal(state.emailDrafts!.length,2);const before=JSON.stringify(state.emailDrafts![0]);
  syncAutomaticQuestionDrafts(state,actor,[],'en',other.id);assert.equal(JSON.stringify(state.emailDrafts![0]),before);assert.equal(state.emailDrafts![1].automation!.state,'resolved');
});

test('a wholly absent goods table asks for itemized goods only after Kimi finishes', () => {
  const {state,shipment}=automaticFixture(0);
  const issue:Issue={id:`${shipment.id}:goods-missing`,caseId:shipment.id,kind:'goods',severity:'error',title:'Missing goods',description:'Missing goods',candidateIds:[],documentIds:[],resolved:false,fingerprint:'missing-goods'};
  syncAutomaticQuestionDrafts(state,actor,[issue],'en');assert.equal(state.emailDrafts!.length,1);assert.match(state.emailDrafts![0].body,/itemized goods list/);
  assert.deepEqual(state.emailDrafts![0].issueIds,[issue.id]);
  state.emailDrafts=[];state.documents[0].aiProcessedPages=[];syncAutomaticQuestionDrafts(state,actor,[issue],'en');assert.equal(state.emailDrafts!.length,0);
});

test('stale local decisions with clear current evidence stay out of automatic external questions', () => {
  const {state,shipment,issues}=automaticFixture();
  const required=issues.find(issue=>issue.ecusFieldKey==='declarationType')!;
  const conflict=evidenceIssue(state,'invoiceTotal',['100.00','200.00']);
  const original=evidenceIssue(state,'grossWeight',['10']);
  const proof=state.candidates.find(candidate=>candidate.id===original.candidateIds[0])!;
  proof.confidence='high';proof.readability='clear';
  const stale:Issue={...original,id:`${shipment.id}:stale-grossWeight`,kind:'stale',field:'grossWeight',title:'Review the old saved weight against the current source'};
  const questions=[stale,required,conflict];
  assert.deepEqual(new Set(automaticQuestionIssues(state,shipment,questions).map(issue=>issue.id)),new Set([required.id,conflict.id]));
  syncAutomaticQuestionDrafts(state,actor,questions,'en');const draft=state.emailDrafts![0];
  assert.deepEqual(new Set(draft.issueIds),new Set([required.id,conflict.id]));
  assert.doesNotMatch(draft.body,/gross weight|10\./i);
  assert.match(draft.body,/100.00 \/ 200.00/);
  assert.match(draft.body,/Declaration type/);
  applyCorrespondenceAction(state,{type:'draft_questions',caseId:shipment.id,issueIds:[stale.id],locale:'en'},actor,questions);
  assert.ok(draft.issueIds.includes(stale.id),'A human can explicitly draft an external question about a stale decision.');
});
