import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, getIssues } from '../lib/engine.ts';
import { getDeclarationEntry } from '../lib/declaration.ts';
import { buildShipmentFacts, syncShipmentDeclaration } from '../lib/shipment-autofill.ts';
import type { Actor, Candidate, ReviewedValue, ShipmentCase, WorkspaceState } from '../lib/types.ts';

const actor: Actor = { id: 'reviewer', name: 'Synthetic reviewer', email: 'reviewer@example.invalid' };
const at = '2026-10-16T00:00:00.000Z';
function fixture() {
  const state = createEmptyWorkspace('stale-source-tests');
  const shipment: ShipmentCase = {
    id: 'shipment', reference: 'SYNTHETIC', title: 'Synthetic', status: 'review', caseType: 'import',
    assignedTo: actor.name, createdAt: at, updatedAt: at, documentIds: [], fields: {}, goods: [],
    groupingConfidence: 'high', groupingReason: 'Synthetic sources', groupingConfirmed: true,
    synthetic: true, resolutions: [], declarationDraft: { schemaVersion: 1, fields: [] },
  };
  state.cases.push(shipment);
  return { state, shipment };
}
function source(state: WorkspaceState, shipment: ShipmentCase, field: string, value: string, id = `${field}-current`) {
  const documentId = `${id}-document`, quote = `${field}: ${value}`;
  const candidate: Candidate = {
    id, caseId: shipment.id, documentId, documentVersion: 1, field, value, originalText: quote,
    page: 1, location: 'Page 1', method: 'kimi:test:source_text_proposal', confidence: 'high',
    readability: 'clear', normalizations: [],
  };
  state.documents.push({
    id: documentId, caseId: shipment.id, name: `${documentId}.txt`, type: 'invoice', mime: 'text/plain',
    size: quote.length, sha256: documentId, version: 1, active: true, uploadedAt: at,
    extractionPipeline: 'kimi', aiProcessedPages: [1], aiStatus: 'completed',
    pages: [{ page: 1, text: quote, textSource: 'kimi', aiReadability: 'clear', documentType: 'invoice' }],
    extractionStatus: 'extracted', synthetic: true,
  });
  shipment.documentIds.push(documentId);
  state.candidates.push(candidate);
  return candidate;
}
function selection(state: WorkspaceState, shipment: ShipmentCase, current: Candidate, value: string, method = 'browser_local_ocr + contextual_bilingual_label') {
  const old: Candidate = { ...current, id: `${current.id}-old`, value, method, originalText: `Historical source: ${value}` };
  state.candidates.push(old);
  const reviewed: ReviewedValue = { value, source: 'candidate', candidateId: old.id, reason: 'Original reviewer source selection.', reviewedBy: 'Original reviewer', reviewedAt: at, stale: true, unverified: false };
  shipment.fields[current.field] = reviewed;
  return { old, reviewed };
}
const retirements = (state: WorkspaceState) => state.audit.filter(entry => entry.action === 'source_selection_superseded');

test('clear current Kimi evidence retires obsolete legacy header selections with the complete old decision in audit', () => {
  const { state, shipment } = fixture();
  const fields = [['importer', 'SYNTHETIC BUYER LTD', 'SYNTHETIC 8UYER LTD', '1.13'], ['contractNumber', 'CONTRACT-1', 'CONTRACT-1', 'ecus.contractNumber'], ['portOfDischarge', 'LOTUS PORT,VIETNAM', 'LOTUS PORT, VIET NAM', '1.33']];
  const before = new Map<string, ReviewedValue>();
  for (const [field, current, previous] of fields) before.set(field, structuredClone(selection(state, shipment, source(state, shipment, field, current), previous).reviewed));
  const evidence = structuredClone(state.candidates), documents = structuredClone(state.documents);
  syncShipmentDeclaration(state, shipment, actor);
  for (const [field, , , fieldId] of fields) {
    assert.equal(shipment.fields[field], undefined);
    const audit = retirements(state).find(entry => entry.field === field)!;
    assert.deepEqual(audit.before, before.get(field));
    assert.equal((audit.after as {selection: string}).selection, 'automatic_evidence');
    const entry = getDeclarationEntry(shipment.declarationDraft, fieldId)!;
    assert.equal(entry.generatedBy, 'shipment_extraction');
    assert.equal(entry.review, null, 'Automatic replacement must not impersonate a reviewer.');
    assert.equal(entry.stale, false);
    assert.ok(!getIssues(state, shipment.id).some(issue => issue.id === `${shipment.id}:stale-${field}`));
  }
  assert.deepEqual(state.candidates, evidence);
  assert.deepEqual(state.documents, documents);
  const after = structuredClone(state);
  syncShipmentDeclaration(state, shipment, actor);
  assert.deepEqual(state, after, 'Repeating synchronization must not create duplicate retirements.');
});

test('a retired legacy source can be identified from its original replacement audit', () => {
  const { state, shipment } = fixture();
  const { old, reviewed } = selection(state, shipment, source(state, shipment, 'contractNumber', 'CURRENT-1'), 'OLD-1');
  state.candidates = state.candidates.filter(candidate => candidate.id !== old.id);
  state.audit.push({ id: 'prior-replacement', caseId: shipment.id, actor: actor.name, at, action: 'ai_source_evidence_replaced', reason: 'Prior reread', before: [old], after: [] });
  syncShipmentDeclaration(state, shipment, actor);
  assert.equal(shipment.fields.contractNumber, undefined);
  assert.deepEqual(retirements(state)[0].before, reviewed);
  assert.deepEqual(state.audit[0].before, [old]);
});

test('unknown or mismatched historical source identity cannot justify changing a different saved value', () => {
  for (const mismatch of ['missing', 'wrong-field', 'wrong-case', 'changed-value']) {
    const { state, shipment } = fixture();
    const { old, reviewed } = selection(state, shipment, source(state, shipment, 'contractNumber', 'CURRENT-1'), 'OLD-1');
    if (mismatch === 'missing') state.candidates = state.candidates.filter(candidate => candidate.id !== old.id);
    if (mismatch === 'wrong-field') old.field = 'invoiceNumber';
    if (mismatch === 'wrong-case') old.caseId = 'other';
    if (mismatch === 'changed-value') old.value = 'NOT-THE-SELECTED-VALUE';
    syncShipmentDeclaration(state, shipment, actor);
    assert.deepEqual(shipment.fields.contractNumber, reviewed, mismatch);
    assert.equal(retirements(state).length, 0, mismatch);
  }
});

test('a prior Kimi selection can retire an equivalent value or a corroborated typography variant', () => {
  const { state, shipment } = fixture();
  const left = source(state, shipment, 'importer', 'SYNTHETIC BUYER LTD', 'left');
  const right = source(state, shipment, 'importer', 'SYNTHETICBUYER LTD', 'right');
  for (const name of [left, right]) {
    const address: Candidate = { ...name, id: `${name.id}-address`, field: 'importerAddress', value: '12 Example Road', originalText: 'Address: 12 Example Road' };
    state.candidates.push(address);
    state.documents.find(document => document.id === name.documentId)!.pages[0].text += `\n${address.originalText}`;
  }
  const fact = buildShipmentFacts(state, shipment).importer;
  const projected = fact.candidates.find(candidate => candidate.normalizations.some(change => change.reason.startsWith('party-typography:')))!;
  assert.ok(projected, 'Fixture must exercise a changed display spelling.');
  shipment.fields.importer = { value: projected.normalizations[0].before, source: 'candidate', candidateId: projected.id, reason: 'Earlier source selected', reviewedBy: actor.name, reviewedAt: at, stale: true, unverified: false };
  syncShipmentDeclaration(state, shipment, actor);
  assert.equal(shipment.fields.importer, undefined);
  assert.match(retirements(state)[0].reason, /semantically equivalent/);
  const same = source(state, shipment, 'contractNumber', 'CONTRACT-1');
  shipment.fields.contractNumber = { value: same.value, source: 'candidate', candidateId: 'no-longer-available', reason: 'Earlier source selected', reviewedBy: actor.name, reviewedAt: at, stale: true, unverified: false };
  syncShipmentDeclaration(state, shipment, actor);
  assert.equal(shipment.fields.contractNumber, undefined);
});

test('materially different previous Kimi choices and explicit manual corrections stay local', () => {
  for (const mode of ['kimi', 'manual', 'transcription', 'unknown-reader', 'user-supplied', 'current', 'unverified']) {
    const { state, shipment } = fixture();
    const { old, reviewed } = selection(state, shipment, source(state, shipment, 'contractNumber', 'CURRENT-1'), 'OLD-1');
    if (mode === 'kimi') { old.method = 'kimi:previous-reader'; state.candidates = state.candidates.filter(candidate => candidate.id !== old.id); state.audit.push({ id: 'old', caseId: shipment.id, at, actor: actor.name, action: 'ai_source_evidence_replaced', reason: 'Prior source', before: [old] }); }
    if (mode === 'manual') reviewed.source = 'manual';
    if (mode === 'transcription') old.method = 'manual_transcription + contextual_bilingual_label';
    if (mode === 'unknown-reader') old.method = 'unknown_reader';
    if (mode === 'user-supplied') old.method = 'user_supplied';
    if (mode === 'current') reviewed.stale = false;
    if (mode === 'unverified') reviewed.unverified = true;
    const before = structuredClone(reviewed);
    syncShipmentDeclaration(state, shipment, actor);
    assert.deepEqual(shipment.fields.contractNumber, before, mode);
    assert.equal(retirements(state).length, 0, mode);
  }
});

test('conflicting, uncertain, unread or missing current evidence cannot retire a legacy choice', () => {
  for (const mode of ['conflict', 'uncertain', 'low', 'unread', 'missing']) {
    const { state, shipment } = fixture();
    const current = source(state, shipment, 'contractNumber', 'CURRENT-1');
    const { reviewed } = selection(state, shipment, current, 'OLD-1');
    if (mode === 'conflict') source(state, shipment, 'contractNumber', 'CURRENT-2', 'second');
    if (mode === 'uncertain') current.readability = 'uncertain';
    if (mode === 'low') current.confidence = 'low';
    if (mode === 'unread') state.documents[0].aiProcessedPages = [];
    if (mode === 'missing') state.candidates = state.candidates.filter(candidate => candidate.id !== current.id);
    syncShipmentDeclaration(state, shipment, actor);
    assert.deepEqual(shipment.fields.contractNumber, reviewed, mode);
    assert.equal(retirements(state).length, 0, mode);
  }
});

test('approved and completed shipments remain byte-for-byte unchanged', () => {
  for (const mode of ['approved', 'completed', 'approval-marker'] as const) {
    const { state, shipment } = fixture();
    selection(state, shipment, source(state, shipment, 'contractNumber', 'CURRENT-1'), 'OLD-1');
    if (mode === 'approval-marker') shipment.approval = {actor: actor.name, at, snapshotId: 'snapshot'};
    else shipment.status = mode;
    const before = structuredClone(state);
    syncShipmentDeclaration(state, shipment, actor);
    assert.deepEqual(state, before, mode);
  }
});

test('retiring a source-panel choice never overwrites a separate manual declaration entry or another shipment', () => {
  const { state, shipment } = fixture();
  selection(state, shipment, source(state, shipment, 'contractNumber', 'CURRENT-1'), 'OLD-1');
  shipment.declarationDraft!.fields.push({ fieldId: 'ecus.contractNumber', applicability: 'applicable', basis: 'Manual correction', value: {kind: 'text', text: 'MANUAL-CONTRACT'}, provenance: [{kind: 'manual', note: 'Explicit user correction'}], reason: 'Keep manual correction', review: null, stale: false, updatedBy: actor.id, updatedAt: at, codeVerification: 'unverified' });
  const manual = structuredClone(shipment.declarationDraft!.fields[0]);
  const unrelated = structuredClone(shipment); unrelated.id = 'unrelated'; state.cases.push(unrelated);
  const otherBefore = structuredClone(unrelated);
  syncShipmentDeclaration(state, shipment, actor);
  assert.equal(shipment.fields.contractNumber, undefined);
  assert.deepEqual(getDeclarationEntry(shipment.declarationDraft, 'ecus.contractNumber')!.value, manual.value);
  assert.deepEqual(getDeclarationEntry(shipment.declarationDraft, 'ecus.contractNumber')!.provenance, manual.provenance);
  assert.deepEqual(unrelated, otherBefore);
});
