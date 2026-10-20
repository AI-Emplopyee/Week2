import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeValue } from '../lib/extraction.ts';
import { groundKimiProposals } from '../lib/kimi.ts';
import { applyAction, createEmptyWorkspace } from '../lib/engine.ts';
import { ECUS_FORM_FIELDS, ecusFormValue } from '../lib/ecus-form.ts';
import { getDeclarationEntry } from '../lib/declaration.ts';
import { isShipmentFactClear } from '../lib/shipment-autofill.ts';
import type { AiSourceProposal, ShipmentDocument } from '../lib/types.ts';

const proposal = (field: string, value: string, overrides: Partial<AiSourceProposal> = {}): AiSourceProposal => ({ field, value, quote: `${field}: ${value}`, page: 1, rowIndex: 1, confidence: 'high', readability: 'clear', evidence: 'text', ...overrides });
function source(proposals: AiSourceProposal[]): ShipmentDocument {
  return { id: 'numeric-doc', caseId: 'numeric-case', version: 1, name: 'synthetic-invoice.txt', mime: 'text/plain', size: 1, sha256: 'synthetic', active: true, synthetic: true, uploadedAt: '', type: 'invoice', extractionStatus: 'extracted', extractionPipeline: 'kimi', pages: [...new Set(proposals.map(p => p.page))].map(page => ({ page, text: proposals.filter(p => p.page === page).map(p => p.quote).join('\n'), documentType: 'invoice', aiReadability: 'clear' })) };
}
function ground(proposals: AiSourceProposal[], doc = source(proposals)) { return groundKimiProposals(doc, doc.pages, proposals, 'synthetic-numeric-model'); }

test('explicit number punctuation preserves printed precision and rejects malformed grouping', () => {
  for (const [raw, expected] of [['9.876,54', '9876.54'], ['9,876.54', '9876.54'], ['321,09', '321.09'], ['0,1250', '0.1250'], ['1.234.567', '1234567'], ['1,234,567', '1234567']]) {
    const normalized = normalizeValue('unitPrice', raw);
    assert.equal(normalized.value, expected); assert.equal(normalized.confidence, 'high');
    assert.equal(normalized.normalizations[0].before, raw);
  }
  for (const raw of ['1,234', '1.234', '001.234', '1.23,45', '1,23.45', '1,234,56', '12 34,56', 'USD 1,23', '-1,23', '1e3', '']) assert.notEqual(normalizeValue('quantity', raw).confidence, 'high', raw);
  for (const raw of ['0.125', '1234.567', '12.50']) assert.equal(normalizeValue('quantity', raw).confidence, 'high', raw);
  assert.equal(normalizeValue('quantity', '0,125').value, '0.125');
  assert.equal(normalizeValue('invoiceNumber', '1.234,56').value, '1.234,56', 'Identifiers are never numeric-normalized.');
});

test('same-row explicit decimal notation resolves quantity while keeping original evidence and printed prices', () => {
  const proposals = [proposal('quantity', '3,000'), proposal('unitPrice', '1.234,57'), proposal('amount', '3.703,70')];
  const result = ground(proposals);
  assert.equal(result.rejected, 0);
  assert.deepEqual(result.candidates.map(c => c.value), ['3.000', '1234.57', '3703.70']);
  assert.ok(result.candidates.every(c => c.confidence === 'high'));
  assert.deepEqual(result.candidates.map(c => c.originalText), proposals.map(p => p.quote));
  assert.match(result.candidates[0].normalizations[0].reason, /Original page 1, goods row 1/);
  assert.match(result.candidates[0].normalizations[0].reason, /unitPrice="1.234,57"/);
  assert.equal(ground([...proposals].reverse()).candidates.find(c => c.field === 'quantity')!.value, '3.000', 'Proposal order cannot select a locale.');
  assert.equal(ground([proposal('quantity', '3,000'), proposal('unitPrice', '12.50')]).candidates[0].value, '3000');
});

test('different rows, pages, uncertain sources, rejected proofs and conflicting notation cannot resolve ambiguity', () => {
  const quantity = proposal('quantity', '3,000');
  const anchor = proposal('unitPrice', '1.234,57');
  const alternatives = [
    [quantity],
    [quantity, { ...anchor, rowIndex: 2 }],
    [quantity, { ...anchor, page: 2 }],
    [quantity, { ...anchor, confidence: 'medium' as const }],
    [quantity, { ...anchor, readability: 'uncertain' as const }],
    [quantity, { ...anchor, quote: 'unitPrice: not supplied' }],
    [quantity, anchor, proposal('amount', '3,703.70')],
  ];
  for (const proposals of alternatives) {
    const value = ground(proposals).candidates.find(c => c.field === 'quantity')!;
    assert.equal(value.value, '3,000'); assert.notEqual(value.confidence, 'high');
  }
  const manual = source([quantity, anchor]); manual.pages[0].textSource = 'manual';
  const value = ground([quantity, anchor], manual).candidates[0];
  assert.equal(value.value, '3,000'); assert.equal(value.confidence, 'low');
  const dotGroup = ground([proposal('quantity', '3.000'), anchor]).candidates[0];
  assert.equal(dotGroup.value, '3000'); assert.equal(dotGroup.confidence, 'high');
  assert.match(dotGroup.normalizations[0].reason, /dot grouping mark/);
  const dotDecimal = ground([proposal('quantity', '3.000'), proposal('unitPrice', '12.50')]).candidates[0];
  assert.equal(dotDecimal.value, '3.000'); assert.equal(dotDecimal.confidence, 'high');
  assert.match(dotDecimal.normalizations[0].reason, /Retain the dot decimal/);
  const dotConflict = ground([proposal('quantity', '3.000'), anchor, proposal('amount', '12.50')]).candidates[0];
  assert.equal(dotConflict.value, '3.000'); assert.notEqual(dotConflict.confidence, 'high');
});

test('visual numeric evidence remains tied to its original image and region', () => {
  const proposals = [proposal('quantity', '3,000'), proposal('unitPrice', '1.234,57')].map(p => ({ ...p, evidence: 'vision' as const, bounds: [.1, .4, .8, .1] as [number, number, number, number] }));
  const doc = source(proposals); doc.pages[0].text = '';
  const image = { page: 1, imageSha256: 'a'.repeat(64), width: 1000, height: 1500 };
  const result = groundKimiProposals(doc, doc.pages, proposals, 'synthetic-numeric-model', [image]);
  assert.equal(result.candidates[0].value, '3.000'); assert.equal(result.candidates[0].confidence, 'high');
  assert.deepEqual(result.candidates[0].visualEvidence, { imageSha256: image.imageSha256, bounds: proposals[0].bounds, textAgreement: false });
  assert.equal(result.candidates[0].originalText, 'quantity: 3,000');
});

test('two independent originals repeating an unresolved dot magnitude cannot corroborate it into a clear fact', () => {
  const proposals = [proposal('invoiceTotal', '1.234', { rowIndex: undefined })];
  const state = createEmptyWorkspace('ambiguous-dot');
  for (let index = 0; index < 2; index++) {
    const doc = { ...source(proposals), id: `numeric-${index}`, sha256: `original-${index}` };
    state.documents.push(doc);
    state.candidates.push(...ground(proposals, doc).candidates);
  }
  assert.ok(state.candidates.every(candidate => candidate.confidence === 'low'));
  assert.equal(isShipmentFactClear(state, 'invoiceTotal', state.candidates), false);
});

test('canonical numeric readings reach the declaration without calculating a replacement price or discarding valid siblings', () => {
  const actor = { id: 'synthetic-reviewer', name: 'Synthetic reviewer', email: 'test@example.invalid' };
  const proposals = [proposal('description', 'Synthetic pump'), proposal('quantity', '3,000'), proposal('unit', 'PC'), proposal('unitPrice', '1.234,57'), proposal('amount', '3.703,70'), proposal('currency', 'EUR', { rowIndex: undefined })];
  const doc = source(proposals);
  let state = applyAction(createEmptyWorkspace('numeric-integration'), { type: 'intake', documents: [{ id: doc.id, name: doc.name, mime: doc.mime, size: doc.size, sha256: doc.sha256, pages: doc.pages, synthetic: true, extractionStatus: 'extracted', extractionPipeline: 'kimi' }] }, actor);
  const saved = state.documents[0];
  state = applyAction(state, { type: 'confirm_grouping', caseId: saved.caseId, reason: 'The synthetic fixture supplies one invoice for one test shipment.' }, actor);
  state = applyAction(state, { type: 'add_ai_candidates', caseId: saved.caseId, documentId: saved.id, documentVersion: saved.version, model: 'synthetic-numeric-model', pages: [1], proposals, pageReadings: [{ page: 1, documentType: 'invoice', readability: 'clear' }] }, actor);
  const shipment = state.cases.find(c => c.id === saved.caseId)!;
  assert.equal(shipment.goods.length, 1);
  const values: Record<string, string> = { quantity: '3.000', unit: 'PCE', unitPrice: '1234.57', amount: '3703.70' };
  const rawUnit = state.candidates.find(candidate => candidate.field === 'unit')!;
  assert.equal(rawUnit.value, 'PC');
  assert.ok(rawUnit.originalText.includes('PC'));
  for (const [key, expected] of Object.entries(values)) {
    const field = ECUS_FORM_FIELDS.find(f => f.key === key)!;
    assert.equal(ecusFormValue(field, shipment.declarationDraft, shipment.goods[0].id), expected, key);
    const entry = getDeclarationEntry(shipment.declarationDraft, field.fieldId, shipment.goods[0].id)!;
    assert.notEqual(entry.stale, true, key);
    assert.ok(entry.provenance.some(p => p.kind === 'document' && p.documentId === saved.id));
  }
});
