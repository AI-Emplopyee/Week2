import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyWorkspace, getIssues } from "../lib/engine.ts";
import { applyFixtureAction as applyAction } from './helpers/kimi-fixtures.ts';
import { parseMutation } from "../lib/server-validation.ts";
import type { Action, Actor, GoodsLine, WorkspaceState } from "../lib/types.ts";

const actor: Actor = {
  id: "goods-reviewer",
  name: "Synthetic goods reviewer",
  email: "goods@example.invalid",
};
const act = (state: WorkspaceState, action: Action) => applyAction(state, action, actor);
function fixture() {
  const text = [
    "COMMERCIAL INVOICE",
    "Invoice Number: SYNTHETIC-ROW-REVIEW",
    "Importer: Fictional Buyer",
    "Exporter: Fictional Seller",
    "Currency: USD",
    "Invoice Total: 150",
    "Description | Quantity | Unit | Unit Price | Amount",
    "First widget | 2 | PCS | 50 | 100",
    "Second widget | 1 | PCS | 50 | 50",
  ].join("\n");
  const state = act(createEmptyWorkspace("goods-review-test"), {
    type: "intake",
    documents: [{
      id: "goods-source",
      name: "synthetic-invoice.txt",
      mime: "text/plain",
      size: text.length,
      sha256: "synthetic-row-review-hash",
      pages: [{ page: 1, text }],
      extractionStatus: "extracted",
      synthetic: true,
    }],
  });
  assert.equal(state.cases[0].goods.length, 2);
  for (const candidate of state.candidates) {
    if (candidate.lineId) candidate.confidence = "low";
  }
  return state;
}
function save(
  state: WorkspaceState,
  goods: GoodsLine[],
  reviewedLineIds?: string[],
  reason = "Synthetic review of the explicitly selected rows only.",
) {
  return act(state, {
    type: "review_goods", caseId: state.cases[0].id, goods, reviewedLineIds, reason,
  });
}
const rowQuestions = (state: WorkspaceState) =>
  getIssues(state, state.cases[0].id).filter(issue => issue.id.includes(":goods-uncertain-") && !issue.resolved);

test("saving goods cannot approve unchecked rows, including forged review flags", () => {
  const initial = fixture();
  for (const selected of [undefined, []]) {
    const changed = structuredClone(initial.cases[0].goods);
    changed[0].description = "Manually corrected first widget";
    for (const line of changed) { line.reviewed = true; line.reason = "Forged approval"; }
    const saved = save(initial, changed, selected, "Saved a description correction only.");
    assert.deepEqual(saved.cases[0].goods.map(line => line.reviewed), [false, false]);
    assert.equal(saved.cases[0].goods[1].reason, undefined);
    assert.equal(saved.cases[0].goods[0].manual, true);
    assert.equal(rowQuestions(saved).length, 2);
    assert.ok(saved.audit.some(entry => entry.action === "goods_saved"));
    assert.ok(!saved.audit.some(entry => entry.action === "goods_reviewed"));
  }
  assert.deepEqual(initial.cases[0].goods.map(line => line.reviewed), [false, false]);
});

test("confirming one goods row leaves the other question and row untouched", () => {
  const initial = fixture();
  const [first, second] = initial.cases[0].goods;
  const pendingBefore = rowQuestions(initial);
  assert.equal(pendingBefore.length, 2);
  const confirmed = save(initial, initial.cases[0].goods, [first.id], "I checked the first widget only.");
  assert.equal(confirmed.cases[0].goods[0].reviewed, true);
  assert.equal(confirmed.cases[0].goods[0].reason, "I checked the first widget only.");
  assert.deepEqual(confirmed.cases[0].goods[1], second);
  assert.deepEqual(confirmed.cases[0].fields, initial.cases[0].fields);
  assert.deepEqual(rowQuestions(confirmed).map(issue => issue.id), [`${initial.cases[0].id}:goods-uncertain-${second.id}`]);
  const untouchedQuestion = pendingBefore.find(issue => issue.id.endsWith(second.id))!;
  assert.equal(rowQuestions(confirmed)[0].fingerprint, untouchedQuestion.fingerprint);
  const both = save(confirmed, confirmed.cases[0].goods, [second.id], "I checked the second widget separately.");
  assert.deepEqual(both.cases[0].goods.map(line => line.reviewed), [true, true]);
  assert.equal(both.cases[0].goods[0].reason, "I checked the first widget only.");
  assert.equal(rowQuestions(both).length, 0);
});

test("saved edits invalidate only changed rows and preserve other explicit approvals", () => {
  const initial = fixture();
  const approved = save(initial, initial.cases[0].goods, initial.cases[0].goods.map(line => line.id));
  const edited = structuredClone(approved.cases[0].goods);
  edited[0].quantity = "3";
  const saved = save(approved, edited, [], "Quantity corrected; confirmation still pending.");
  assert.equal(saved.cases[0].goods[0].reviewed, false);
  assert.equal(saved.cases[0].goods[0].manual, true);
  assert.deepEqual(saved.cases[0].goods[1], approved.cases[0].goods[1]);
  const confirmed = save(saved, saved.cases[0].goods, [saved.cases[0].goods[0].id]);
  const roundTrip = save(confirmed, confirmed.cases[0].goods, [], "Save unchanged data.");
  assert.deepEqual(roundTrip.cases[0].goods, confirmed.cases[0].goods);
  assert.equal(roundTrip.cases[0].goods[0].manual, true);
});

test("changing row evidence clears approval even when displayed values match", () => {
  const initial = fixture();
  const approved = save(initial, initial.cases[0].goods, initial.cases[0].goods.map(line => line.id));
  const edited = structuredClone(approved.cases[0].goods);
  delete edited[0].sourceDocumentId;
  delete edited[0].sourcePage;
  delete edited[0].originalText;
  const saved = save(approved, edited, [], "Changed to a manual source; review it again.");
  assert.equal(saved.cases[0].goods[0].reviewed, false);
  assert.equal(saved.cases[0].goods[0].manual, true);
  assert.equal(saved.cases[0].goods[1].reviewed, true);
});

test("manual changes to a clear source row require their own confirmation", () => {
  const initial = fixture();
  for (const candidate of initial.candidates) {
    if (candidate.lineId) candidate.confidence = "high";
  }
  assert.equal(rowQuestions(initial).length, 0);
  const goods = structuredClone(initial.cases[0].goods);
  goods[0].description = "Reviewer-corrected first widget";
  const saved = save(initial, goods, [], "Saved a manual correction for later review.");
  assert.equal(saved.cases[0].goods[0].reviewed, false);
  assert.deepEqual(rowQuestions(saved).map(issue => issue.id), [`${initial.cases[0].id}:goods-uncertain-${goods[0].id}`]);
});

test("goods confirmation scope is transport validated and rejects invalid row IDs", () => {
  const initial = fixture();
  const goods = initial.cases[0].goods;
  const firstId = goods[0].id;
  const payload = {
    revision: initial.revision,
    action: { type: "review_goods", caseId: initial.cases[0].id, goods, reviewedLineIds: [firstId], reason: "Explicit row selection." },
  };
  const parsed = parseMutation(payload);
  assert.equal(parsed.action.type, "review_goods");
  if (parsed.action.type === "review_goods") assert.deepEqual(parsed.action.reviewedLineIds, [firstId]);
  assert.throws(() => save(initial, goods, [firstId, firstId]), /trùng/);
  assert.throws(() => save(initial, goods, ["unknown-row"]), /bảng đã gửi/);
  assert.throws(() => parseMutation({ ...payload, action: { ...payload.action, reviewedLineIds: ["invalid/id"] } }));
});
