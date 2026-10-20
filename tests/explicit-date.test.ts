import assert from 'node:assert/strict';
import test from 'node:test';
import { explicitIsoDate } from '../lib/explicit-date.ts';
import { normalizeValue } from '../lib/extraction.ts';

test('complete dates with explicit month names retain the same calendar day', () => {
  for (const [source, expected] of [
    ['14-Dec-2026', '2026-12-14'], ['19/Mar/2026', '2026-03-19'], ['12.DEC.2026', '2026-12-12'],
    ['30OCT2026', '2026-10-30'], ['06-Apr-2026', '2026-04-06'], ['September 7, 2026', '2026-09-07'],
    ['Jan. 2, 2026', '2026-01-02'], ['2 Sept. 2026', '2026-09-02'], ['May 11 2026', '2026-05-11'],
  ]) assert.equal(explicitIsoDate(source), expected, source);
});

test('dotted and separated numeric dates convert only when the order is unambiguous', () => {
  for (const [source, expected] of [
    ['22.03.2026', '2026-03-22'], ['03.22.2026', '2026-03-22'], ['2026.03.04', '2026-03-04'],
    ['2026/3/4', '2026-03-04'], ['2026-03-04', '2026-03-04'], ['31/12/2026', '2026-12-31'],
  ]) assert.equal(explicitIsoDate(source), expected, source);
  for (const source of ['04.12.2026', '07/04/2026', '10-11-2026']) assert.equal(explicitIsoDate(source), undefined, source);
});

test('calendar errors, missing years and unrelated quoted text do not become dates', () => {
  for (const source of ['31-Apr-2026', '29-Feb-2025', '2026-02-30', '32.03.2026', '22.13.2026',
    '9-Nov-26', '30.10.26', 'Dec-2026', '2026', '14 Unknown 2026', 'Invoice date: 14-Dec-2026',
    '2026/03-04', '0-Jan-2026']) assert.equal(explicitIsoDate(source), undefined, source);
  assert.equal(explicitIsoDate('29-Feb-2024'), '2024-02-29');
});

test('header normalizer records the original date and keeps ambiguous readings uncertain', () => {
  for (const field of ['invoiceDate', 'contractDate', 'arrivalDate', 'transportDepartureDate']) {
    const result = normalizeValue(field, '14-Dec-2026');
    assert.equal(result.value, '2026-12-14', field);
    assert.equal(result.confidence, 'high');
    assert.ok(result.normalizations.some(change => change.before === '14-Dec-2026' && change.after === '2026-12-14'));
    const ambiguous = normalizeValue(field, '04.12.2026');
    assert.equal(ambiguous.value, '04.12.2026');
    assert.equal(ambiguous.confidence, 'low');
  }
});
