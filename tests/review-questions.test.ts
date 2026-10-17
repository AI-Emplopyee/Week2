import test from "node:test";
import assert from "node:assert/strict";
import {
  actionableReviewIssues,
  reviewQuestion,
} from "../lib/review-questions.ts";
import { createEmptyWorkspace } from "../lib/engine.ts";
import type { Candidate, Issue, ShipmentDocument } from "../lib/types.ts";

const issue: Issue = {
  id: "uncertain-weight",
  caseId: "shipment",
  kind: "uncertain",
  severity: "warning",
  title: "Gross weight",
  description: "Unclear",
  field: "grossWeight",
  candidateIds: ["weight"],
  documentIds: ["packing"],
  resolved: false,
  fingerprint: "weight",
};
const candidate: Candidate = {
  id: "weight",
  caseId: "shipment",
  documentId: "packing",
  documentVersion: 1,
  field: "grossWeight",
  value: "10",
  originalText: "Gross weight: 10 KG",
  page: 1,
  location: "text",
  method: "kimi:test_fixture",
  readability: "clear",
  confidence: "medium",
  normalizations: [],
};
const document: ShipmentDocument = {
  id: "packing",
  caseId: "shipment",
  name: "Packing.pdf",
  type: "packing_list",
  mime: "application/pdf",
  size: 1,
  sha256: "hash",
  version: 1,
  active: true,
  uploadedAt: "",
  pages: [{ page: 1, text: "Gross weight: 10 KG", aiReadability: "clear" }],
  extractionStatus: "extracted",
  synthetic: true,
};
function fixture() {
  const state = createEmptyWorkspace("questions");
  state.documents = [structuredClone(document)];
  state.candidates = [structuredClone(candidate)];
  return state;
}

test("unclear values have a confirmable source; missing values never invent one", () => {
  const state = fixture();
  assert.equal(reviewQuestion(state, issue).kind, "confirm");
  assert.deepEqual(reviewQuestion(state, issue).values, ["10"]);
  assert.equal(
    reviewQuestion(state, { ...issue, kind: "missing", candidateIds: [] }).kind,
    "missing",
  );
  assert.deepEqual(
    reviewQuestion(state, { ...issue, kind: "missing", candidateIds: [] })
      .candidates,
    [],
  );
});

test("conflicting evidence asks for a choice and preserves source quotes", () => {
  const state = fixture();
  state.candidates.push({
    ...candidate,
    id: "other",
    value: "12",
    originalText: "Gross weight: 12 KG",
  });
  const question = reviewQuestion(state, {
    ...issue,
    kind: "conflict",
    candidateIds: ["weight", "other"],
  });
  assert.equal(question.kind, "choose");
  assert.deepEqual(question.values, ["10", "12"]);
  assert.equal(question.candidates[1].originalText, "Gross weight: 12 KG");
});

test("review summaries keep corroborated party spacing variants in one choice", () => {
  const state = fixture();
  state.cases.push({ id: "shipment", reference: "SYNTHETIC", title: "Synthetic", status: "review", caseType: "import",
    assignedTo: "", createdAt: "", updatedAt: "", documentIds: ["invoice", "certificate"], fields: {}, goods: [],
    groupingConfidence: "high", groupingReason: "Synthetic fixture", groupingConfirmed: true, synthetic: true, resolutions: [] });
  state.documents = ["invoice", "certificate"].map((id) => ({ ...structuredClone(document), id, sha256: id,
    type: id === "invoice" ? "invoice" : "certificate_of_origin", extractionPipeline: "kimi", aiProcessedPages: [1],
    pages: [{ page: 1, text: `${id === "invoice" ? "DEMO BUYER CO., LTD." : "DEMOBUYER CO., LTD."}\n1 DEMO STREET`, aiReadability: "clear" }] }));
  state.candidates = state.documents.flatMap((doc) => [
    { ...candidate, id: `${doc.id}-name`, documentId: doc.id, field: "importer", confidence: "high" as const,
      value: doc.id === "invoice" ? "DEMO BUYER CO., LTD." : "DEMOBUYER CO., LTD.",
      originalText: doc.id === "invoice" ? "DEMO BUYER CO., LTD." : "DEMOBUYER CO., LTD." },
    { ...candidate, id: `${doc.id}-address`, documentId: doc.id, field: "importerAddress", confidence: "high" as const,
      value: "1 DEMO STREET", originalText: "1 DEMO STREET" },
  ]);
  const source = structuredClone(state.candidates);
  const question = reviewQuestion(state, { ...issue, field: "importer", kind: "stale", candidateIds: ["invoice-name", "certificate-name"] });
  assert.equal(question.kind, "confirm");
  assert.equal(question.values.length, 1);
  assert.deepEqual(question.candidates.map(value => value.value), ["DEMO BUYER CO., LTD.", "DEMOBUYER CO., LTD."]);
  assert.deepEqual(state.candidates, source);
});

test("replaced, moved and cross-shipment evidence cannot be confirmed", () => {
  const state = fixture();
  state.documents[0].version = 2;
  assert.equal(reviewQuestion(state, issue).kind, "review");
  assert.deepEqual(reviewQuestion(state, issue).candidates, []);
  state.documents[0].version = 1;
  state.documents[0].active = false;
  assert.deepEqual(reviewQuestion(state, issue).candidates, []);
  state.documents[0].active = true;
  state.documents[0].caseId = "different";
  assert.deepEqual(reviewQuestion(state, issue).candidates, []);
  state.documents[0].caseId = "shipment";
  state.candidates[0].caseId = "different";
  assert.deepEqual(reviewQuestion(state, issue).candidates, []);
});

test("routine sign-off is not presented as uncertainty, while actual validation findings remain", () => {
  const state = fixture();
  const routine = { ...issue, id: "shipment:review-grossWeight" };
  state.candidates[0].confidence = "high";
  const declaration = {
    ...issue,
    kind: "declaration" as const,
    id: "shipment:declaration:header:1.28:review:review",
  };
  const missing = {
    ...declaration,
    id: "shipment:declaration:header:1.28:required:unitCode",
  };
  assert.deepEqual(
    actionableReviewIssues(state, [routine, declaration, missing]).map(
      (item) => item.id,
    ),
    [missing.id],
  );
  state.candidates[0].confidence = "medium";
  assert.deepEqual(
    actionableReviewIssues(state, [routine]).map((item) => item.id),
    [routine.id],
  );
  assert.deepEqual(
    actionableReviewIssues(state, [{ ...routine, resolved: true }]),
    [],
  );
});

test("equivalent party formatting offers one confirmation while preserving both quotations", () => {
  const state = fixture();
  state.candidates = [
    {
      ...candidate,
      id: "party-a",
      field: "exporter",
      value: "Fictional Supplier Co.,Ltd.",
      originalText: "Exporter: Fictional Supplier Co.,Ltd.",
    },
    {
      ...candidate,
      id: "party-b",
      field: "exporter",
      value: "FICTIONAL SUPPLIER CO. , LTD.",
      originalText: "Exporter: FICTIONAL SUPPLIER CO. , LTD.",
    },
  ];
  const partyIssue = {
    ...issue,
    field: "exporter",
    candidateIds: ["party-a", "party-b"],
  };
  const before = structuredClone(state.candidates);
  const question = reviewQuestion(state, partyIssue);
  assert.equal(question.kind, "confirm");
  assert.deepEqual(question.values, ["Fictional Supplier Co.,Ltd."]);
  assert.deepEqual(question.candidates, before);
  state.candidates[1].value = "Different Supplier Co.,Ltd.";
  assert.equal(reviewQuestion(state, partyIssue).kind, "choose");
});

test("completing one question keeps the other unanswered questions visible and selects the next one", async () => {
  const { expandedReviewIssueId } = await import("../lib/review-questions.ts");
  const state = fixture();
  const weight = { ...issue, id: "shipment:review-grossWeight" };
  const packages = {
    ...issue,
    id: "shipment:review-packageCount",
    field: "packageCount",
    candidateIds: ["packages"],
  };
  const netWeight = {
    ...issue,
    id: "shipment:review-netWeight",
    field: "netWeight",
    candidateIds: ["net"],
  };
  state.candidates.push(
    { ...candidate, id: "packages", field: "packageCount", value: "2" },
    { ...candidate, id: "net", field: "netWeight", value: "9" },
  );
  const pending = actionableReviewIssues(state, [
    { ...weight, resolved: true },
    packages,
    netWeight,
  ]);
  assert.deepEqual(
    pending.map((question) => question.id),
    [packages.id, netWeight.id],
  );
  assert.equal(expandedReviewIssueId(pending, weight.id), packages.id);
  assert.equal(expandedReviewIssueId(pending, netWeight.id), netWeight.id);
  assert.equal(expandedReviewIssueId(pending, "__closed__"), "");
  assert.equal(expandedReviewIssueId([], weight.id), "");
});
