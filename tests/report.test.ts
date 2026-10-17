import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../lib/report.ts';
import { buildReportContent } from '../lib/report-content.ts';
import { createEmptyWorkspace } from '../lib/engine.ts';
import { applyFixtureAction as applyAction } from './helpers/kimi-fixtures.ts';
const actor = { id: 'report-reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.invalid' };
test('report distinguishes current evidence, manual decisions, open issues, and test-only status', () => {
  const state = applyAction(createEmptyWorkspace('reports'), { type: 'seed_demo' }, actor);
  for (const c of state.cases) {
    const report = buildReport(state, c.id);
    assert.equal(report.customsValidation, 'Not yet assessed');
    assert.equal(report.shipment.synthetic, true);
    assert.equal(report.open.length, report.issues.filter(i => !i.resolved).length);
    assert.ok(report.candidates.every(candidate => report.documents.some(d => d.id === candidate.documentId && d.active && d.version === candidate.documentVersion)));
    assert.equal(report.handoffs.length, 0);
  }
});

test('English PDF content localizes generated headings while preserving reviewer and source text', () => {
  let state = applyAction(createEmptyWorkspace('reports'), { type: 'seed_demo' }, actor);
  const shipment = state.cases[0];
  state = applyAction(state, { type: 'review_field', caseId: shipment.id, field: 'importer', value: 'Người nhập khẩu', reason: 'Đóng' }, actor);
  const original = JSON.stringify(state);
  const english = buildReportContent(state, shipment.id, 'en');
  const vietnamese = buildReportContent(state, shipment.id, 'vi');
  const enText = english.blocks.filter(block => block.kind === 'text').map(block => block.value).join('\n');
  const viText = vietnamese.blocks.filter(block => block.kind === 'text').map(block => block.value).join('\n');
  assert.match(enText, /AICD  \/  REVIEW REPORT/);
  assert.match(enText, /Reviewed: Người nhập khẩu/);
  assert.match(enText, /Reason: Đóng/);
  assert.match(enText, /Recorded reason: Đóng/);
  assert.match(enText, /local browser OCR/);
  assert.match(enText, /IDA: not transmitted/);
  assert.match(viText, /AICD  \/  BÁO CÁO RÀ SOÁT/);
  assert.match(viText, /OCR cục bộ trong trình duyệt/);
  assert.equal(english.blocks.filter(block => block.kind === 'section').length, 10);
  assert.equal(english.blocks.find(block => block.kind === 'section')?.value, '01   Overview and next actions');
  for (const candidate of english.data.candidates.filter(candidate => !candidate.lineId)) assert.ok(enText.includes(candidate.originalText));
  assert.equal(JSON.stringify(state), original, 'Generating translated content must not modify stored evidence.');
});
