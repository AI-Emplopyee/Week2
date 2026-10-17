import assert from 'node:assert/strict';
import test from 'node:test';
import { ecusEvidenceReadings, visionCropGeometry } from '../lib/ecus-evidence.ts';
import { getEcusFormField } from '../lib/ecus-form.ts';
import type { Candidate } from '../lib/types.ts';
import type { DeclarationProvenance } from '../lib/declaration-types.ts';

const candidate = (id: string, field: string, value: string, extra: Partial<Candidate> = {}): Candidate => ({ id, field, value, caseId: 'case', documentId: 'invoice', documentVersion: 1, page: 1, originalText: 'USD 1000', confidence: 'high', method: 'kimi:test:source_vision_proposal', location: 'page 1', normalizations: [], ...extra });
const source = (item: Candidate): DeclarationProvenance => ({ kind: 'document', documentId: item.documentId, documentVersion: item.documentVersion, page: item.page, quote: item.originalText, candidateId: item.id, ...(item.confidenceScore !== undefined ? { confidenceScore: item.confidenceScore } : {}) });

test('combined invoice entries show the selected component score and evidence, even when quotes are identical', () => {
  const amount = candidate('amount', 'invoiceTotal', '1000', { confidenceScore: 91 });
  const currency = candidate('currency', 'currency', 'USD', { confidenceScore: 84 });
  const sources = [source(amount), source(currency)];
  const readings = ecusEvidenceReadings(getEcusFormField('invoiceTotal')!, sources, [amount, currency]);
  assert.equal(readings.length, 1);
  assert.equal(readings[0].index, 0);
  assert.equal(readings[0].candidate?.confidenceScore, 91);
  assert.deepEqual(ecusEvidenceReadings(getEcusFormField('currency')!, sources, [amount, currency]).map(reading => reading.index), [1]);
});

test('guide-derived field evidence keeps original reading confidence and its derivation basis', () => {
  const original = candidate('invoice-kind', 'invoiceDocumentKind', 'COMMERCIAL INVOICE', { confidenceScore: 93 });
  const derived = { ...original, field: 'invoiceForm', value: 'A', normalizations: [{ before: original.value, after: 'A', reason: 'vnaccs-guide:1.39: Commercial invoices use A.' }] };
  const [reading] = ecusEvidenceReadings(getEcusFormField('invoiceForm')!, [source(original)], [original], [derived]);
  assert.equal(reading.candidate?.value, 'A');
  assert.equal(reading.candidate?.confidenceScore, 93);
  assert.equal(reading.candidate?.normalizations[0].before, 'COMMERCIAL INVOICE');
});

test('manual evidence and old qualitative readings never acquire a numeric score', () => {
  const old = candidate('old', 'invoiceNumber', 'INV-01', { confidence: 'medium', originalText: 'Invoice INV-01' });
  const manual: DeclarationProvenance = { kind: 'manual', note: 'Reviewer corrected the invoice number.' };
  const readings = ecusEvidenceReadings(getEcusFormField('invoiceNumber')!, [source(old), manual], [old]);
  assert.equal(readings[0].candidate?.confidence, 'medium');
  assert.equal(readings[0].candidate?.confidenceScore, undefined);
  assert.equal(readings[1].candidate, undefined);
  assert.deepEqual(readings[1].source, manual);
  const replaced = ecusEvidenceReadings(getEcusFormField('invoiceNumber')!, [source(old)], [{ ...old, documentVersion: 2, confidenceScore: 99 }]);
  assert.equal(replaced[0].candidate, undefined);
});

test('repeated bill controls select the relevant saved row and accept house-bill guide evidence', () => {
  const first = candidate('bill-one', 'houseBillOfLading', 'HB-01');
  const second = candidate('bill-two', 'houseBillOfLading', 'HB-02');
  const readings = ecusEvidenceReadings(getEcusFormField('billOfLading')!, [source(first), source(second)], [first, second], [first, second], 'HB-02');
  assert.deepEqual(readings.map(reading => reading.candidate?.id), ['bill-two']);
});

test('ambiguous legacy quotations and unrelated attached evidence cannot lend their confidence to a goods field', () => {
  const first = candidate('row-one', 'amount', '1000', { lineId: 'goods-one', confidenceScore: 94 });
  const second = candidate('row-two', 'amount', '1000', { lineId: 'goods-two', confidenceScore: 73 });
  const legacy: DeclarationProvenance = { kind: 'document', documentId: 'invoice', documentVersion: 1, page: 1, quote: first.originalText };
  const [ambiguous] = ecusEvidenceReadings(getEcusFormField('amount')!, [legacy], [first, second]);
  assert.equal(ambiguous.candidate, undefined);
  assert.equal(ambiguous.scoreEligible, false);
  assert.equal(ambiguous.source, legacy);
  const [bound] = ecusEvidenceReadings(getEcusFormField('amount')!, [source(second)], [first, second]);
  assert.equal(bound.candidate?.confidenceScore, 73);
  const unrelated = candidate('invoice-num', 'invoiceNumber', 'INV-01', { confidenceScore: 98 });
  const [attached] = ecusEvidenceReadings(getEcusFormField('amount')!, [source(unrelated)], [unrelated]);
  assert.equal(attached.candidate, undefined);
  assert.equal(attached.scoreEligible, false);
});

test('crop positions put the evidence corners inside the crop viewport without displaying the full page', () => {
  const crop = visionCropGeometry([0.2, 0.3, 0.4, 0.1], 0)!;
  const originalWidth = 1200, originalHeight = 1800, viewportWidth = 320;
  const imageWidth = viewportWidth * crop.imageWidthPercent / 100;
  const imageHeight = imageWidth * originalHeight / originalWidth;
  const viewportHeight = viewportWidth / ((originalWidth / originalHeight) * crop.width / crop.height);
  const imageLeft = viewportWidth * crop.imageLeftPercent / 100;
  const imageTop = viewportHeight * crop.imageTopPercent / 100;
  assert.ok(Math.abs(imageLeft + 0.2 * imageWidth) < 0.000001);
  assert.ok(Math.abs(imageTop + 0.3 * imageHeight) < 0.000001);
  assert.ok(Math.abs(imageLeft + 0.6 * imageWidth - viewportWidth) < 0.000001);
  assert.ok(Math.abs(imageTop + 0.4 * imageHeight - viewportHeight) < 0.000001);
  assert.ok(crop.imageWidthPercent > 100);
  const corner = visionCropGeometry([0, 0.9, 0.1, 0.1])!;
  assert.equal(corner.left, 0);
  assert.ok(corner.top + corner.height <= 1);
  assert.equal(visionCropGeometry([0.8, 0.8, 0.4, 0.4]), undefined);
  assert.equal(visionCropGeometry([0.1, 0.1, 0, 0.2]), undefined);
});
