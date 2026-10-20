import assert from 'node:assert/strict';
import test from 'node:test';
import { attemptLog, classifyProgress, samePinnedRun } from '../scripts/tokhai-report-watch-utils.mjs';

const base = { pinned: true, log: { done: null, draining: false }, processState: 'running', lastActivityMs: 10, nowMs: 20, staleAfterMs: 100, successfulPages: 3, failedPages: 0, totalPages: 5 };
test('a fully cached run is not declared finished without its final marker', () => {
  assert.equal(classifyProgress({ ...base, successfulPages: 5 }).status, 'in_progress');
});
test('stopped and failed runs never imply all pages completed', () => {
  assert.equal(classifyProgress({ ...base, log: { done: { stopRequested: true } } }).status, 'stopped');
  assert.equal(classifyProgress({ ...base, log: { done: {} } }).status, 'finished_with_issues');
  assert.equal(classifyProgress({ ...base, log: { done: {} }, successfulPages: 5 }).status, 'finished');
  assert.equal(classifyProgress({ ...base, processState: 'stopped' }).status, 'stopped');
});
test('permission failure and inactivity remain uncertain, never completion', () => {
  assert.equal(classifyProgress({ ...base, processState: 'unknown' }).status, 'activity_observed');
  const stale = classifyProgress({ ...base, processState: 'unknown', nowMs: 200 });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.terminal, false);
});
test('a previous attempt final marker cannot finish the current attempt', () => {
  const old = '{"stage":"started","pid":1}\n{"stage":"done"}\n';
  assert.equal(attemptLog(old, 2).done, null);
  assert.equal(attemptLog(old + '{"stage":"started","pid":2}\n{"stage":"ki', 2).done, null);
  assert.deepEqual(attemptLog(old + '{"stage":"started","pid":2}\n{"stage":"done","stopRequested":true}\n', 2).done, { stage: 'done', stopRequested: true });
});
test('watchers are pinned to model, prompt and current attempt as well as original start', () => {
  const profile = { startedAt: 'a', promptHash: 'b', model: 'c', attempts: [{ startedAt: 'd', pid: 2 }] };
  const pin = { startedAt: 'a', promptHash: 'b', model: 'c', attemptStartedAt: 'd', pid: 2 };
  assert.equal(samePinnedRun(profile, pin), true);
  assert.equal(samePinnedRun({ ...profile, attempts: [{ startedAt: 'e', pid: 3 }] }, pin), false);
  assert.equal(classifyProgress({ ...base, pinned: false }).status, 'superseded');
});
