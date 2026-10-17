import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction, createEmptyWorkspace, getIssues } from '../lib/engine.ts';
import { getDeclarationEntry, isDeclarationSourceCurrent, saveDeclarationField } from '../lib/declaration.ts';
import { syncShipmentDeclaration } from '../lib/shipment-autofill.ts';
import type { Action, Actor, AiSourceProposal, WorkspaceState } from '../lib/types.ts';

const actor: Actor = { id: 'vision-reviewer', name: 'Synthetic reviewer', email: 'reviewer@example.invalid' };
const imageSha256 = 'a'.repeat(64);
const act = (state: WorkspaceState, action: Action) => applyAction(state, action, actor);
const proposals: AiSourceProposal[] = [
  { field: 'invoiceNumber', value: 'VIS-001', quote: 'Invoice No: VIS-001', page: 1, confidence: 'medium', evidence: 'vision', bounds: [0.1, 0.1, 0.5, 0.1] },
  ...[['description', 'Steel crane'], ['quantity', '1'], ['unit', 'SET'], ['amount', '25000']].map(([field, value]): AiSourceProposal => ({ field, value, quote: `Steel crane 1 SET 25000`, rowIndex: 1, page: 1, confidence: 'medium', evidence: 'vision', bounds: [0.1, 0.4, 0.8, 0.1] })),
];
function fixture(packet = false) {
  return act(createEmptyWorkspace('vision-workspace'), {
    type: 'intake',
    ...(packet ? { sourceCollection: { name: 'Synthetic archive', folder: 'Invoice packet' } } : {}),
    documents: [{ id: 'visual-invoice', name: 'COMMERCIAL INVOICE.pdf', mime: 'application/pdf', size: 1024, sha256: 'b'.repeat(64), pages: [{ page: 1, text: '', textSource: 'ocr', ocrConfidence: 0.1 }, { page: 2, text: '', textSource: 'ocr', ocrConfidence: 0.1 }], extractionStatus: 'needs_transcription' }],
  });
}
function vision(state: WorkspaceState, pages = [1], proposed = proposals) {
  const document = state.documents[0];
  return act(state, { type: 'add_ai_candidates', caseId: document.caseId, documentId: document.id, documentVersion: document.version, model: 'vision-test-model', pages, pageReadings: pages.map(page => ({ page, documentType: page === 1 ? 'invoice' : 'other', readability: 'clear' })), proposals: proposed, visionEvidence: pages.map(page => ({ page, imageSha256, width: 800, height: 1200 })) });
}
function confirm(state: WorkspaceState) {
  return act(state, { type: 'confirm_grouping', caseId: state.documents[0].caseId, reason: 'Checked the original shipment documents.' });
}

test('image-only invoice facts and rows autofill only after grouping, with separate visual evidence and no human approval', () => {
  let state = vision(fixture());
  let shipment = state.cases.find(c => c.id === state.documents[0].caseId)!;
  assert.equal(state.documents[0].aiStatus, 'partial');
  assert.deepEqual(state.documents[0].aiProcessedPages, [1]);
  assert.equal(shipment.declarationDraft?.fields.length ?? 0, 0);
  assert.equal(shipment.goods.length, 1);
  assert.equal(shipment.goods[0].reviewed, false);
  state = confirm(state);
  shipment = state.cases.find(c => c.id === state.documents[0].caseId)!;
  const entry = getDeclarationEntry(shipment.declarationDraft, '1.41')!;
  assert.deepEqual(entry.value, { kind: 'reference', reference: 'VIS-001' });
  assert.equal(entry.review, null);
  assert.equal(shipment.approval, undefined);
  assert.equal(state.documents[0].pages[0].text, '');
  const source = entry.provenance[0];
  assert.equal(source.kind, 'document');
  assert.ok(source.kind === 'document' && source.visualEvidence);
  assert.ok(isDeclarationSourceCurrent(source, { caseId: shipment.id, documents: state.documents, candidates: state.candidates, goods: shipment.goods }));
  assert.ok(getIssues(state, shipment.id).some(issue => issue.field === 'invoiceNumber' && issue.kind === 'uncertain'));
  assert.ok(getIssues(state, shipment.id).some(issue => issue.kind === 'document' && issue.documentIds.includes('visual-invoice')));
  state = vision(state, [2], []);
  assert.equal(state.documents[0].aiStatus, 'completed');
  assert.deepEqual(state.documents[0].aiProcessedPages, [1, 2]);
  assert.equal(getIssues(state, shipment.id).some(issue => issue.id.endsWith(':document-visual-invoice')), false);
});

test('visual declaration evidence rejects forged image hashes, transcripts, boxes, candidate IDs and source versions', () => {
  const state = confirm(vision(fixture()));
  const shipment = state.cases.find(c => c.id === state.documents[0].caseId)!;
  const entry = getDeclarationEntry(shipment.declarationDraft, '1.41')!;
  const context = { caseId: shipment.id, documents: state.documents, candidates: state.candidates, goods: shipment.goods, actor, at: '2026-10-12T00:00:00Z' };
  const source = entry.provenance[0];
  assert.ok(source.kind === 'document' && source.visualEvidence);
  const evidence = source.visualEvidence;
  for (const forged of [
    { ...source, quote: 'Invented invoice' },
    { ...source, documentVersion: 2 },
    { ...source, page: 2 },
    { ...source, visualEvidence: { ...evidence, imageSha256: 'c'.repeat(64) } },
    { ...source, visualEvidence: { ...evidence, candidateId: 'missing' } },
    { ...source, visualEvidence: { ...evidence, bounds: [0, 0, 1, 1] as [number, number, number, number] } },
    { ...source, visualEvidence: { ...evidence, textAgreement: true } },
  ]) {
    assert.equal(isDeclarationSourceCurrent(forged, context), false);
    assert.throws(() => saveDeclarationField(shipment.declarationDraft, { type: 'save_declaration_field', caseId: shipment.id, fieldId: '1.41', applicability: 'applicable', basis: 'Invoice', value: entry.value, provenance: [forged], reason: 'Checked original.', review: true }, context));
  }
  assert.equal(isDeclarationSourceCurrent(source, { ...context, candidates: undefined }), false);
});

test('source version changes retire visual provenance and processing progress without deleting the prior decision', () => {
  let state = confirm(vision(fixture(), [1], [...proposals, { ...proposals[0], field: 'hsCode' }]));
  assert.deepEqual(state.documents[0].aiRejectedPages, [1]);
  const caseId = state.documents[0].caseId;
  const entry = getDeclarationEntry(state.cases.find(c => c.id === caseId)!.declarationDraft, '1.41')!;
  state = act(state, { type: 'save_declaration_field', caseId, fieldId: '1.41', applicability: 'applicable', basis: 'Checked invoice image', value: entry.value, provenance: entry.provenance, reason: 'Confirmed original.', review: true });
  state = act(state, { type: 'classify_document', documentId: 'visual-invoice', documentType: 'invoice' });
  const shipment = state.cases.find(c => c.id === caseId)!;
  const saved = getDeclarationEntry(shipment.declarationDraft, '1.41')!;
  assert.equal(saved.stale, true);
  assert.ok(saved.review);
  assert.deepEqual(saved.value, entry.value);
  assert.equal(state.documents[0].aiProcessedPages, undefined);
  assert.equal(state.documents[0].aiRejectedPages, undefined);
  assert.equal(state.documents[0].aiStatus, undefined);
  assert.equal(isDeclarationSourceCurrent(saved.provenance[0], { caseId, documents: state.documents, candidates: state.candidates, goods: shipment.goods }), false);
});

test('a changed visual reading retires the prior reading and flags a saved human decision instead of overwriting it', () => {
  let state = confirm(vision(fixture()));
  const caseId = state.documents[0].caseId;
  let shipment = state.cases.find(c => c.id === caseId)!;
  const entry = getDeclarationEntry(shipment.declarationDraft, '1.41')!;
  state = act(state, { type: 'save_declaration_field', caseId, fieldId: '1.41', applicability: 'applicable', basis: 'Invoice image', value: entry.value, provenance: entry.provenance, reason: 'Confirmed original.', review: true });
  state = vision(state, [1], [{ ...proposals[0], value: 'VIS-002', quote: 'Invoice No: VIS-002' }]);
  shipment = state.cases.find(c => c.id === caseId)!;
  syncShipmentDeclaration(state, shipment, actor);
  const saved = getDeclarationEntry(shipment.declarationDraft, '1.41')!;
  assert.deepEqual(saved.value, entry.value);
  assert.ok(saved.review);
  assert.equal(saved.stale, true);
  assert.deepEqual(state.candidates.filter(candidate => candidate.field === 'invoiceNumber').map(candidate => candidate.value), ['VIS-002']);
  assert.ok(getIssues(state, caseId).some(issue => issue.field === '1.41' && issue.kind === 'declaration' && issue.id.endsWith(':stale:review')));
  assert.equal(isDeclarationSourceCurrent(saved.provenance[0], { caseId, documents: state.documents, candidates: state.candidates, goods: shipment.goods }), false);
});

test('vision refresh builds goods within a sample packet without confirming it or moving its documents', () => {
  let state = fixture(true);
  const before = state.documents[0].caseId;
  state = vision(state);
  assert.equal(state.documents[0].caseId, before);
  assert.equal(state.cases.length, 1);
  const shipment = state.cases[0];
  assert.ok(shipment.sourceCollection);
  assert.equal(shipment.groupingConfirmed, false);
  assert.equal(shipment.goods.length, 1);
  assert.equal(shipment.declarationDraft?.fields.length ?? 0, 0);
});

test('a text-only PDF pass cannot claim visual page coverage', () => {
  let state = fixture();
  state.documents[0].pages[0].text = 'Invoice No: VIS-001';
  const document = state.documents[0];
  state = act(state, { type: 'add_ai_candidates', caseId: document.caseId, documentId: document.id, documentVersion: document.version, model: 'vision-test-model', pages: [1], proposals: [{ field: 'invoiceNumber', value: 'VIS-001', quote: 'Invoice No: VIS-001', page: 1, confidence: 'medium' }] });
  assert.deepEqual(state.documents[0].aiProcessedPages, []);
  assert.equal(state.documents[0].aiStatus, 'partial');
});

test('rejected evidence warnings persist across completed batches until affected pages are rerun cleanly', () => {
  let state = vision(fixture(), [1], [...proposals, { ...proposals[0], field: 'hsCode' }]);
  assert.equal(state.documents[0].aiStatus, 'partial');
  assert.deepEqual(state.documents[0].aiRejectedPages, [1]);
  assert.match(state.documents[0].aiError!, /not checked every page/);
  assert.match(state.documents[0].aiError!, /failed source evidence checks on pages: 1/);
  assert.equal(state.candidates.some(candidate => candidate.field === 'hsCode'), false);
  state = vision(state, [2], []);
  assert.equal(state.documents[0].aiStatus, 'completed');
  assert.deepEqual(state.documents[0].aiRejectedPages, [1]);
  assert.doesNotMatch(state.documents[0].aiError!, /not checked every page/);
  assert.match(state.documents[0].aiError!, /failed source evidence checks on pages: 1/);
  const before = state.candidates.length;
  state = vision(state, [1], proposals);
  assert.equal(state.documents[0].aiStatus, 'completed');
  assert.deepEqual(state.documents[0].aiRejectedPages, []);
  assert.equal(state.documents[0].aiError, undefined);
  assert.equal(state.candidates.length, before);
});

test('multi-page grounding retains valid facts and attributes incomplete source readings only to rejected pages', () => {
  const clear = proposals.map(proposal => ({ ...proposal, confidence: 'high' as const, readability: 'clear' as const }));
  let state = confirm(vision(fixture(), [1, 2], [...clear, { ...clear[0], page: 2, field: 'hsCode' }]));
  const caseId = state.documents[0].caseId;
  assert.deepEqual(state.documents[0].aiRejectedPages, [2]);
  assert.equal(state.documents[0].aiStatus, 'completed');
  assert.deepEqual(getDeclarationEntry(state.cases.find(shipment => shipment.id === caseId)!.declarationDraft, '1.41')?.value, { kind: 'reference', reference: 'VIS-001' });
  assert.equal(getIssues(state, caseId).some(issue => issue.id.endsWith(':required')), false, 'Rejected source readings must not create premature missing-information questions.');
  assert.equal(state.emailDrafts?.filter(draft => draft.automation).length ?? 0, 0);
  const audit = state.audit.findLast(entry => entry.action === 'ai_header_proposals_received');
  assert.deepEqual((audit?.after as { rejectionDiagnostics: unknown[] }).rejectionDiagnostics, [{ index: 5, page: 2, field: 'hsCode', reasons: ['row_scope_mismatch'] }]);

  state = vision(state, [1], [...clear, clear[0]]);
  assert.deepEqual(state.documents[0].aiRejectedPages, [2], 'A clean neighbour, including exact duplicate proposals, cannot clear the rejected page.');
  state = vision(state, [2], []);
  assert.deepEqual(state.documents[0].aiRejectedPages, []);
  assert.equal(state.documents[0].aiError, undefined);
  assert.ok(getIssues(state, caseId).some(issue => issue.id.endsWith(':required')));
  assert.equal(state.emailDrafts?.filter(draft => draft.automation).length, 1);
});
