import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyWorkspace, getIssues } from "../lib/engine.ts";
import { applyFixtureAction as applyAction } from './helpers/kimi-fixtures.ts';
import { getReviewHistory } from "../lib/review-history.ts";
import type { Actor, UploadedDocument, WorkspaceState } from "../lib/types.ts";

const actor: Actor = {
  id: "review-history",
  name: "Synthetic reviewer",
  email: "review-history@example.invalid",
};
function fixture() {
  const document: UploadedDocument = {
    id: "uncertain-source",
    name: "synthetic-invoice.txt",
    mime: "text/plain",
    size: 100,
    sha256: "synthetic-history-source",
    synthetic: true,
    extractionStatus: "extracted",
    pages: [
      {
        page: 1,
        text: "COMMERCIAL INVOICE\nInvoice Number: TEST-HISTORY\nImporter: Fictional Buyer\nExporter: Fictional Seller\nVessel: Fictional Vessel\nDescription | Quantity | Unit | Unit Price | Amount\nWidget A | 1 | PCS | 10 | 10\nWidget B | 2 | PCS | 10 | 20",
        textSource: "ocr",
        ocrConfidence: 0.9,
      },
    ],
  };
  return applyAction(
    createEmptyWorkspace("review-history"),
    { type: "intake", documents: [document] },
    actor,
  );
}
function confirm(state: WorkspaceState, field: string) {
  const candidate = state.candidates.find(
    (candidate) => candidate.field === field && !candidate.lineId,
  )!;
  return applyAction(
    state,
    {
      type: "review_field",
      caseId: state.cases[0].id,
      field,
      value: candidate.value,
      candidateId: candidate.id,
      reason: `Compared synthetic ${field} with its source.`,
    },
    actor,
  );
}

test("confirming one uncertain header records only its question and preserves every unrelated pending question", () => {
  const state = fixture();
  const caseId = state.cases[0].id;
  const before = getIssues(state, caseId).filter((issue) => !issue.resolved);
  const selected = before.find((issue) => issue.field === "importer")!;
  assert.ok(selected);
  const siblings = before.filter((issue) => issue.field !== "importer");
  const updated = confirm(state, "importer");
  const pendingIds = getIssues(updated, caseId)
    .filter((issue) => !issue.resolved)
    .map((issue) => issue.id);
  assert.ok(
    siblings.every((issue) => pendingIds.includes(issue.id)),
    "every unrelated pending question survives",
  );
  assert.equal(pendingIds.includes(selected.id), false);
  const history = getReviewHistory(updated, caseId, getIssues(updated, caseId));
  assert.equal(history.length, 1);
  assert.equal(history[0].issue.id, selected.id);
  assert.equal(history[0].status, "confirmed");
  assert.equal(history[0].value, "Fictional Buyer");
  assert.equal(history[0].actor, actor.name);
  assert.deepEqual(history[0].issue.candidateIds, selected.candidateIds);
  assert.deepEqual(
    getReviewHistory(
      JSON.parse(JSON.stringify(updated)),
      caseId,
      getIssues(updated, caseId),
    ),
    JSON.parse(JSON.stringify(history)),
    "history survives reload",
  );
  assert.equal(
    state.cases[0].reviewHistory,
    undefined,
    "original state remains immutable",
  );
});

test("multiple confirmed questions retain individual status and previously stored history snapshots stay immutable", () => {
  let state = confirm(fixture(), "importer");
  const first = structuredClone(state.cases[0].reviewHistory![0]);
  state = confirm(state, "exporter");
  const entries = getReviewHistory(state, state.cases[0].id, getIssues(state));
  assert.deepEqual(
    new Set(entries.map((entry) => entry.issue.field)),
    new Set(["importer", "exporter"]),
  );
  assert.ok(entries.every((entry) => entry.status === "confirmed"));
  assert.deepEqual(state.cases[0].reviewHistory![0], first);
  assert.ok(
    getIssues(state).some(
      (issue) => !issue.resolved && issue.field === "vessel",
    ),
  );
});

test("active uncertainty takes precedence over prior confirmation without erasing the decision history", () => {
  const state = confirm(fixture(), "importer");
  const caseId = state.cases[0].id;
  const stored = structuredClone(state.cases[0].reviewHistory);
  state.cases[0].fields.importer.stale = true;
  const issues = getIssues(state, caseId);
  assert.ok(
    issues.some((issue) => !issue.resolved && issue.field === "importer"),
  );
  assert.equal(getReviewHistory(state, caseId, issues).length, 0);
  assert.deepEqual(state.cases[0].reviewHistory, stored);
});

test("legacy audited uncertain decisions are recovered but high-confidence ordinary facts are not invented questions", () => {
  let state = confirm(fixture(), "importer");
  delete state.cases[0].reviewHistory;
  const snapshot = JSON.stringify(state);
  const history = getReviewHistory(state, state.cases[0].id, getIssues(state));
  assert.equal(history.length, 1);
  assert.equal(history[0].issue.field, "importer");
  assert.equal(history[0].status, "confirmed");
  assert.ok(history[0].id.startsWith("legacy:"));
  assert.equal(
    JSON.stringify(state),
    snapshot,
    "read-time recovery does not write user data",
  );
  state.candidates
    .filter((candidate) => candidate.field === "exporter")
    .forEach((candidate) => {
      candidate.confidence = "high";
    });
  state = confirm(state, "exporter");
  assert.deepEqual(
    getReviewHistory(state, state.cases[0].id, getIssues(state)).map(
      (entry) => entry.issue.field,
    ),
    ["importer"],
  );
});

test("manual correction has its own status and does not mark the remaining questions as checked", () => {
  const state = fixture();
  const caseId = state.cases[0].id;
  const changed = applyAction(
    state,
    {
      type: "review_field",
      caseId,
      field: "importer",
      value: "Manually supplied legal buyer",
      reason: "Synthetic broker supplied corrected buyer.",
    },
    actor,
  );
  const history = getReviewHistory(changed, caseId, getIssues(changed));
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "corrected");
  assert.ok(
    getIssues(changed).some(
      (issue) => !issue.resolved && issue.field === "exporter",
    ),
  );
});

test("row confirmation resolves only its own goods uncertainty and retains the other row as pending", () => {
  const state = fixture();
  const shipment = state.cases[0];
  const questions = getIssues(state, shipment.id).filter((issue) =>
    issue.id.includes(":goods-uncertain-"),
  );
  assert.equal(questions.length, 2);
  const row = shipment.goods[0];
  const changed = applyAction(
    state,
    {
      type: "review_goods",
      caseId: shipment.id,
      goods: shipment.goods,
      reviewedLineIds: [row.id],
      reason: "Compared only the first synthetic row with source.",
    },
    actor,
  );
  const pending = getIssues(changed, shipment.id).filter((issue) =>
    issue.id.includes(":goods-uncertain-"),
  );
  assert.equal(pending.length, 1);
  assert.ok(pending[0].id.endsWith(shipment.goods[1].id));
  const completed = getReviewHistory(changed, shipment.id, getIssues(changed));
  assert.equal(completed.length, 1);
  assert.ok(completed[0].issue.id.endsWith(row.id));
  assert.equal(completed[0].status, "confirmed");
  assert.equal(changed.cases[0].goods[1].reviewed, false);
});

test("saving row edits without explicit confirmation cannot produce a confirmed question history entry", () => {
  const state = fixture();
  const shipment = state.cases[0];
  const goods = structuredClone(shipment.goods);
  goods[0].description = "Corrected synthetic widget A";
  const changed = applyAction(
    state,
    {
      type: "review_goods",
      caseId: shipment.id,
      goods,
      reviewedLineIds: [],
      reason: "Saved one correction without checking any row.",
    },
    actor,
  );
  assert.ok(changed.cases[0].goods.every((line) => !line.reviewed));
  assert.equal(
    getIssues(changed).filter((issue) => issue.id.includes(":goods-uncertain-"))
      .length,
    2,
  );
  assert.equal(
    getReviewHistory(changed, shipment.id, getIssues(changed)).some(
      (entry) => entry.status === "confirmed",
    ),
    false,
  );
});

test("editing one row cannot reopen another row’s explicitly resolved arithmetic question", () => {
  let state = fixture();
  const caseId = state.cases[0].id;
  const goods = structuredClone(state.cases[0].goods);
  goods[1].amount = "22";
  state = applyAction(
    state,
    {
      type: "review_goods",
      caseId,
      goods,
      reviewedLineIds: [],
      reason: "Synthetic arithmetic discrepancy to explain.",
    },
    actor,
  );
  const arithmeticId = `${caseId}:goods-math-${goods[1].id}`;
  state = applyAction(
    state,
    {
      type: "resolve_issue",
      caseId,
      issueId: arithmeticId,
      reason: "Synthetic additional line charge explains this amount.",
    },
    actor,
  );
  const resolved = getIssues(state).find((issue) => issue.id === arithmeticId)!;
  assert.equal(resolved.resolved, true);
  const changed = structuredClone(state.cases[0].goods);
  changed[0].description = "Corrected first row only";
  state = applyAction(
    state,
    {
      type: "review_goods",
      caseId,
      goods: changed,
      reviewedLineIds: [],
      reason: "Edited only the first row.",
    },
    actor,
  );
  const preserved = getIssues(state).find(
    (issue) => issue.id === arithmeticId,
  )!;
  assert.equal(preserved.fingerprint, resolved.fingerprint);
  assert.equal(preserved.resolved, true);
});
