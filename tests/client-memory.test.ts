import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, createEmptyWorkspace } from '../lib/engine.ts';
import { emptyDeclarationValue, getDeclarationEntry } from '../lib/declaration.ts';
import { ecusFormValue, ecusFormValueUpdate, getEcusFormField } from '../lib/ecus-form.ts';
import { getClientIdentity, getClientMemorySuggestions, matchClientIdentity } from '../lib/client-memory.ts';
import { applyCorrespondenceAction, syncAutomaticQuestionDrafts } from '../lib/shipment-correspondence.ts';
import { parseMutation } from '../lib/server-validation.ts';
import type { SaveDeclarationFieldAction } from '../lib/declaration-types.ts';
import type { Actor, Issue, ShipmentCase, WorkspaceState } from '../lib/types.ts';
const actor: Actor = { id: 'memory-reviewer', name: 'Memory reviewer', email: 'reviewer@example.invalid' };
const act = (state: WorkspaceState, action: Parameters<typeof applyAction>[1]) => applyAction(state, action, actor);
function seed(shipment: ShipmentCase, key: string, value: string) {
  const field = getEcusFormField(key)!;
  shipment.declarationDraft!.fields.push({ fieldId: field.fieldId, value: ecusFormValueUpdate(field, emptyDeclarationValue(field.fieldId), value), applicability: 'applicable', basis: 'Fixture known value.', provenance: [{ kind: 'manual', note: 'Fixture identity.' }], reason: 'Fixture only.', review: null, stale: false, updatedBy: actor.id, updatedAt: '2026-10-15T00:00:00Z', codeVerification: 'unverified' });
}
function fixture() {
  let state = createEmptyWorkspace('memory-workspace');
  for (const title of ['Earlier client shipment', 'Next client shipment', 'Third client shipment']) state = act(state, { type: 'create_case', title, caseType: 'import' });
  for (const shipment of state.cases) {
    seed(shipment, 'importerCode', '0312345678'); seed(shipment, 'importer', 'CLIENT JOINT STOCK COMPANY'); seed(shipment, 'importerAddress', '12 Main Street, City');
  }
  return state;
}
function save(state: WorkspaceState, index: number, key: string, value: string, override: Partial<SaveDeclarationFieldAction> = {}) {
  const shipment = state.cases[index], field = getEcusFormField(key)!;
  return act(state, { type: 'save_declaration_field', caseId: shipment.id, fieldId: field.fieldId, applicability: 'applicable',
    value: ecusFormValueUpdate(field, emptyDeclarationValue(field.fieldId), value), basis: 'Customer confirmed their company registration details outside the attached files.',
    provenance: [{ kind: 'manual', note: 'Human customer instruction.' }], reason: 'Confirmed with this client by telephone.', review: false, ...override });
}
const current = (state: WorkspaceState, index: number, key: string) => ecusFormValue(getEcusFormField(key)!, state.cases[index].declarationDraft);

test('explicit stable human additions are remembered with origin, previous value and client scope', () => {
  let state = fixture(); seed(state.cases[0], 'importerTelephone', '000');
  state = save(state, 0, 'importerTelephone', '+84 28 1234 5678');
  const memory = state.clientMemories![0];
  assert.equal(memory.previousValue, '000'); assert.equal(memory.value, '+84 28 1234 5678'); assert.equal(memory.sourceCaseId, state.cases[0].id);
  assert.equal(memory.createdBy.id, actor.id); assert.equal(memory.origin, 'human_correction'); assert.equal(memory.status, 'active');
  assert.equal(memory.reason, 'Confirmed with this client by telephone.'); assert.ok(state.audit.some(entry => entry.action === 'client_memory_recorded'));
  assert.equal(current(state, 1, 'importerTelephone'), ''); assert.equal(state.clientMemories!.length, 1);
  const suggestions = getClientMemorySuggestions(state, state.cases[1]);
  assert.equal(suggestions.length, 1); assert.equal(suggestions[0].match, 'importer_code'); assert.equal(suggestions[0].conflictsWithCurrent, false);
});
test('the source case and unchanged saves do not repeat their own memory', () => {
  let state = save(fixture(), 0, 'importerPostalCode', '70000');
  state = save(state, 0, 'importerPostalCode', '70000');
  assert.equal(state.clientMemories!.length, 1); assert.equal(getClientMemorySuggestions(state, state.cases[0]).length, 0);
});
test('company identity requires matching IDs or exact names plus addresses', () => {
  const identity = { importerCode: '123', name: 'CLIENT LTD', address: '12 MAIN STREET' };
  assert.equal(matchClientIdentity(identity, { ...identity, importerCode: '456' }), undefined);
  assert.equal(matchClientIdentity(identity, { ...identity, importerCode: '' }), 'name_and_address');
  assert.equal(matchClientIdentity(identity, { ...identity, importerCode: '', address: '13 MAIN STREET' }), undefined);
  assert.equal(matchClientIdentity(identity, { ...identity, importerCode: '', name: 'SIMILAR CLIENT LTD' }), undefined);
  assert.equal(matchClientIdentity({ ...identity, importerCode: '', address: '' }, { ...identity, importerCode: '', address: '' }), undefined);
});
test('conflicting client IDs block suggestions even when company name and address match', () => {
  const state = save(fixture(), 0, 'importerPostalCode', '70000');
  getDeclarationEntry(state.cases[1].declarationDraft, '1.12')!.value = { kind: 'code', code: '0999999999' };
  assert.equal(getClientMemorySuggestions(state, state.cases[1]).length, 0);
});
test('missing IDs permit punctuation and whitespace normalization of a corroborating address only', () => {
  let state = fixture();
  for (const shipment of state.cases) shipment.declarationDraft!.fields = shipment.declarationDraft!.fields.filter(entry => entry.fieldId !== '1.12');
  getDeclarationEntry(state.cases[1].declarationDraft, '1.15')!.value = { kind: 'text', text: '12 MAIN STREET\nCITY' };
  state = save(state, 0, 'importerPostalCode', '70000');
  assert.equal(getClientMemorySuggestions(state, state.cases[1])[0].match, 'name_and_address');
  getDeclarationEntry(state.cases[1].declarationDraft, '1.13')!.value = { kind: 'entity', name: 'CLIENT JOINT STOCK COMPANI' };
  assert.equal(getClientMemorySuggestions(state, state.cases[1]).length, 0);
});
test('insufficient, stale or malformed company identity cannot capture or reuse knowledge', () => {
  let state = fixture();
  state.cases[0].declarationDraft!.fields = state.cases[0].declarationDraft!.fields.filter(entry => entry.fieldId === '1.13');
  assert.equal(getClientIdentity(state.cases[0]), undefined);
  state = save(state, 0, 'importerTelephone', '12345'); assert.equal(state.clientMemories, undefined);
  const next = save(fixture(), 0, 'importerTelephone', '12345');
  getDeclarationEntry(next.cases[1].declarationDraft, '1.12')!.value = { kind: 'code', code: '?' };
  assert.equal(getClientMemorySuggestions(next, next.cases[1]).length, 0);
  getDeclarationEntry(next.cases[0].declarationDraft, '1.16')!.stale = true;
  assert.equal(getClientMemorySuggestions(next, next.cases[2]).length, 0);
});
test('shipment, supplier and tax data are not learned as client defaults', () => {
  let state = fixture();
  state = save(state, 0, 'invoiceNumber', 'INV-123'); state = save(state, 0, 'exporter', 'DIFFERENT SUPPLIER LTD'); state = save(state, 0, 'partyClassification', '4');
  assert.equal(state.clientMemories, undefined);
});
test('a saved fact without a manual source never creates client memory', () => {
  const state = save(fixture(), 0, 'importerTelephone', '12345', { provenance: [] });
  assert.equal(state.clientMemories, undefined);
});
test('explicit apply checks the current value and leaves a human source with review still pending', () => {
  let state = save(fixture(), 0, 'importerTelephone', '12345');
  seed(state.cases[1], 'importerTelephone', '98765');
  const memory = state.clientMemories![0], caseId = state.cases[1].id;
  assert.equal(getClientMemorySuggestions(state, state.cases[1])[0].conflictsWithCurrent, true);
  assert.throws(() => act(state, { type: 'apply_client_memory', caseId, memoryId: memory.id, expectedValue: '' }), /changed/);
  state = act(state, { type: 'apply_client_memory', caseId, memoryId: memory.id, expectedValue: '98765' });
  const entry = getDeclarationEntry(state.cases[1].declarationDraft, '1.16')!;
  assert.equal(current(state, 1, 'importerTelephone'), '12345'); assert.equal(entry.review, null); assert.equal(entry.generatedBy, undefined);
  assert.equal(entry.provenance[0].kind, 'manual'); assert.equal(state.cases[1].approval, undefined);
  assert.equal(state.clientMemories!.length, 1); assert.equal(getClientMemorySuggestions(state, state.cases[1]).length, 0);
  assert.ok(state.audit.some(entry => entry.action === 'client_memory_applied'));
});
test('dismissal is shipment-specific and forgetting revokes future suggestions', () => {
  let state = save(fixture(), 0, 'importerTelephone', '12345');
  const memoryId = state.clientMemories![0].id;
  state = act(state, { type: 'dismiss_client_memory', caseId: state.cases[1].id, memoryId });
  assert.equal(getClientMemorySuggestions(state, state.cases[1]).length, 0); assert.equal(getClientMemorySuggestions(state, state.cases[2]).length, 1);
  state = act(state, { type: 'revoke_client_memory', caseId: state.cases[2].id, memoryId });
  assert.equal(state.clientMemories![0].status, 'revoked'); assert.equal(getClientMemorySuggestions(state, state.cases[2]).length, 0);
});
test('later changes revoke a source correction from suggestion eligibility without erasing its history', () => {
  let state = save(fixture(), 0, 'importerTelephone', '12345');
  state = save(state, 0, 'importerTelephone', '67890');
  assert.equal(state.clientMemories!.length, 2);
  assert.deepEqual(getClientMemorySuggestions(state, state.cases[1]).map(suggestion => suggestion.memory.value), ['67890']);
});
test('memory actions validate their API payload and reject cross-client application', () => {
  const state = save(fixture(), 0, 'importerTelephone', '12345');
  const action = { type: 'apply_client_memory', caseId: state.cases[1].id, memoryId: state.clientMemories![0].id, expectedValue: '' } as const;
  assert.deepEqual(parseMutation({ revision: state.revision, action }).action, action);
  assert.throws(() => parseMutation({ revision: state.revision, action: { ...action, expectedValue: undefined } }));
  getDeclarationEntry(state.cases[1].declarationDraft, '1.12')!.value = { kind: 'code', code: '0999999999' };
  assert.throws(() => act(state, action), /changed/);
  assert.throws(() => act(state, { type: 'revoke_client_memory', caseId: state.cases[1].id, memoryId: action.memoryId }), /current client/);
});
test('a pending remembered answer blocks email approval until it is applied or dismissed', () => {
  let state = save(fixture(), 0, 'importerTelephone', '12345');
  const shipment = state.cases[1]; shipment.groupingConfirmed = true;
  state.documents.push({ id: 'memory-source-doc', caseId: shipment.id, name: 'Synthetic.pdf', type: 'invoice', mime: 'application/pdf', size: 1, sha256: 'a'.repeat(64), version: 1, active: true, uploadedAt: '2026-10-15T00:00:00Z', pages: [{ page: 1, text: '', aiReadability: 'clear', textSource: 'kimi' }], extractionPipeline: 'kimi', aiProcessedPages: [1], extractionStatus: 'extracted', synthetic: true });
  const issue: Issue = { id: `${shipment.id}:telephone:required`, caseId: shipment.id, kind: 'missing', severity: 'error', title: 'Telephone needed', description: 'Synthetic required client fact', field: '1.16', ecusFieldKey: 'importerTelephone', candidateIds: [], documentIds: [], resolved: false, fingerprint: 'missing-telephone' };
  syncAutomaticQuestionDrafts(state, actor, [issue], 'en', shipment.id);
  let draft = state.emailDrafts!.find(item => item.caseId === shipment.id)!; draft.recipient = 'client@example.invalid'; draft.recipientSource = 'manual';
  assert.deepEqual(draft.automation!.pendingClientMemoryIds, [state.clientMemories![0].id]); assert.match(draft.body, /telephone/i);
  assert.throws(() => applyCorrespondenceAction(state, { type: 'approve_email_draft', draftId: draft.id }, actor, [issue]), /remembered client information/);
  state = act(state, { type: 'dismiss_client_memory', caseId: shipment.id, memoryId: state.clientMemories![0].id });
  syncAutomaticQuestionDrafts(state, actor, [issue], 'en', shipment.id);
  draft = state.emailDrafts!.find(item => item.caseId === shipment.id)!;
  assert.deepEqual(draft.automation!.pendingClientMemoryIds, []);
  applyCorrespondenceAction(state, { type: 'approve_email_draft', draftId: draft.id }, actor, [issue]);
  assert.ok(draft.approval); assert.match(draft.body, /telephone/i);
});


test('an exact pre-correction name and address can recall a corrected address when the client ID is absent', () => {
  let state = fixture();
  for (const shipment of state.cases) shipment.declarationDraft!.fields = shipment.declarationDraft!.fields.filter(entry => entry.fieldId !== '1.12');
  state = save(state, 0, 'importerAddress', '34 New Street, City');
  const suggestion = getClientMemorySuggestions(state, state.cases[1])[0];
  assert.equal(suggestion.memory.value, '34 New Street, City'); assert.equal(suggestion.match, 'name_and_address');
  assert.equal(suggestion.memory.identityAliases![0].importerCode, '');
  getDeclarationEntry(state.cases[2].declarationDraft, '1.15')!.value = { kind: 'text', text: '98 Unrelated Street, City' };
  assert.equal(getClientMemorySuggestions(state, state.cases[2]).length, 0);
});
test('exact prior name/address recalls a corrected legal name, but conflicting importer codes still block aliases', () => {
  let state = fixture();
  state = save(state, 0, 'importer', 'CLIENT REGISTERED JOINT STOCK COMPANY');
  state.cases[1].declarationDraft!.fields = state.cases[1].declarationDraft!.fields.filter(entry => entry.fieldId !== '1.12');
  assert.equal(getClientMemorySuggestions(state, state.cases[1])[0].memory.value, 'CLIENT REGISTERED JOINT STOCK COMPANY');
  getDeclarationEntry(state.cases[2].declarationDraft, '1.12')!.value = { kind: 'code', code: '0999999999' };
  assert.equal(getClientMemorySuggestions(state, state.cases[2]).length, 0);
});
test('a correction of an importer code never records a former code as an alias', () => {
  const state = save(fixture(), 0, 'importerCode', '0999999999');
  assert.equal(state.clientMemories![0].identityAliases, undefined);
  assert.equal(getClientMemorySuggestions(state, state.cases[1]).length, 0);
});


test('only the newest matching correction is suggested; already used or dismissed values never revive older facts', () => {
  let state = save(fixture(), 0, 'importerTelephone', '11111');
  state = save(state, 1, 'importerTelephone', '22222');
  state.clientMemories![0].createdAt = '2026-10-14T00:00:00Z';
  state.clientMemories![1].createdAt = '2026-10-15T00:00:00Z';
  assert.deepEqual(getClientMemorySuggestions(state, state.cases[2]).map(item => item.memory.value), ['22222']);
  seed(state.cases[2], 'importerTelephone', '22222');
  assert.equal(getClientMemorySuggestions(state, state.cases[2]).length, 0);
  state.cases[2].declarationDraft!.fields = state.cases[2].declarationDraft!.fields.filter(entry => entry.fieldId !== '1.16');
  state = act(state, { type: 'dismiss_client_memory', caseId: state.cases[2].id, memoryId: state.clientMemories![1].id });
  assert.equal(getClientMemorySuggestions(state, state.cases[2]).length, 0);
  assert.equal(getClientMemorySuggestions(state, state.cases[1]).length, 0);
});
