import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createEmptyWorkspace,
  getIssues,
  getProposedFields,
  initializeDeclarationDrafts,
} from "../lib/engine.ts";
import { applyFixtureAction as applyAction } from './helpers/kimi-fixtures.ts';
import { syntheticShipments } from "../lib/demo.ts";
import { parseMutation } from "../lib/server-validation.ts";
import { buildReportContent } from "../lib/report-content.ts";
import { getDeclarationEntry } from "../lib/declaration.ts";
import { DECLARATION_FIELDS } from '../lib/declaration-catalog.ts';
import type { SaveDeclarationFieldAction } from "../lib/declaration-types.ts";
import type { Action, Actor, WorkspaceState } from "../lib/types.ts";
import { completeRequiredEcusFixture } from './ecus-fixtures.ts';

const actor: Actor = {
  id: "declaration-reviewer",
  name: "Synthetic declaration reviewer",
  email: "declaration@example.invalid",
};
const act = (state: WorkspaceState, action: Action) =>
  applyAction(state, action, actor);
function ready() {
  let state = act(createEmptyWorkspace("declaration-tests"), {
    type: "intake",
    documents: syntheticShipments()[1].documents,
  });
  const caseId = state.cases[0].id;
  state = act(state, {
    type: "confirm_grouping",
    caseId,
    reason: "Synthetic source grouping checked.",
  });
  for (const [field, value] of Object.entries(
    getProposedFields(state, caseId),
  )) {
    const candidate = state.candidates.find(
      (item) =>
        item.caseId === caseId &&
        !item.lineId &&
        item.field === field &&
        item.value === value,
    )!;
    state = act(state, {
      type: "review_field",
      caseId,
      field,
      value,
      candidateId: candidate.id,
      reason: "Synthetic source value checked.",
    });
  }
  state = act(state, {
    type: "review_goods",
    caseId,
    goods: state.cases[0].goods,
    reviewedLineIds: state.cases[0].goods.map(line => line.id),
    reason: "Synthetic goods reviewed.",
  });
  const netWeight = state.candidates.find(candidate => candidate.field === "netWeight")!;
  state = act(state, { type: "review_field", caseId, field: "netWeight", value: netWeight.value, candidateId: netWeight.id, reason: "Synthetic reviewer explicitly checked the single medium-confidence reading." });
  // This legacy synthetic fixture omits a weight unit. A person supplies it;
  // the application must never infer kilograms from the field's UI label.
  state = act(
    state,
    fieldAction(state, {
      fieldId: "1.28",
      value: { kind: "quantity", amount: "630", unitCode: "KG" },
      provenance: [
        {
          kind: "manual",
          note: "Synthetic broker instruction explicitly states kilograms.",
        },
      ],
      reason: "Synthetic gross-weight unit confirmed.",
    }),
  );
  return completeRequiredEcusFixture(state, caseId, actor);
}
function fieldAction(
  state: WorkspaceState,
  overrides: Partial<SaveDeclarationFieldAction> = {},
): SaveDeclarationFieldAction {
  return {
    type: "save_declaration_field",
    caseId: state.cases[0].id,
    fieldId: "1.40",
    applicability: "applicable",
    basis: "Synthetic commercial evidence checked.",
    value: { kind: "reference", reference: "SYNTHETIC-REFERENCE" },
    provenance: [
      {
        kind: "manual",
        note: "Synthetic broker instruction; current codes not verified.",
      },
    ],
    reason: "Synthetic declaration preparation.",
    review: true,
    ...overrides,
  };
}
function savedField(
  state: WorkspaceState,
  fieldId = "1.40",
  goodsLineId?: string,
) {
  const entry = getDeclarationEntry(
    state.cases[0].declarationDraft,
    fieldId,
    goodsLineId,
  );
  assert.ok(entry, `Expected saved declaration ${fieldId}`);
  return entry;
}

test("legacy cases receive only empty editable drafts and old snapshots are never migrated", () => {
  const state = ready();
  const shipment = state.cases[0];
  delete shipment.declarationDraft;
  state.snapshots.push({
    id: "legacy-snapshot",
    caseId: shipment.id,
    createdAt: "2026-10-10T00:00:00Z",
    actor: actor.name,
    version: 1,
    declaration: structuredClone(shipment),
    documents: [],
    candidates: [],
    issues: [],
    customsValidation: "Not yet assessed",
  });
  const oldSnapshot = JSON.stringify(state.snapshots[0]);
  const existingFields = JSON.stringify(shipment.fields);
  const existingGoods = JSON.stringify(shipment.goods);
  initializeDeclarationDrafts(state);
  assert.deepEqual(shipment.declarationDraft, { schemaVersion: 1, fields: [] });
  assert.equal(JSON.stringify(shipment.fields), existingFields);
  assert.equal(JSON.stringify(shipment.goods), existingGoods);
  assert.equal(JSON.stringify(state.snapshots[0]), oldSnapshot);
  assert.equal(
    getIssues(state, shipment.id).filter(
      (issue) => issue.kind === "declaration",
    ).length,
    38,
    "An empty legacy draft asks for the photographed required headers and each required goods cell.",
  );
});

test("declaration transport accepts typed actions but never caller-authored reviews or arbitrary full drafts", () => {
  const state = ready();
  const action = fieldAction(state);
  assert.deepEqual(
    parseMutation({ revision: state.revision, action }).action,
    action,
  );
  for (const extra of [
    { actorId: "forged" },
    { updatedAt: "2026-10-10" },
    { review: { actorId: "forged" } },
    { codeVerification: "verified" },
  ])
    assert.throws(() =>
      parseMutation({
        revision: state.revision,
        action: { ...action, ...extra },
      }),
    );
  assert.throws(() =>
    parseMutation({
      revision: state.revision,
      action: {
        type: "settings",
        declarationDraft: { schemaVersion: 1, fields: [] },
      },
    }),
  );
});

test("a goods ID named header cannot alias a header entry and erase its removal audit", () => {
  let state = ready();
  const caseId = state.cases[0].id;
  state = act(state, fieldAction(state));
  const original = JSON.stringify(state);
  assert.throws(() =>
    act(state, {
      type: "remove_declaration_field",
      caseId,
      fieldId: "1.40",
      goodsLineId: "header",
      reason: "Synthetic wrong-scope removal.",
    }),
  );
  assert.equal(JSON.stringify(state), original);
  const saved = structuredClone(savedField(state));
  const unrelated = structuredClone(
    state.cases[0].declarationDraft!.fields.filter(
      (entry) => entry.fieldId !== "1.40",
    ),
  );
  state = act(state, {
    type: "remove_declaration_field",
    caseId,
    fieldId: "1.40",
    reason: "Synthetic valid header removal.",
  });
  assert.deepEqual(state.audit.at(-1)?.before, saved);
  assert.deepEqual(state.cases[0].declarationDraft!.fields, unrelated);
});

test("draft saves are unreviewed until explicitly reviewed, with authenticated review metadata and approval gating", () => {
  let state = ready();
  const caseId = state.cases[0].id;
  state = act(state, fieldAction(state, { review: false }));
  const saved = savedField(state);
  assert.equal(saved.review, null);
  assert.equal(saved.updatedBy, actor.id);
  const issue = getIssues(state, caseId).find(
    (item) => item.kind === "declaration",
  )!;
  assert.ok(issue && !issue.resolved);
  assert.throws(() => act(state, { type: "approve", caseId }));
  assert.throws(() =>
    act(state, {
      type: "resolve_issue",
      caseId,
      issueId: issue.id,
      reason: "Cannot waive structural review.",
    }),
  );
  state = act(state, fieldAction(state));
  const reviewed = savedField(state);
  assert.equal(reviewed.review?.actorId, actor.id);
  assert.equal(reviewed.review?.actorName, actor.name);
  assert.equal(reviewed.review?.reason, "Synthetic declaration preparation.");
  assert.ok(reviewed.review?.at);
  assert.equal(reviewed.codeVerification, "unverified");
  assert.equal(
    getIssues(state, caseId).filter((item) => item.kind === "declaration")
      .length,
    0,
  );
  state = act(state, { type: "approve", caseId });
  assert.deepEqual(
    state.snapshots[0].declaration.declarationDraft,
    state.cases[0].declarationDraft,
  );
});

test("exact declaration evidence cannot refer to foreign cases, nonexistent pages, old versions or invented quotations", () => {
  let state = ready();
  const original = state.documents.find((document) => document.active)!;
  const quote = original.pages[0].text.split("\n").find((line) => line.trim())!;
  const source = {
    kind: "document" as const,
    documentId: original.id,
    documentVersion: original.version,
    page: 1,
    quote,
  };
  state = act(state, fieldAction(state, { provenance: [source] }));
  const before = JSON.stringify(state);
  for (const replacement of [
    { ...source, documentVersion: 999 },
    { ...source, page: 50 },
    { ...source, quote: "Invented quotation not in source." },
    { ...source, documentId: "foreign-document" },
  ])
    assert.throws(() =>
      act(state, fieldAction(state, { provenance: [replacement] })),
    );
  const foreign = structuredClone(state);
  foreign.documents.find((document) => document.id === original.id)!.caseId =
    "another-case";
  assert.throws(() =>
    act(foreign, fieldAction(foreign, { provenance: [source] })),
  );
  assert.equal(JSON.stringify(state), before);
});

test("source edits invalidate reviews but repeated confirmations preserve decisions and immutable history", () => {
  let state = ready();
  const caseId = state.cases[0].id;
  state = act(state, fieldAction(state));
  state = act(state, { type: "approve", caseId });
  const snapshot = JSON.stringify(state.snapshots[0]);
  const reviewAudit = state.audit.find(
    (entry) =>
      entry.action === "declaration_field_reviewed" && entry.field === "1.40",
  )!;
  const audit = JSON.stringify(reviewAudit);
  const document = state.documents.find((item) => item.active)!;
  const actions: Action[] = [
    {
      type: "classify_document",
      documentId: document.id,
      documentType: document.type,
    },
    {
      type: "transcribe_document",
      documentId: document.id,
      pages: [{ page: 1, text: document.pages[0].text }],
      reason: "Synthetic transcription checked.",
    },
    {
      type: "replace_document",
      documentId: document.id,
      document: {
        id: "replacement-document",
        name: "synthetic-replacement.txt",
        mime: "text/plain",
        size: 100,
        sha256: "synthetic-replacement-hash",
        pages: document.pages,
        extractionStatus: "extracted",
        synthetic: true,
      },
    },
  ];
  for (const action of actions) {
    const changed = act(state, action);
    assert.equal(savedField(changed).stale, true, action.type);
    assert.equal(changed.cases[0].approval, undefined, action.type);
    assert.ok(
      getIssues(changed, caseId).some((issue) => issue.kind === "declaration"),
      action.type,
    );
    assert.equal(JSON.stringify(changed.snapshots[0]), snapshot);
    assert.equal(
      JSON.stringify(
        changed.audit.find((entry) => entry.id === reviewAudit.id),
      ),
      audit,
    );
  }
  for (const action of [
    {
      type: "confirm_grouping",
      caseId,
      reason: "Synthetic grouping reviewed again.",
    },
    {
      type: "review_goods",
      caseId,
      goods: state.cases[0].goods,
      reviewedLineIds: state.cases[0].goods.map(line => line.id),
      reason: "Synthetic goods checked again.",
    },
  ] satisfies Action[]) {
    const changed = act(state, action);
    assert.deepEqual(savedField(changed), savedField(state), action.type);
    assert.equal(changed.cases[0].approval, undefined);
    assert.equal(JSON.stringify(changed.snapshots[0]), snapshot);
    assert.equal(
      JSON.stringify(
        changed.audit.find((entry) => entry.id === reviewAudit.id),
      ),
      audit,
    );
  }
});

test("goods draft values follow stable line IDs and removed goods create visible orphan issues", () => {
  let state = ready();
  const caseId = state.cases[0].id;
  const first = state.cases[0].goods[0];
  state = act(
    state,
    fieldAction(state, {
      fieldId: "1.83",
      goodsLineId: first.id,
      value: { kind: "quantity", amount: first.quantity, unitCode: first.unit },
    }),
  );
  const second = {
    ...first,
    id: "manual-second-line",
    sourceDocumentId: undefined,
    sourcePage: undefined,
    originalText: undefined,
    description: "Synthetic second item",
  };
  state = act(state, {
    type: "review_goods",
    caseId,
    goods: [second, first],
    reason: "Synthetic second item added before first.",
  });
  assert.equal(state.cases[0].goods[1].id, first.id);
  assert.equal(savedField(state, "1.83", first.id).goodsLineId, first.id);
  state = act(state, {
    type: "review_goods",
    caseId,
    goods: [second],
    reason: "Synthetic first line removed.",
  });
  assert.equal(savedField(state, "1.83", first.id).goodsLineId, first.id);
  assert.ok(
    getIssues(state, caseId).some(
      (issue) => issue.kind === "declaration" && issue.field === "1.83",
    ),
  );
  const removedEntry = structuredClone(savedField(state, "1.83", first.id));
  const removal: Action = {
    type: "remove_declaration_field",
    caseId,
    fieldId: "1.83",
    goodsLineId: first.id,
    reason: "Synthetic orphan explicitly removed after goods correction.",
  };
  assert.deepEqual(
    parseMutation({ revision: state.revision, action: removal }).action,
    removal,
  );
  state = act(state, removal);
  assert.equal(
    getDeclarationEntry(state.cases[0].declarationDraft, "1.83", first.id),
    undefined,
  );
  assert.deepEqual(state.audit.at(-1)?.before, removedEntry);
  assert.equal(state.audit.at(-1)?.after, null);
  assert.ok(
    !getIssues(state, caseId).some(
      (issue) =>
        issue.kind === "declaration" &&
        issue.field === "1.83" &&
        issue.id.includes(first.id),
    ),
  );
  assert.ok(
    state.cases[0].declarationDraft!.fields.some(
      (entry) => entry.goodsLineId === second.id,
    ),
    "Removing one orphan must preserve the new goods row.",
  );
});

test("declaration report includes coverage, typed values, basis, source version and human reasons without mutating evidence", () => {
  let state = ready();
  const document = state.documents.find((item) => item.active)!;
  const quote = document.pages[0].text.split("\n").find((line) => line.trim())!;
  state = act(
    state,
    fieldAction(state, {
      reason: "Nguyên văn lý do người rà soát.",
      provenance: [
        {
          kind: "document",
          documentId: document.id,
          documentVersion: document.version,
          page: 1,
          quote,
        },
      ],
    }),
  );
  const before = JSON.stringify(state);
  const report = buildReportContent(state, state.cases[0].id, "en");
  const text = report.blocks
    .filter((block) => block.kind === "text")
    .map((block) => block.value)
    .join("\n");
  assert.equal(report.data.declarationCoverage.length, DECLARATION_FIELDS.length);
  for (const expected of [
    "SYNTHETIC-REFERENCE",
    "Synthetic commercial evidence checked.",
    "Nguyên văn lý do người rà soát.",
    document.id,
    quote,
    actor.name,
    "Structural coverage:",
    "Codes: unverified",
    "1.96",
    "ecus.goodsCode",
    "Goods code",
    "ecus.exciseTaxAmount",
  ])
    assert.ok(text.includes(expected), expected);
  assert.equal(JSON.stringify(state), before);
});

test("persisted declaration drafts survive archive and reopen while old approved snapshots stay frozen", () => {
  let state = ready();
  const caseId = state.cases[0].id;
  state = act(state, fieldAction(state));
  state = act(state, { type: "approve", caseId });
  state = act(state, { type: "handoff", caseId });
  state = act(state, {
    type: "complete",
    caseId,
    reason: "Synthetic preparation archived.",
  });
  const draft = structuredClone(state.cases[0].declarationDraft);
  const snapshot = JSON.stringify(state.snapshots[0]);
  const reloaded = initializeDeclarationDrafts(
    JSON.parse(JSON.stringify(state)) as WorkspaceState,
  );
  assert.throws(() => act(reloaded, fieldAction(reloaded)), /Mở lại/);
  state = act(reloaded, {
    type: "reopen",
    caseId,
    reason: "Synthetic amendment requested.",
  });
  assert.deepEqual(state.cases[0].declarationDraft, draft);
  assert.equal(state.cases[0].status, "review");
  assert.equal(state.cases[0].approval, undefined);
  state = act(
    state,
    fieldAction(state, {
      value: { kind: "reference", reference: "SYNTHETIC-AMENDMENT" },
      review: false,
    }),
  );
  assert.equal(JSON.stringify(state.snapshots[0]), snapshot);
  assert.deepEqual(state.snapshots[0].declaration.declarationDraft, draft);
});
