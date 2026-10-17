import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction, createEmptyWorkspace, getIssues } from '../lib/engine.ts';
import { currentEmailCaseId, emailLinkedToCase, isEmailMatchCurrent } from '../lib/email-grouping.ts';
import { parseMutation } from '../lib/server-validation.ts';
import type { EmailShipmentMatchProposal } from '../lib/email-shipment-ai.ts';
import type { Actor, ShipmentDocument, WorkspaceState } from '../lib/types.ts';

const actor: Actor = { id: 'email-reviewer', name: 'Synthetic reviewer', email: 'reviewer@example.invalid' };

function fixture() {
  let state = createEmptyWorkspace('synthetic-email-links');
  for (const title of ['Synthetic shipment A', 'Synthetic shipment B']) {
    state = applyAction(state, { type: 'create_case', title }, actor);
  }
  const caseIds = state.cases.map(shipment => shipment.id);
  const documents: ShipmentDocument[] = caseIds.map((caseId, index) => ({
    id: `document-${index}`, caseId, name: `synthetic-house-${index}.txt`,
    type: 'bill_of_lading', mime: 'text/plain', size: 100, sha256: `synthetic-email-source-${index}`,
    version: 1, active: true, uploadedAt: '2026-01-01T00:00:00Z', synthetic: true,
    pages: [{ page: 1, textSource: 'pdf_text', text: `HBL No: SYNTHETIC-HBL-${index + 100}` }],
    extractionStatus: 'extracted',
  }));
  state.documents = documents;
  for (const document of documents) state.cases.find(shipment => shipment.id === document.caseId)!.documentIds.push(document.id);
  state.emails.push({
    id: 'body-email', messageId: 'synthetic-message@example.invalid',
    sender: 'broker@example.invalid', subject: 'Shipment questions',
    text: 'Please check these shipments:\nHBL No: SYNTHETIC-HBL-100\nHBL No: SYNTHETIC-HBL-101',
    receivedAt: '2026-01-02T00:00:00Z', originalName: 'synthetic-message.eml',
    sha256: 'synthetic-email-hash', documentIds: [],
  });
  return { state, caseIds };
}

function proposal(state: WorkspaceState, index: number): EmailShipmentMatchProposal {
  const document = state.documents.find(document => document.id === `document-${index}`)!;
  const value = `SYNTHETIC-HBL-${index + 100}`;
  return {
    emailId: 'body-email', caseId: document.caseId, decision: 'link', explanation: 'Synthetic grounded identifier.',
    evidence: [{ field: 'houseBillOfLading', value, emailQuote: `HBL No: ${value}`,
      documentId: document.id, documentVersion: document.version, page: 1, documentQuote: `HBL No: ${value}` }],
  };
}

function match(state: WorkspaceState, indices = [0], truncated = false) {
  return applyAction(state, { type: 'apply_email_matches', emailIds: ['body-email'],
    matches: indices.map(index => proposal(state, index)), model: 'synthetic-kimi', truncated }, actor);
}

function review(state: WorkspaceState, index: number, decision: 'accept' | 'reject') {
  return applyAction(state, { type: 'review_email_match', emailId: 'body-email',
    matchId: state.emails[0].shipmentMatches![index].id, decision, reason: `Synthetic human ${decision} after checking the source.` }, actor);
}

test('AI email association preserves cases, documents, approval snapshots and the original email', () => {
  const { state, caseIds } = fixture();
  state.cases[0].status = 'approved';
  state.cases[0].approval = { actor: actor.name, at: '2026-01-01T00:00:00Z', snapshotId: 'existing-snapshot' };
  state.snapshots.push({ id: 'existing-snapshot', caseId: caseIds[0], createdAt: '2026-01-01T00:00:00Z', actor: actor.name,
    version: 1, declaration: structuredClone(state.cases[0]), candidates: [], documents: [structuredClone(state.documents[0])], issues: [], customsValidation: 'Not yet assessed' });
  const before = structuredClone(state);
  const after = match(state, [0, 1]);
  assert.deepEqual(after.cases, before.cases);
  assert.deepEqual(after.documents, before.documents);
  assert.deepEqual(after.candidates, before.candidates);
  assert.deepEqual(after.snapshots, before.snapshots);
  assert.deepEqual(after.handoffs, before.handoffs);
  for (const [key, value] of Object.entries(before.emails[0])) assert.deepEqual(after.emails[0][key as keyof typeof after.emails[0]], value);
  assert.equal(after.emails[0].shipmentMatches!.length, 2);
  assert.ok(after.emails[0].shipmentMatches!.every(item => item.status === 'matched'));
  assert.deepEqual(after.emails[0].documentIds, []);
  assert.ok(emailLinkedToCase(after, after.emails[0], caseIds[0]));
  assert.ok(emailLinkedToCase(after, after.emails[0], caseIds[1]));
  assert.deepEqual(state, before, 'applyAction must not mutate its input');
  assert.equal(after.revision, before.revision + 1);
});

test('confirming one suggested shipment link leaves the other suggestion untouched', () => {
  const { state, caseIds } = fixture();
  const proposed = match(state, [0, 1], true);
  assert.ok(proposed.emails[0].shipmentMatches!.every(item => item.status === 'needs_review'));
  const untouched = structuredClone(proposed.emails[0].shipmentMatches![1]);
  const accepted = review(proposed, 0, 'accept');
  assert.equal(accepted.emails[0].shipmentMatches![0].status, 'matched');
  assert.equal(accepted.emails[0].shipmentMatches![0].decisionSource, 'human');
  assert.deepEqual(accepted.emails[0].shipmentMatches![1], untouched);
  assert.ok(emailLinkedToCase(accepted, accepted.emails[0], caseIds[0]));
  assert.equal(emailLinkedToCase(accepted, accepted.emails[0], caseIds[1]), false);
  assert.equal(accepted.audit.filter(entry => entry.action === 'email_match_reviewed').length, 1);
});

test('a human rejection stays rejected after later AI matching responses', () => {
  const { state } = fixture();
  const rejected = review(match(state, [0, 1], true), 0, 'reject');
  const decision = structuredClone(rejected.emails[0].shipmentMatches![0]);
  const rerun = match(rejected, [0, 1]);
  assert.deepEqual(rerun.emails[0].shipmentMatches![0], decision);
  assert.equal(rerun.emails[0].shipmentMatches![1].status, 'matched');
  assert.equal(emailLinkedToCase(rerun, rerun.emails[0], decision.caseId), false);
});

test('changed source versions hide accepted links and require a fresh human confirmation', () => {
  const { state, caseIds } = fixture();
  let current = review(match(state, [0], true), 0, 'accept');
  const accepted = structuredClone(current.emails[0].shipmentMatches![0]);
  assert.ok(isEmailMatchCurrent(current, accepted));
  current = applyAction(current, { type: 'classify_document', documentId: 'document-0', documentType: 'bill_of_lading' }, actor);
  assert.equal(current.documents[0].version, 2);
  assert.equal(isEmailMatchCurrent(current, accepted), false);
  assert.equal(emailLinkedToCase(current, current.emails[0], caseIds[0]), false);
  assert.throws(() => review(current, 0, 'accept'), /supporting document changed/i);
  current = match(current);
  assert.equal(current.emails[0].shipmentMatches![0].status, 'needs_review');
  assert.equal(current.emails[0].shipmentMatches![0].evidence[0].documentVersion, 2);
  assert.equal(emailLinkedToCase(current, current.emails[0], caseIds[0]), false);
  current = review(current, 0, 'accept');
  assert.ok(emailLinkedToCase(current, current.emails[0], caseIds[0]));
});

test('a reviewed link follows a manually merged case and a fresh match does not duplicate it', () => {
  const { state, caseIds } = fixture();
  let current = review(match(state, [0], true), 0, 'accept');
  current = applyAction(current, { type: 'merge_cases', sourceCaseId: caseIds[0], targetCaseId: caseIds[1] }, actor);
  assert.equal(current.cases.find(shipment => shipment.id === caseIds[0])!.mergedInto, caseIds[1]);
  assert.ok(emailLinkedToCase(current, current.emails[0], caseIds[1]));
  assert.ok(emailLinkedToCase(current, current.emails[0], caseIds[0]));
  const decision = structuredClone(current.emails[0].shipmentMatches![0]);
  assert.equal(currentEmailCaseId(current, decision.caseId), caseIds[1], 'Open-shipment navigation and source evidence resolve the active merged target.');
  current = match(current);
  assert.equal(current.emails[0].shipmentMatches!.length, 1);
  assert.deepEqual(current.emails[0].shipmentMatches![0], decision);
  assert.ok(emailLinkedToCase(current, current.emails[0], caseIds[1]));
});

test('a grounded body-only email supplies the correspondence recipient without moving attachments or sending mail', () => {
  const { state, caseIds } = fixture();
  let current = match(state);
  current = applyAction(current, {type:'add_ai_candidates',caseId:caseIds[0],documentId:'document-0',documentVersion:1,model:'synthetic-kimi',pages:[1],proposals:[{field:'houseBillOfLading',value:'SYNTHETIC-HBL-100',quote:'HBL No: SYNTHETIC-HBL-100',page:1,confidence:'high',readability:'clear'}],pageReadings:[{page:1,documentType:'bill_of_lading',readability:'clear'}]},actor);
  current = match(current);
  current = applyAction(current, { type: 'confirm_grouping', caseId: caseIds[0], reason: 'Synthetic source check.' }, actor);
  const issue = getIssues(current, caseIds[0]).find(issue => issue.ecusFieldKey === 'invoiceTotal' && issue.id.endsWith(':required'))!;
  assert.ok(issue);
  const emailBefore = structuredClone(current.emails[0]);
  current = applyAction(current, { type: 'draft_questions', caseId: caseIds[0], issueIds: [issue.id], locale: 'en' }, actor);
  assert.equal(current.emailDrafts!.length, 1);
  assert.equal(current.emailDrafts![0].recipient, 'broker@example.invalid');
  assert.equal(current.emailDrafts![0].status, 'draft');
  assert.deepEqual(current.emails[0], emailBefore);
  assert.deepEqual(current.emails[0].documentIds, []);
  assert.ok(current.audit.at(-1)!.reason.includes('no email sent'));
});

test('public mutation schema accepts a human decision but rejects internal AI result and status actions', () => {
  assert.equal(parseMutation({ revision: 1, action: { type: 'review_email_match', emailId: 'body-email', matchId: 'match-1', decision: 'accept', reason: 'Checked source.' } }).action.type, 'review_email_match');
  assert.throws(() => parseMutation({ revision: 1, action: { type: 'apply_email_matches', emailIds: ['body-email'], matches: [], model: 'synthetic-kimi', truncated: false } }));
  assert.throws(() => parseMutation({ revision: 1, action: { type: 'email_matching_status', emailIds: ['body-email'], status: 'failed', reason: 'Forged status.' } }));
});

test('archiving a shipment preserves existing body-only correspondence but changed proof still expires it', () => {
  const { state, caseIds } = fixture();
  const current = match(state);
  current.cases[0].status = 'completed';
  assert.ok(emailLinkedToCase(current, current.emails[0], caseIds[0]));
  current.documents[0].version += 1;
  assert.equal(emailLinkedToCase(current, current.emails[0], caseIds[0]), false);
});


test('a heading cannot swallow the following identifier label without precomputed candidates', () => {
  const { state } = fixture();
  state.documents[0].pages[0].text = 'HOUSE BILL OF LADING\n' + state.documents[0].pages[0].text.replace('HBL No:', 'HBL Number:');
  state.emails[0].text = state.emails[0].text!.replace('HBL No:', 'HBL Number:');
  const value = proposal(state, 0);
  value.evidence[0].emailQuote = value.evidence[0].emailQuote.replace('HBL No:', 'HBL Number:');
  value.evidence[0].documentQuote = value.evidence[0].documentQuote.replace('HBL No:', 'HBL Number:');
  const after = applyAction(state, { type: 'apply_email_matches', emailIds: ['body-email'], matches: [value], model: 'synthetic-kimi', truncated: false }, actor);
  assert.equal(after.emails[0].shipmentMatches![0].status, 'matched');
});

function withCompetingBill(state: WorkspaceState) {
  const next = applyAction(state, { type: 'create_case', title: 'Another shipment with a reused bill' }, actor);
  const shipment = next.cases.at(-1)!;
  const document = { ...structuredClone(next.documents[0]), id: 'competing-bill', caseId: shipment.id, sha256: 'synthetic-competing-bill' };
  next.documents.push(document);
  shipment.documentIds.push(document.id);
  return next;
}

test('a newly competing bill hides an unattended AI link while a grounded human decision can resolve the ambiguity', () => {
  const { state, caseIds } = fixture();
  const linked = match(state);
  const prior = structuredClone(linked.emails[0].shipmentMatches![0]);
  const ambiguous = withCompetingBill(linked);
  assert.deepEqual(ambiguous.documents[0], linked.documents[0], 'The originally cited document has not changed.');
  assert.equal(isEmailMatchCurrent(ambiguous, prior), false);
  assert.equal(emailLinkedToCase(ambiguous, ambiguous.emails[0], caseIds[0]), false);
  const refreshed = match(ambiguous);
  assert.equal(refreshed.emails[0].shipmentMatches![0].status, 'needs_review');
  const accepted = review(refreshed, 0, 'accept');
  assert.ok(emailLinkedToCase(accepted, accepted.emails[0], caseIds[0]));

  const previouslyReviewed = withCompetingBill(review(match(state, [0], true), 0, 'accept'));
  assert.ok(isEmailMatchCurrent(previouslyReviewed, previouslyReviewed.emails[0].shipmentMatches![0]));
});

test('new conflicting shipment references invalidate both AI and human links without replacing their old proof', () => {
  const { state, caseIds } = fixture();
  state.emails[0].text += '\nInvoice Number: SYNTHETIC-INV-100';
  for (const human of [false, true]) {
    const linked = human ? review(match(state, [0], true), 0, 'accept') : match(state);
    const prior = structuredClone(linked.emails[0].shipmentMatches![0]);
    const newDocument: ShipmentDocument = { ...structuredClone(linked.documents[0]), id: 'contradictory-invoice', sha256: 'synthetic-conflicting-invoice',
      type: 'invoice', pages: [{ page: 1, textSource: 'pdf_text', text: 'Invoice Number: SYNTHETIC-INV-999' }] };
    linked.documents.push(newDocument);
    linked.cases[0].documentIds.push(newDocument.id);
    assert.deepEqual(linked.emails[0].shipmentMatches![0], prior);
    assert.equal(isEmailMatchCurrent(linked, prior), false);
    assert.equal(emailLinkedToCase(linked, linked.emails[0], caseIds[0]), false);
    assert.throws(() => review(linked, 0, 'accept'), /supporting document changed/i);
  }
});

test('an omitted previous AI association becomes a retained review suggestion and human decisions remain untouched', () => {
  const { state, caseIds } = fixture();
  const linked = match(state, [0, 1]);
  const prior = structuredClone(linked.emails[0].shipmentMatches![0]);
  const rerun = match(linked, [1]);
  const omitted = rerun.emails[0].shipmentMatches![0];
  assert.equal(omitted.status, 'needs_review');
  assert.equal(omitted.id, prior.id);
  assert.deepEqual(omitted.evidence, prior.evidence);
  assert.equal(emailLinkedToCase(rerun, rerun.emails[0], caseIds[0]), false);
  assert.ok(emailLinkedToCase(rerun, rerun.emails[0], caseIds[1]));
  assert.ok(rerun.audit.at(-1)!.before && JSON.stringify(rerun.audit.at(-1)!.before).includes(prior.id));
  for (const decision of ['accept', 'reject'] as const) {
    const reviewed = review(match(state, [0], true), 0, decision);
    const saved = structuredClone(reviewed.emails[0].shipmentMatches![0]);
    const omittedHuman = match(reviewed, []);
    assert.deepEqual(omittedHuman.emails[0].shipmentMatches![0], saved);
  }
});
