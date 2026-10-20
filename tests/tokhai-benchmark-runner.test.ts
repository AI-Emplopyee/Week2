import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkSources, preparedMetadataError, readingMatches, packetReadiness, packetTimings, confirmBenchmarkGrouping, BENCHMARK_GROUPING_ASSUMPTION } from '../scripts/tokhai-benchmark-utils.mjs';
import { createEmptyWorkspace, applyAction } from '../lib/engine.ts';

const sha = 'a'.repeat(64), imageSha = 'b'.repeat(64);
const source = { name: 'Invoice.pdf', sha256: sha, sourcePaths: ['sample/Invoice.pdf'] };
const page = { page: 1, imageSha256: imageSha, width: 100, height: 200, imagePath: '/tmp/render/page-1.jpg' };

test('ToKhai holdout rejects renamed duplicate hashes and source aliases before deduplication', () => {
  const manifest = (sources: object[], heldOut: object[] = [], grounds: object[] = []) => ({ packets: [{ sources, heldOut, grounds }] });
  assert.throws(() => benchmarkSources(manifest([source], [{ sha256: sha }])), /held-out/);
  assert.throws(() => benchmarkSources(manifest([source], [], [{ sha256: sha }])), /held-out/);
  assert.throws(() => benchmarkSources(manifest([{ ...source, sourcePaths: ['sample/ToKhaiHQ.xls'] }, source])), /held-out/);
  assert.throws(() => benchmarkSources(manifest([{ ...source, name: 'Tờ khai.pdf' }])), /held-out/);
  assert.equal(benchmarkSources(manifest([source, source])).sources.length, 1);
});

test('zero-page, altered-fingerprint and escaped-path prepared sources cannot be ready', () => {
  const valid = { sourceSha256: sha, pages: [page] };
  assert.equal(preparedMetadataError(source, valid, '/tmp/render'), null);
  assert.match(preparedMetadataError(source, { ...valid, pages: [] }, '/tmp/render'), /no valid/);
  assert.match(preparedMetadataError(source, { ...valid, sourceSha256: imageSha }, '/tmp/render'), /fingerprint/);
  assert.match(preparedMetadataError(source, { ...valid, pages: [{ ...page, imagePath: '/tmp/answer-key.jpg' }] }, '/tmp/render'), /outside/);
});

test('cached results bind source, actual page image, prompt, model and evidence dimensions', () => {
  const reading = { sourceSha256: sha, page: 1, inputImageSha256: imageSha, promptHash: 'prompt', at: '2026-10-19T10:00:00Z', elapsedMs: 1000,
    result: { model: 'kimi-k2.6', pages: [1] }, visionEvidence: [{ page: 1, imageSha256: imageSha, width: 100, height: 200 }] };
  assert.equal(readingMatches(reading, source, page, 'prompt', 'kimi-k2.6'), true);
  for (const changed of [{ ...reading, inputImageSha256: sha }, { ...reading, promptHash: 'old' }, { ...reading, at: 'invalid' }, { ...reading, result: { ...reading.result, model: 'other' } }, { ...reading, visionEvidence: [{ ...reading.visionEvidence[0], width: 300 }] }]) {
    assert.equal(readingMatches(changed, source, page, 'prompt', 'kimi-k2.6'), false);
  }
});

test('readiness distinguishes unread/uncertain/rejected pages from completed reading and unsupported forms', () => {
  const clear = { extractionStatus: 'extracted', aiStatus: 'completed', aiProcessedPages: [1], pages: [{ page: 1, aiReadability: 'clear' }] };
  assert.equal(packetReadiness([clear], [], 'import').status, 'complete');
  assert.equal(packetReadiness([clear], [], 'export').formStatus, 'unsupported_direction');
  assert.equal(packetReadiness([], [], 'import').status, 'no_primary_sources');
  assert.equal(packetReadiness([{ ...clear, pages: [] }], [], 'import').status, 'incomplete');
  assert.equal(packetReadiness([{ ...clear, aiRejectedPages: [1] }], [], 'import').blockedPages, 1);
  assert.equal(packetReadiness([{ ...clear, pages: [{ page: 1, aiReadability: 'uncertain' }] }], [], 'import').status, 'incomplete');
});

test('timings report actual overlapping wall time separately from summed request durations', () => {
  const timings = packetTimings([{ at: '2026-10-19T10:00:00Z', elapsedMs: 4000 }, { at: '2026-10-19T10:00:01Z', elapsedMs: 4000 }]);
  assert.equal(timings.serviceMs, 8000);
  assert.equal(timings.wallElapsedMs, 5000);
  assert.equal(packetTimings([]).wallElapsedMs, null);
});

test('isolated benchmark source facts populate a draft under the declared fixture grouping assumption', () => {
  const actor = { id: 'fixture', email: '', name: 'Benchmark fixture' };
  let state = createEmptyWorkspace('benchmark-test');
  state = applyAction(state, { type: 'intake', sourceCollection: { name: 'ToKhai isolated benchmark', folder: 'synthetic-sample', caseType: 'import' }, documents: [{
    id: 'invoice', name: 'Invoice.pdf', mime: 'application/pdf', size: 10, sha256: sha, pages: [{ page: 1, text: '' }], extractionStatus: 'pending_ai', extractionPipeline: 'kimi',
  }] }, actor);
  const caseId = state.cases[0].id;
  state = applyAction(state, { type: 'add_ai_candidates', caseId, documentId: 'invoice', documentVersion: 1, model: 'kimi-test', pages: [1], proposals: [{ field: 'invoiceNumber', value: 'INV-42', quote: 'Invoice No: INV-42', page: 1, confidence: 'high', readability: 'clear', evidence: 'vision', bounds: [0.1, 0.1, 0.3, 0.1] }], pageReadings: [{ page: 1, documentType: 'invoice', readability: 'clear' }], visionEvidence: [{ page: 1, imageSha256: imageSha, width: 100, height: 200 }] }, actor);
  assert.equal(state.cases[0].groupingConfirmed, false);
  assert.equal(state.cases[0].declarationDraft?.fields.find(field => field.fieldId === '1.41'), undefined);
  state = confirmBenchmarkGrouping(state, actor);
  const invoice = state.cases[0].declarationDraft?.fields.find(field => field.fieldId === '1.41');
  assert.ok(invoice && 'reference' in invoice.value);
  assert.equal(invoice?.value.reference, 'INV-42');
  assert.equal(state.cases[0].groupingReason, BENCHMARK_GROUPING_ASSUMPTION);
  assert.equal(state.cases[0].status, 'review');
  assert.equal(state.cases[0].approval, undefined);
});
