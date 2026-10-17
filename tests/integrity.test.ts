import test from 'node:test';
import assert from 'node:assert/strict';
import { addDecimal, compareDecimal, formatDecimal, isIsoDate, multiplyDecimal, parseExactDecimal } from '../lib/integrity.ts';
import { createEmptyWorkspace, getIssues } from '../lib/engine.ts';
import { applyFixtureAction as applyAction } from './helpers/kimi-fixtures.ts';
import { syntheticShipments } from '../lib/demo.ts';
import type { Actor } from '../lib/types.ts';

const actor: Actor = { id: 'integrity-reviewer', name: 'Synthetic integrity reviewer', email: 'integrity@example.invalid' };
const decimal = (value: string) => parseExactDecimal(value)!;
test('exact decimals preserve precision and reject ambiguous input without source rewriting', () => {
  for (const invalid of ['', ' 1', '1 ', '1,000', '1e3', '+1', '.5', '1.', 'NaN', 'Infinity', '１']) assert.equal(parseExactDecimal(invalid), undefined, invalid);
  assert.equal(parseExactDecimal('-1'), undefined);
  assert.equal(formatDecimal(parseExactDecimal('-0.001', { signed: true })!), '-0.001');
  assert.equal(parseExactDecimal('1.0', { integer: true }), undefined);
  assert.equal(formatDecimal(decimal('0001.2300')), '1.2300');
  assert.equal(formatDecimal(addDecimal(decimal('9007199254740993.01'), decimal('0.02'))), '9007199254740993.03');
  assert.equal(compareDecimal(addDecimal(decimal('0.1'), decimal('0.2')), decimal('0.3')), 0);
  assert.equal(formatDecimal(multiplyDecimal(decimal('3'), decimal('0.333'))), '0.999');
  assert.equal(compareDecimal(decimal('0.999'), decimal('1')), -1);
});
test('calendar dates are explicit ISO dates including leap-year and century boundaries', () => {
  for (const valid of ['2024-02-29', '2000-02-29', '2026-10-10', '0001-01-01']) assert.equal(isIsoDate(valid), true, valid);
  for (const invalid of ['2026-02-29', '1900-02-29', '2026-04-31', '03/04/2026', '2026-1-01', '0000-01-01', '2026-01-00', '2026-13-01']) assert.equal(isIsoDate(invalid), false, invalid);
});
test('malformed nonempty unit price and packing-list dates cannot bypass review checks', () => {
  let state = applyAction(createEmptyWorkspace('integrity-workspace'), { type: 'intake', documents: syntheticShipments()[1].documents }, actor);
  const shipment = state.cases[0];
  const goods = structuredClone(shipment.goods); goods[0].unitPrice = '1e3';
  state = applyAction(state, { type: 'review_goods', caseId: shipment.id, goods, reason: 'Synthetic malformed price test.' }, actor);
  state = applyAction(state, { type: 'review_field', caseId: shipment.id, field: 'packingListDate', value: '2026-02-30', reason: 'Synthetic invalid date test.' }, actor);
  const issues = getIssues(state, shipment.id);
  assert.ok(issues.some(issue => issue.id.includes('goods-price-format-')));
  assert.ok(issues.some(issue => issue.id.endsWith('date-format-packingListDate')));
  const priceIssue = issues.find(issue => issue.id.includes('goods-price-format-'))!;
  assert.throws(() => applyAction(state, { type: 'resolve_issue', caseId: shipment.id, issueId: priceIssue.id, reason: 'Ignore syntax.' }, actor));
  assert.equal(state.cases[0].goods[0].unitPrice, '1e3');
  assert.equal(state.cases[0].fields.packingListDate.value, '2026-02-30');
});
test('guide tolerance accepts a small rounding difference but larger discrepancies require an explanation', () => {
  let state = applyAction(createEmptyWorkspace('exact-workspace'), { type: 'intake', documents: syntheticShipments()[1].documents }, actor);
  const id = state.cases[0].id; const goods = structuredClone(state.cases[0].goods);
  goods[0] = { ...goods[0], quantity: '3', unitPrice: '0.333', amount: '1' };
  state = applyAction(state, { type: 'review_goods', caseId: id, goods, reason: 'Synthetic rounding example.' }, actor);
  assert.ok(!getIssues(state, id).some(item => item.id.includes('goods-math-')));
  goods[0].amount = '2';
  state = applyAction(state, { type: 'review_goods', caseId: id, goods, reason: 'Synthetic difference of 1.001, beyond the supplied guide tolerance.' }, actor);
  const issue = getIssues(state, id).find(item => item.id.includes('goods-math-'))!;
  assert.ok(issue); assert.match(issue.description, /0\.999/);
  state = applyAction(state, { type: 'resolve_issue', caseId: id, issueId: issue.id, reason: 'Synthetic invoice has an explicit additional line charge; preserved its amount.' }, actor);
  assert.equal(getIssues(state, id).find(item => item.id === issue.id)?.resolved, true);
});
