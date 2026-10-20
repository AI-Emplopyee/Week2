import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, createEmptyWorkspace, getIssues, getProposedFields } from '../lib/engine.ts';
import { buildShipmentFacts, getComparableShipmentWeights, normalizedShipmentValue, syncShipmentDeclaration } from '../lib/shipment-autofill.ts';
import { getDeclarationEntry } from '../lib/declaration.ts';
import { normalizeGrossWeightCandidates } from '../lib/weight-normalization.ts';
import type { Candidate, WorkspaceState } from '../lib/types.ts';
const actor = { id: 'unit-reviewer', name: 'Unit reviewer', email: 'unit@example.invalid' };
function fixture() { const state = applyAction(createEmptyWorkspace('weight-tests'), { type: 'create_case', title: 'Synthetic shipment totals', caseType: 'import' }, actor); state.cases[0].groupingConfirmed = true; return state; }
function add(state: WorkspaceState, id: string, amount: string, unit?: string, net?: [string, string]) {
  const shipment = state.cases[0], quote = `TOTAL GROSS WEIGHT: ${amount}${unit ? ` ${unit}` : ''}`;
  const netQuote = net ? `TOTAL NET WEIGHT: ${net[0]} ${net[1]}` : '';
  state.documents.push({ id, caseId: shipment.id, name: `${id}.txt`, type: 'packing_list', mime: 'text/plain', size: 100, sha256: id, version: 1, active: true, uploadedAt: '2026-10-15T00:00:00Z', pages: [{ page: 1, text: `${quote}\n${netQuote}`, textSource: 'kimi', documentType: 'packing_list', aiReadability: 'clear' }], extractionPipeline: 'kimi', aiProcessedPages: [1], extractionStatus: 'extracted', synthetic: true });
  const candidate = (field: string, value: string, text: string): Candidate => ({ id: `${id}-${field}`, caseId: shipment.id, documentId: id, documentVersion: 1, field, value, originalText: text, page: 1, location: 'Explicit total', method: 'kimi:synthetic-test', confidence: 'high', readability: 'clear', normalizations: [] });
  state.candidates.push(candidate('grossWeight', amount, quote));
  if (unit) state.candidates.push(candidate('grossWeightUnit', unit, quote));
  if (net) state.candidates.push(candidate('netWeight', net[0], netQuote));
}
test('explicit equivalent gross totals reconcile in kilograms without changing original Kimi records', () => {
  const state = fixture(); add(state, 'kg', '2000', 'KGS'); add(state, 'tonne', '2', 'METRIC TONNES');
  const before = structuredClone(state.candidates), shipment = state.cases[0];
  const facts = buildShipmentFacts(state, shipment);
  assert.equal(facts.grossWeight.status, 'agreed'); assert.equal(facts.grossWeight.value, '2000'); assert.equal(facts.grossWeightUnit.value, 'KG');
  assert.ok(facts.grossWeight.candidates.find(candidate => candidate.documentId === 'tonne')!.normalizations.some(change => change.before === '2' && change.after === '2000' && change.reason.startsWith('weight-unit:')));
  assert.deepEqual(state.candidates, before);
  syncShipmentDeclaration(state, shipment, actor);
  const saved = getDeclarationEntry(shipment.declarationDraft, '1.28')!;
  assert.deepEqual(saved.value, { kind: 'quantity', amount: '2000', unitCode: 'KGM' }); assert.match(saved.basis, /weight-unit:/);
  assert.deepEqual(state.candidates, before);
  assert.ok(saved.provenance.some(proof => proof.kind === 'document' && proof.quote.includes('2 METRIC TONNES')));
  assert.equal(getIssues(state).some(issue => issue.kind === 'conflict' && ['grossWeight', 'grossWeightUnit'].includes(issue.field ?? '')), false);
});
test('unit conversion uses exact decimals beyond JavaScript integer precision', () => {
  const state = fixture(); add(state, 'kg', '9007199254740993001', 'KGM'); add(state, 'tonne', '9007199254740993.001', 'TONNE');
  const facts = buildShipmentFacts(state, state.cases[0]); assert.equal(facts.grossWeight.status, 'agreed'); assert.equal(facts.grossWeight.value, '9007199254740993001');
});
test('true physical weight disagreements survive conversion', () => {
  const state = fixture(); add(state, 'kg', '2001', 'KG'); add(state, 'tonne', '2', 'TONNES');
  assert.equal(buildShipmentFacts(state, state.cases[0]).grossWeight.status, 'conflict');
});
test('missing, unclear, duplicated, cross-page and unknown units block global conversion', () => {
  for (const scenario of ['missing', 'unclear', 'duplicate', 'cross-page', 'unknown', 'unprocessed']) {
    const state = fixture(); add(state, 'kg', '2000', 'KG'); add(state, 'tonne', '2', 'TONNE');
    const unit = state.candidates.find(candidate => candidate.id === 'tonne-grossWeightUnit')!;
    if (scenario === 'unprocessed') state.documents.find(document => document.id === 'tonne')!.aiProcessedPages = [];
    if (scenario === 'missing') state.candidates = state.candidates.filter(candidate => candidate.id !== unit.id);
    if (scenario === 'unclear') unit.confidence = 'low';
    if (scenario === 'duplicate') state.candidates.push({ ...unit, id: 'another-unit' });
    if (scenario === 'cross-page') unit.page = 2;
    if (scenario === 'unknown') unit.value = 'TON';
    assert.equal(buildShipmentFacts(state, state.cases[0]).grossWeight.status, 'conflict', scenario);
    assert.equal(buildShipmentFacts(state, state.cases[0]).grossWeight.candidates.some(candidate => candidate.normalizations.some(change => change.reason.startsWith('weight-unit:'))), false, scenario);
  }
});
test('bare MT, TON and LB are never silently converted; MT needs a metric expansion', () => {
  for (const unit of ['T', 'MT', 'ton', 'TON', 'TONS', 'LB', 'LBS']) {
    const state = fixture(); add(state, 'kg', '2000', 'KG'); add(state, 'other', '2', unit);
    assert.equal(buildShipmentFacts(state, state.cases[0]).grossWeight.status, 'conflict', unit);
  }
  const state = fixture(); add(state, 'kg', '2000', 'KG'); add(state, 'metric', '2', 'MT');
  for (const candidate of state.candidates.filter(candidate => candidate.documentId === 'metric')) candidate.originalText += ' (METRIC TONNES)';
  state.documents.find(document => document.id === 'metric')!.pages[0].text = 'TOTAL GROSS WEIGHT: 2 MT (METRIC TONNES)';
  assert.equal(buildShipmentFacts(state, state.cases[0]).grossWeight.status, 'agreed');
});
test('unit aliases reconcile only when bound to a single current clear total', () => {
  const state = fixture(); add(state, 'kg', '10', 'KILOGRAMS'); add(state, 'code', '10', 'KGM');
  assert.equal(buildShipmentFacts(state, state.cases[0]).grossWeightUnit.value, 'KG');
  const raw = structuredClone(state.candidates); raw.push({ ...raw[0], id: 'second-total', value: '11' });
  assert.deepEqual(normalizeGrossWeightCandidates(raw, () => true), raw);
});
test('net versus gross uses explicit physical units and skips unknown or manually changed values', () => {
  const state = fixture(); add(state, 'total', '2', 'TONNES', ['1500', 'KG']);
  const shipment = state.cases[0], proposed = getProposedFields(state, shipment.id);
  const weights = getComparableShipmentWeights(state, shipment, proposed)!;
  assert.equal(weights.gross.coefficient, BigInt(2000)); assert.equal(weights.net.coefficient, BigInt(1500));
  assert.equal(getIssues(state).some(issue => issue.id.endsWith(':weight')), false);
  assert.equal(getComparableShipmentWeights(state, shipment, { ...proposed, netWeight: '2500' }), undefined);
  state.candidates.find(candidate => candidate.field === 'netWeight')!.originalText = 'TOTAL NET WEIGHT: 1500';
  state.documents[0].pages[0].text += '\nTOTAL NET WEIGHT: 1500';
  assert.equal(getComparableShipmentWeights(state, shipment, proposed), undefined);
  state.candidates.find(candidate => candidate.field === 'netWeight')!.originalText = 'TOTAL NET WEIGHT: 1500 KG; DIFFERENT WEIGHT: 1500 TON';
  state.documents[0].pages[0].text += '\nTOTAL NET WEIGHT: 1500 KG; DIFFERENT WEIGHT: 1500 TON';
  assert.equal(getComparableShipmentWeights(state, shipment, proposed), undefined);
});
test('a net total greater than gross still raises a factual issue when both units are explicit', () => {
  const state = fixture(); add(state, 'total', '2', 'TONNES', ['2500', 'KG']);
  const issue = getIssues(state).find(issue => issue.id.endsWith(':weight'));
  assert.ok(issue); assert.match(issue.description, /2500 kg; cả bì 2000 kg/);
});
test('net units cannot be borrowed from gross or another page', () => {
  const state = fixture(); add(state, 'total', '2', 'TONNES', ['1500', 'TON']);
  assert.equal(getComparableShipmentWeights(state, state.cases[0], getProposedFields(state, state.cases[0].id)), undefined);
});
test('port comparison ignores comma spacing only and retains different letters and word boundaries', () => {
  assert.equal(normalizedShipmentValue('portOfLoading', 'CITY, COUNTRY'), normalizedShipmentValue('portOfLoading', 'CITY,COUNTRY'));
  assert.equal(normalizedShipmentValue('portOfDischarge', 'CITY , COUNTRY'), normalizedShipmentValue('portOfDischarge', 'CITY,COUNTRY'));
  assert.notEqual(normalizedShipmentValue('portOfLoading', 'CITY A, COUNTRY'), normalizedShipmentValue('portOfLoading', 'CITY B,COUNTRY'));
  assert.notEqual(normalizedShipmentValue('portOfLoading', 'NEW PORT, COUNTRY'), normalizedShipmentValue('portOfLoading', 'NEWPORT,COUNTRY'));
  assert.notEqual(normalizedShipmentValue('invoiceNumber', 'ABC, 123'), normalizedShipmentValue('invoiceNumber', 'ABC,123'));
});


test('a unit in a table heading can bind to its sole clear same-page gross total with separate quotes', () => {
  const state = fixture(); add(state, 'kg', '2000', 'KG'); add(state, 'table', '2', 'TONNES');
  state.candidates.find(candidate => candidate.id === 'table-grossWeight')!.originalText = 'TOTAL GROSS WEIGHT: 2';
  state.candidates.find(candidate => candidate.id === 'table-grossWeightUnit')!.originalText = 'GROSS WEIGHT (TONNES)';
  state.documents.find(document => document.id === 'table')!.pages[0].text = 'GROSS WEIGHT (TONNES)\nTOTAL GROSS WEIGHT: 2';
  const facts = buildShipmentFacts(state, state.cases[0]);
  assert.equal(facts.grossWeight.status, 'agreed'); assert.equal(facts.grossWeight.value, '2000'); assert.equal(facts.grossWeightUnit.value, 'KG');
});


test('the exact lowercase SI tonne symbol reconciles with kilograms even in a separate table heading', () => {
  const state = fixture(); add(state, 'kilograms', '2375', 'KGS'); add(state, 'tonne-symbol', '2.375', 't');
  state.candidates.find(candidate => candidate.id === 'tonne-symbol-grossWeight')!.originalText = 'TOTAL GROSS WEIGHT: 2.375';
  state.candidates.find(candidate => candidate.id === 'tonne-symbol-grossWeightUnit')!.originalText = 'GROSS WEIGHT (t)';
  state.documents.find(document => document.id === 'tonne-symbol')!.pages[0].text = 'GROSS WEIGHT (t)\nTOTAL GROSS WEIGHT: 2.375';
  const facts = buildShipmentFacts(state, state.cases[0]);
  assert.equal(facts.grossWeight.status, 'agreed'); assert.equal(facts.grossWeight.value, '2375'); assert.equal(facts.grossWeightUnit.value, 'KG');
  assert.ok(facts.grossWeight.candidates.some(candidate => candidate.normalizations.some(change => change.before === '2.375' && change.after === '2375')));
  assert.equal(state.candidates.find(candidate => candidate.id === 'tonne-symbol-grossWeightUnit')!.value, 't');
});
test('quoted net-weight tonne symbols retain their case and uppercase T is not converted', () => {
  const state = fixture(); add(state, 'totals', '3', 't', ['2', 't']);
  const weights = getComparableShipmentWeights(state, state.cases[0], getProposedFields(state, state.cases[0].id))!;
  assert.equal(weights.gross.coefficient, BigInt(3000)); assert.equal(weights.net.coefficient, BigInt(2000));
  state.candidates.find(candidate => candidate.field === 'netWeight')!.originalText = 'TOTAL NET WEIGHT: 2 T';
  state.documents[0].pages[0].text += '\nTOTAL NET WEIGHT: 2 T';
  assert.equal(getComparableShipmentWeights(state, state.cases[0], getProposedFields(state, state.cases[0].id)), undefined);
});
