import assert from "node:assert/strict";
import { automaticQuestionIssues, syncAutomaticQuestionDrafts } from "../lib/shipment-correspondence.ts";
import test from "node:test";
import { extractDocument } from "./helpers/legacy-extraction.ts";
import { ECUS_FORM_FIELDS, ecusFormValue } from "../lib/ecus-form.ts";
import { applyAction, getIssues } from "../lib/engine.ts";
import { groundKimiProposals } from "../lib/kimi.ts";
import {
  getDeclarationEntry,
  getDeclarationIssues,
  saveDeclarationField,
  validateDeclarationEntry,
} from "../lib/declaration.ts";
import {
  buildShipmentFacts,
  getEcusEvidenceIssues,
  normalizedShipmentValue,
  syncShipmentDeclaration,
} from "../lib/shipment-autofill.ts";
import type {
  DeclarationFieldEntry,
  DeclarationValue,
} from "../lib/declaration-types.ts";
import type {
  Actor,
  ShipmentCase,
  ShipmentDocument,
  WorkspaceState,
} from "../lib/types.ts";

const actor: Actor = {
  id: "autofill-reviewer",
  name: "Synthetic reviewer",
  email: "reviewer@example.invalid",
};
const at = "2026-10-12T00:00:00.000Z";
function fixture(): { state: WorkspaceState; shipment: ShipmentCase } {
  const shipment: ShipmentCase = {
    id: "shipment-1",
    reference: "SYNTHETIC-1",
    title: "Synthetic shipment",
    status: "review",
    caseType: "import",
    assignedTo: actor.name,
    createdAt: at,
    updatedAt: at,
    documentIds: [],
    fields: {},
    goods: [],
    groupingConfidence: "high",
    groupingReason: "Synthetic references match.",
    groupingConfirmed: true,
    synthetic: true,
    resolutions: [],
    declarationDraft: { schemaVersion: 1, fields: [] },
  };
  return {
    shipment,
    state: {
      id: "autofill-tests",
      name: "Synthetic workspace",
      revision: 0,
      cases: [shipment],
      documents: [],
      candidates: [],
      audit: [],
      emails: [],
      snapshots: [],
      handoffs: [],
      settings: {
        inboxProvider: "gmail",
        inboxAddress: "",
        inboxStatus: "not_connected",
        defaultReviewer: actor.name,
      },
    },
  };
}
function addSource(
  state: WorkspaceState,
  shipment: ShipmentCase,
  id: string,
  text: string,
  type: ShipmentDocument["type"] = "invoice",
) {
  const doc: ShipmentDocument = {
    id,
    caseId: shipment.id,
    name: `${id}.txt`,
    type,
    mime: "text/plain",
    size: text.length,
    sha256: `synthetic-${id}`,
    version: 1,
    active: true,
    uploadedAt: at,
    pages: [{ page: 1, text, documentType: type, textSource: "pdf_text" }],
    extractionStatus: "extracted",
    synthetic: true,
  };
  state.documents.push(doc);
  shipment.documentIds.push(id);
  const extracted = extractDocument(doc);
  // These historical parser outputs construct deterministic test fixtures only;
  // runtime shipment evidence is supplied by saved Kimi readings.
  doc.extractionPipeline = "kimi";
  doc.aiProcessedPages = [1];
  doc.aiStatus = "completed";
  doc.pages[0].aiReadability = "clear";
  for (const candidate of extracted.candidates) {
    candidate.method = `kimi:test_fixture:${candidate.method}`;
    candidate.readability = "clear";
  }
  state.candidates.push(...extracted.candidates);
  if (!shipment.goods.length && type === "invoice")
    shipment.goods = extracted.goods;
  return doc;
}
function entry(
  shipment: ShipmentCase,
  field: string,
  goodsLineId?: string,
): DeclarationFieldEntry {
  const found = getDeclarationEntry(
    shipment.declarationDraft,
    field,
    goodsLineId,
  );
  assert.ok(found, `${field} should be populated`);
  return found;
}
function packet() {
  const result = fixture();
  addSource(
    result.state,
    result.shipment,
    "invoice",
    "COMMERCIAL INVOICE\nBuyer: Example Buyer Ltd\nSeller: Example Seller Ltd\nInvoice No: SYN-INV-1\nInvoice Date: 2026-10-01\nCurrency: USD\nInvoice Total: 100.00\nIncoterm: FOB\nDescription | Quantity | Unit | Unit Price | Amount\nWidget | 2 | PCS | 50.00 | 100.00",
  );
  addSource(
    result.state,
    result.shipment,
    "packing",
    "PACKING LIST\nInvoice No: SYN-INV-1\nPackages: 5 PACKAGES\nGross weight: 10.00 KG\nNet weight: 9 KG",
    "packing_list",
  );
  addSource(
    result.state,
    result.shipment,
    "hbl",
    "HOUSE BILL OF LADING\nHBL No: SYN-HBL-1\nMBL No: SYN-MBL-1\nShipper: Forwarding Company\nConsignee: Destination Agent\nVessel: SYNTHETIC VESSEL\nPort of Loading: Origin Port\nPort of Discharge: Destination Port\nPackages: 5 PACKAGES\nGross weight: 10 KG",
    "bill_of_lading",
  );
  return result;
}
const sync = (state: WorkspaceState, shipment: ShipmentCase) =>
  syncShipmentDeclaration(state, shipment, actor);

test("declaration autofill waits until shipment grouping is settled", () => {
  const { state, shipment } = packet();
  shipment.groupingConfirmed = false;
  sync(state, shipment);
  assert.deepEqual(shipment.declarationDraft, { schemaVersion: 1, fields: [] });
  shipment.groupingConfirmed = true;
  sync(state, shipment);
  assert.ok(shipment.declarationDraft!.fields.length > 0);
});

test("shipment autofill combines commercial, packing and transport documents with typed literal citations", () => {
  const { state, shipment } = packet();
  sync(state, shipment);
  assert.deepEqual(entry(shipment, "1.13").value, {
    kind: "entity",
    name: "Example Buyer Ltd",
  });
  assert.deepEqual(entry(shipment, "1.20").value, {
    kind: "entity",
    name: "Example Seller Ltd",
  });
  assert.deepEqual(entry(shipment, "1.41").value, {
    kind: "reference",
    reference: "SYN-INV-1",
  });
  assert.deepEqual(entry(shipment, "1.42").value, {
    kind: "date",
    date: "2026-10-01",
  });
  assert.deepEqual(entry(shipment, "1.44").value, {
    kind: "invoice",
    priceCategoryCode: "",
    incotermCode: "FOB",
    currencyCode: "USD",
    amount: "100.00",
  });
  assert.deepEqual(entry(shipment, "1.27").value, {
    kind: "quantity",
    amount: "5",
    unitCode: "PACKAGES",
  });
  const grossWeight = entry(shipment, "1.28").value;
  assert.equal(grossWeight.kind === "quantity" && grossWeight.amount, "10");
  assert.equal(getDeclarationEntry(shipment.declarationDraft, "1.26"), undefined,
    "Different house and master numbers remain unresolved when neither consignee matches the importer.");
  assert.deepEqual(entry(shipment, "1.33").value, {
    kind: "location",
    code: "",
    name: "Destination Port",
  });
  const goodsId = shipment.goods[0].id;
  assert.deepEqual(entry(shipment, "1.83", goodsId).value, {
    kind: "quantity",
    amount: "2",
    unitCode: "PCS",
  });
  assert.deepEqual(entry(shipment, "1.85", goodsId).value, {
    kind: "decimal",
    amount: "100.00",
  });
  assert.deepEqual(entry(shipment, "1.86", goodsId).value, {
    kind: "unit_price",
    amount: "50.00",
    currencyCode: "USD",
    unitCode: "PCS",
  });
  for (const draft of shipment.declarationDraft!.fields) {
    assert.equal(draft.generatedBy, "shipment_extraction");
    assert.equal(draft.review, null);
    assert.equal(draft.codeVerification, "unverified");
    assert.ok(draft.provenance.length);
    assert.ok(draft.sourceCandidateIds?.length);
    assert.ok(
      !validateDeclarationEntry(
        draft,
        {
          caseId: shipment.id,
          documents: state.documents,
          goods: shipment.goods,
        },
        shipment.declarationDraft,
      ).some((problem) => problem.code === "provenance"),
    );
  }
  assert.equal(
    getDeclarationEntry(shipment.declarationDraft, "1.4"),
    undefined,
    "No customs procedure is inferred.",
  );
  assert.equal(
    getDeclarationEntry(shipment.declarationDraft, "1.79", goodsId),
    undefined,
    "No origin code is inferred from shipment route.",
  );
});

test("duplicate totals are compared exactly, never summed, and input order does not affect draft values", () => {
  const { state, shipment } = packet();
  addSource(
    state,
    shipment,
    "invoice-copy",
    "COMMERCIAL INVOICE\nInvoice No: SYN-INV-1\nInvoice Total: 0100.000\nCurrency: USD",
  );
  sync(state, shipment);
  const value = entry(shipment, "1.44").value;
  assert.ok(value.kind === "invoice");
  assert.equal(normalizedShipmentValue("invoiceTotal", value.amount), "100");
  const before = shipment.declarationDraft!.fields.map((field) => [
    field.fieldId,
    field.goodsLineId,
    field.value,
  ]);
  const shuffled = structuredClone(state);
  const shuffledShipment = shuffled.cases[0];
  shuffled.candidates.reverse();
  shuffled.documents.reverse();
  shuffledShipment.declarationDraft = { schemaVersion: 1, fields: [] };
  sync(shuffled, shuffledShipment);
  assert.deepEqual(
    shuffledShipment.declarationDraft.fields.map((field) => [
      field.fieldId,
      field.goodsLineId,
      field.value,
    ]),
    before,
  );
  assert.equal(
    normalizedShipmentValue(
      "invoiceTotal",
      "9007199254740993.0000000000000001",
    ),
    "9007199254740993.0000000000000001",
  );
});

test("conflicting components stay empty while uncontested parts of the same field still populate", () => {
  const { state, shipment } = packet();
  addSource(
    state,
    shipment,
    "invoice-conflict",
    "COMMERCIAL INVOICE\nInvoice No: SYN-INV-1\nInvoice Total: 200.00\nCurrency: USD",
  );
  sync(state, shipment);
  const draft = entry(shipment, "1.44");
  assert.deepEqual(draft.value, {
    kind: "invoice",
    priceCategoryCode: "",
    incotermCode: "FOB",
    currencyCode: "USD",
    amount: "",
  });
  assert.equal(draft.stale, true);
  assert.equal(
    buildShipmentFacts(state, shipment).invoiceTotal.status,
    "conflict",
  );
  assert.deepEqual(
    buildShipmentFacts(state, shipment).invoiceTotal.alternatives.map(
      (value) => value.value,
    ),
    ["100.00", "200.00"],
  );
});

test("container subsets form one set of evidence rather than a false scalar disagreement", () => {
  const { state, shipment } = fixture();
  addSource(
    state,
    shipment,
    "full-bill",
    "BILL OF LADING\nContainer No: ABCD1234567, EFGH1234567",
    "bill_of_lading",
  );
  addSource(
    state,
    shipment,
    "partial-packing",
    "PACKING LIST\nContainer No: ABCD1234567",
    "packing_list",
  );
  const fact = buildShipmentFacts(state, shipment).container;
  assert.equal(fact.status, "agreed");
  assert.equal(fact.value, "ABCD1234567, EFGH1234567");
  sync(state, shipment);
  assert.equal(
    getDeclarationEntry(shipment.declarationDraft, "1.35"),
    undefined,
    "The number of observed containers does not prove a complete shipment count.",
  );
});

test("late corroboration preserves a reviewed field, but changed facts only flag the affected decision", () => {
  const { state, shipment } = packet();
  sync(state, shipment);
  const invoice = entry(shipment, "1.41");
  const weight = entry(shipment, "1.28");
  for (const field of [invoice, weight])
    field.review = {
      actorId: actor.id,
      actorName: actor.name,
      at,
      reason: "Synthetic evidence checked.",
    };
  const invoiceBefore = structuredClone(invoice);
  const savedWeight = structuredClone(weight.value);
  addSource(
    state,
    shipment,
    "same-invoice",
    "COMMERCIAL INVOICE\nInvoice No: SYN-INV-1",
  );
  sync(state, shipment);
  assert.deepEqual(entry(shipment, "1.41"), invoiceBefore);
  addSource(
    state,
    shipment,
    "new-weight",
    "PACKING LIST\nGross weight: 12 KG",
    "packing_list",
  );
  sync(state, shipment);
  assert.deepEqual(entry(shipment, "1.41"), invoiceBefore);
  assert.deepEqual(entry(shipment, "1.28").value, savedWeight);
  assert.equal(entry(shipment, "1.28").stale, true);
  assert.ok(entry(shipment, "1.28").review);
});

test("a manual declaration decision gets a comparison baseline and is not overwritten", () => {
  const { state, shipment } = packet();
  sync(state, shipment);
  const manual: DeclarationValue = {
    kind: "invoice",
    priceCategoryCode: "",
    incotermCode: "FOB",
    currencyCode: "USD",
    amount: "95.00",
  };
  shipment.declarationDraft = saveDeclarationField(
    shipment.declarationDraft,
    {
      type: "save_declaration_field",
      caseId: shipment.id,
      fieldId: "1.44",
      applicability: "applicable",
      basis: "Synthetic approved discount.",
      value: manual,
      provenance: [
        {
          kind: "manual",
          note: "Synthetic corrected commercial amount confirmed.",
        },
      ],
      reason: "Synthetic confirmed discount.",
      review: true,
    },
    {
      caseId: shipment.id,
      documents: state.documents,
      goods: shipment.goods,
      actor,
      at,
    },
  );
  sync(state, shipment);
  assert.deepEqual(entry(shipment, "1.44").value, manual);
  assert.equal(entry(shipment, "1.44").stale, false);
  addSource(
    state,
    shipment,
    "later-amount",
    "COMMERCIAL INVOICE\nInvoice Total: 105.00",
  );
  sync(state, shipment);
  assert.deepEqual(entry(shipment, "1.44").value, manual);
  assert.equal(entry(shipment, "1.44").stale, true);
});

test("revoked automatic evidence is retired; unrelated manually entered fields remain current", () => {
  const { state, shipment } = packet();
  sync(state, shipment);
  shipment.declarationDraft!.fields.push({
    fieldId: "1.69",
    applicability: "applicable",
    basis: "Synthetic internal record.",
    value: { kind: "reference", reference: "MANUAL-INTERNAL" },
    provenance: [{ kind: "manual", note: "Synthetic internal reference." }],
    reason: "Synthetic manual input.",
    review: {
      actorId: actor.id,
      actorName: actor.name,
      at,
      reason: "Checked.",
    },
    stale: false,
    updatedBy: actor.id,
    updatedAt: at,
    codeVerification: "unverified",
  });
  const saved = structuredClone(entry(shipment, "1.42").value);
  state.documents.find((doc) => doc.id === "invoice")!.active = false;
  sync(state, shipment);
  assert.equal(getDeclarationEntry(shipment.declarationDraft, "1.42"), undefined);
  const removed = (state.audit.at(-1)!.before as DeclarationFieldEntry[]).find(field => field.fieldId === "1.42");
  assert.deepEqual(removed?.value, saved);
  assert.equal(entry(shipment, "1.69").stale, false);
  assert.equal(
    buildShipmentFacts(state, shipment).invoiceNumber?.candidates.some(
      (candidate) => candidate.documentId === "invoice",
    ) ?? false,
    false,
  );
});

test("ambiguous number/date formats are not guessed, and missing units remain explicit blank components", () => {
  const { state, shipment } = fixture();
  addSource(
    state,
    shipment,
    "ambiguous",
    "COMMERCIAL INVOICE\nInvoice Date: 03/04/2026\nInvoice Total: 1,000\nCurrency: USD\nGross weight: 15",
  );
  sync(state, shipment);
  assert.equal(
    getDeclarationEntry(shipment.declarationDraft, "1.42"),
    undefined,
  );
  assert.deepEqual(entry(shipment, "1.44").value, {
    kind: "invoice",
    priceCategoryCode: "",
    incotermCode: "",
    currencyCode: "USD",
    amount: "",
  });
  assert.deepEqual(entry(shipment, "1.28").value, {
    kind: "quantity",
    amount: "15",
    unitCode: "",
  });
});

test("invented or cross-page candidate text cannot become declaration provenance", () => {
  const { state, shipment } = fixture();
  addSource(
    state,
    shipment,
    "source",
    "COMMERCIAL INVOICE\nInvoice No: REAL-REFERENCE",
  );
  const candidate = state.candidates.find(
    (candidate) => candidate.field === "invoiceNumber",
  )!;
  candidate.value = "FORGED-REFERENCE";
  candidate.originalText = "COMMERCIAL INVOICE\nFORGED-REFERENCE";
  sync(state, shipment);
  assert.equal(
    getDeclarationEntry(shipment.declarationDraft, "1.41"),
    undefined,
  );
});

test("rebuilding unchanged source data is a no-op and old snapshots are untouched", () => {
  const { state, shipment } = packet();
  sync(state, shipment);
  state.snapshots.push({
    id: "synthetic-snapshot",
    caseId: shipment.id,
    createdAt: at,
    actor: actor.name,
    version: 1,
    declaration: structuredClone(shipment),
    candidates: structuredClone(state.candidates),
    documents: structuredClone(state.documents),
    issues: [],
    customsValidation: "Not yet assessed",
  });
  const before = JSON.stringify(state);
  sync(state, shipment);
  assert.equal(JSON.stringify(state), before);
});

test("ordinary extracted drafts ask for missing ECUS fields without redundant confirmations, while actual problems still do", () => {
  const { state, shipment } = packet();
  sync(state, shipment);
  const context = {
    caseId: shipment.id,
    documents: state.documents,
    goods: shipment.goods,
  };
  const initialQuestions = getDeclarationIssues(shipment.declarationDraft, context);
  assert.ok(initialQuestions.length > 0);
  assert.ok(initialQuestions.every(issue => issue.ecusFieldKey && issue.id.endsWith(":required")));
  assert.ok(
    shipment.declarationDraft!.fields.every((field) => field.review === null),
    "Removing repetitive questions must not fabricate human reviews.",
  );
  addSource(
    state,
    shipment,
    "conflicting-total",
    "COMMERCIAL INVOICE\nInvoice Total: 500.00",
  );
  sync(state, shipment);
  assert.ok(
    getDeclarationIssues(shipment.declarationDraft, context).some(
      (issue) => issue.field === "1.44",
    ),
  );
  const packageField = entry(shipment, "1.27");
  packageField.generatedBy = undefined;
  assert.ok(
    getDeclarationIssues(shipment.declarationDraft, context).some(
      (issue) => issue.field === "1.27",
    ),
    "An unfinished manual decision remains reviewable.",
  );
  packageField.generatedBy = "shipment_extraction";
  packageField.provenance = [];
  assert.ok(
    getDeclarationIssues(shipment.declarationDraft, context).some(
      (issue) => issue.field === "1.27",
    ),
    "Source proof is still required.",
  );
});

test("party comparisons ignore only Unicode presentation and punctuation spacing, preserving exact source names", () => {
  const variants = [
    "Fictional Supplier Co.,Ltd.",
    "FICTIONAL SUPPLIER CO. , LTD.",
    "Ｆｉｃｔｉｏｎａｌ Supplier Co．，Ltd．",
  ];
  assert.equal(
    new Set(variants.map((value) => normalizedShipmentValue("exporter", value)))
      .size,
    1,
  );
  assert.notEqual(
    normalizedShipmentValue("exporter", variants[0]),
    normalizedShipmentValue("exporter", "Different Supplier Co.,Ltd."),
  );
  assert.notEqual(
    normalizedShipmentValue("exporter", "A.B Co."),
    normalizedShipmentValue("exporter", "AB Co."),
  );
  const { state, shipment } = fixture();
  for (const [index, variant] of variants.entries())
    addSource(
      state,
      shipment,
      `party-${index}`,
      `COMMERCIAL INVOICE\nExporter: ${variant}`,
    );
  const originalCandidates = structuredClone(state.candidates);
  const facts = buildShipmentFacts(state, shipment);
  assert.equal(facts.exporter.status, "agreed");
  syncShipmentDeclaration(state, shipment, actor);
  const seller = entry(shipment, "1.20");
  assert.equal(seller.value.kind, "entity");
  if (seller.value.kind === "entity")
    assert.ok(variants.includes(seller.value.name));
  assert.equal(seller.stale, false);
  assert.equal(seller.provenance.length, variants.length);
  assert.deepEqual(state.candidates, originalCandidates);
  addSource(
    state,
    shipment,
    "different-party",
    "COMMERCIAL INVOICE\nExporter: Different Supplier Co.,Ltd.",
  );
  assert.equal(buildShipmentFacts(state, shipment).exporter.status, "conflict");
  syncShipmentDeclaration(state, shipment, actor);
  assert.equal(entry(shipment, "1.20").stale, true);
});

test("ECUS optional header controls and later repeated rows fill only from their explicit source facts", () => {
  const { state, shipment } = packet();
  addSource(state, shipment, "supplement", [
    "contractNumber: SOURCE-CONTRACT-2",
    "contractDate: 2026-10-03",
    "declarationType: A12",
    "importerCode: 0123456789",
    "paymentMethod: TTR",
    "freightClassification: A",
    "freightCurrency: USD",
    "freightAmount: 0",
    "permitCategory3: TEST-LICENCE",
    "permitNumber3: SOURCE-PERMIT-3",
    "attachmentCategory2: TEST-ATTACHMENT",
    "attachmentNumber2: SOURCE-ATTACHMENT-2",
    "transitLocation2: TEST-LOCATION",
    "transitArrivalDate2: 2026-10-12",
    "remarks: Source note supplied for this shipment.",
  ].join("\n"), "other");
  sync(state, shipment);
  for (const [key, expected] of Object.entries({
    contractNumber: "SOURCE-CONTRACT-2", contractDate: "2026-10-03",
    declarationType: "A12", importerCode: "0123456789", paymentMethod: "TTR",
    freightAmount: "0", permitCategory3: "TEST-LICENCE", permitNumber3: "SOURCE-PERMIT-3",
    attachmentCategory2: "TEST-ATTACHMENT", attachmentNumber2: "SOURCE-ATTACHMENT-2",
    transitLocation2: "TEST-LOCATION", transitArrivalDate2: "2026-10-12",
    remarks: "Source note supplied for this shipment.",
  })) {
    const field = ECUS_FORM_FIELDS.find(field => field.key === key)!;
    assert.equal(ecusFormValue(field, shipment.declarationDraft), expected, key);
  }
  assert.equal(ecusFormValue(ECUS_FORM_FIELDS.find(field => field.key === "permitNumber")!, shipment.declarationDraft), "");
  assert.equal(ecusFormValue(ECUS_FORM_FIELDS.find(field => field.key === "customsOffice")!, shipment.declarationDraft), "", "No customs office is derived from an address or route.");
  const before = JSON.stringify(shipment.declarationDraft);
  sync(state, shipment);
  assert.equal(JSON.stringify(shipment.declarationDraft), before, "Repeated-row IDs and source fingerprints remain stable.");
});

test("all ECUS goods inputs accept explicit source cells, including tax schedules, rates and zero amounts", () => {
  const { state, shipment } = fixture();
  const values: Record<string, string> = {
    goodsCode: "SOURCE-SKU-1", description: "Synthetic source widget", hsCode: "12345678", origin: "VN",
    quantity: "2", unit: "PCS", quantity2: "3", unit2: "KG", unitPrice: "5.00", amount: "10.00",
    taxableUnitPrice: "125000", taxableValue: "250000", importDutySchedule: "SOURCE-NK", dutyRate: "0%", importDutyAmount: "0",
    exciseTaxSchedule: "SOURCE-TTDB", exciseTaxRate: "0%", exciseTaxAmount: "0",
    environmentTaxSchedule: "SOURCE-MT", environmentTaxRate: "0", environmentTaxAmount: "0",
    vatTaxSchedule: "SOURCE-VAT", vatRate: "8%", vatTaxAmount: "20000",
  };
  const fields = ECUS_FORM_FIELDS.filter(field => field.tab === "goods" && !field.readOnly);
  addSource(state, shipment, "full-goods", `COMMERCIAL INVOICE\nCurrency: USD\n${fields.map(field => field.key).join(" | ")}\n${fields.map(field => values[field.key]).join(" | ")}`);
  assert.equal(shipment.goods.length, 1);
  sync(state, shipment);
  for (const field of fields) {
    assert.equal(ecusFormValue(field, shipment.declarationDraft, shipment.goods[0].id), values[field.key].replace("%", ""), field.key);
    const saved = entry(shipment, field.fieldId, shipment.goods[0].id);
    assert.equal(saved.codeVerification, "unverified");
    assert.equal(saved.review, null);
    assert.ok(saved.provenance.length);
  }
  const vat = entry(shipment, "ecus.vatTaxRate", shipment.goods[0].id);
  const vatCandidate = state.candidates.find(candidate => candidate.field === "vatRate")!;
  state.candidates.push({ ...vatCandidate, id: "conflicting-tax", value: "10", originalText: "vatRate: 10" });
  state.documents[0].pages[0].text += "\nvatRate: 10";
  sync(state, shipment);
  assert.equal(entry(shipment, vat.fieldId, shipment.goods[0].id).stale, true);
  assert.deepEqual(entry(shipment, vat.fieldId, shipment.goods[0].id).value, vat.value, "Conflicts do not invent or silently choose a replacement rate.");
});

test("missing ECUS tax cells stay blank and a manually corrected tax amount survives refresh", () => {
  const { state, shipment } = packet();
  sync(state, shipment);
  const goodsLineId = shipment.goods[0].id;
  assert.equal(getDeclarationEntry(shipment.declarationDraft, "ecus.vatTaxAmount", goodsLineId), undefined);
  shipment.declarationDraft = saveDeclarationField(shipment.declarationDraft, {
    type: "save_declaration_field", caseId: shipment.id, fieldId: "ecus.vatTaxAmount", goodsLineId,
    applicability: "applicable", basis: "Explicit reviewer-supplied value.", value: { kind: "decimal", amount: "0" },
    provenance: [{ kind: "manual", note: "Reviewer confirmed this exact zero amount." }], reason: "Confirmed source amount.", review: true,
  }, { caseId: shipment.id, documents: state.documents, goods: shipment.goods, actor, at });
  sync(state, shipment);
  const before = structuredClone(entry(shipment, "ecus.vatTaxAmount", goodsLineId));
  sync(state, shipment);
  assert.deepEqual(entry(shipment, "ecus.vatTaxAmount", goodsLineId), before);
  assert.equal(entry(shipment, "ecus.vatTaxAmount", goodsLineId).stale, false);
  assert.equal(getDeclarationEntry(shipment.declarationDraft, "ecus.exciseTaxAmount", goodsLineId), undefined, "An explicit VAT zero does not fill a different missing tax.");
});

test("legacy reviewed customs procedure populates the ECUS declaration type without inventing a code", () => {
  const { state, shipment } = packet();
  shipment.fields.customsProcedure = {
    value: "A12", source: "manual", reason: "Explicit procedure confirmed by reviewer.",
    reviewedBy: actor.name, reviewedAt: at, stale: false, unverified: true,
  };
  sync(state, shipment);
  assert.deepEqual(entry(shipment, "1.4").value, { kind: "code", code: "A12" });
  assert.equal(entry(shipment, "1.4").provenance[0].kind, "manual");
});

test("repeated descriptions and explicitly different product codes never crossfill goods tax cells", () => {
  for (const repeated of [true, false]) {
    const { state, shipment } = fixture();
    addSource(state, shipment, "invoice", [
      "COMMERCIAL INVOICE", "goodsCode | description | quantity | unit | unitPrice | amount",
      "SKU-A | Widget | 2 | PCS | 5 | 10",
      ...(repeated ? ["SKU-B | Widget | 3 | PCS | 5 | 15"] : []),
    ].join("\n"));
    addSource(state, shipment, "supplement", [
      "COMMERCIAL INVOICE", "goodsCode | description | quantity | unit | unitPrice | amount | vatRate",
      "SKU-B | Widget | 2 | PCS | 5 | 10 | 8",
    ].join("\n"));
    sync(state, shipment);
    assert.equal(getDeclarationEntry(shipment.declarationDraft, "ecus.vatTaxRate", shipment.goods[0].id), undefined);
    assert.equal(ecusFormValue(ECUS_FORM_FIELDS.find(field => field.key === "goodsCode")!, shipment.declarationDraft, shipment.goods[0].id), "SKU-A");
  }
});

test("conflicting optional contract dates ask for clarification even before a draft value exists", () => {
  const { state, shipment } = packet();
  addSource(state, shipment, "contract-a", "contractDate: 2026-10-01", "contract");
  addSource(state, shipment, "contract-b", "contractDate: 2026-10-02", "contract");
  sync(state, shipment);
  assert.equal(getDeclarationEntry(shipment.declarationDraft, "ecus.contractDate"), undefined);
  const questions = getIssues(state, shipment.id).filter(issue => issue.ecusFieldKey === "contractDate");
  assert.equal(questions.length, 1);
  assert.ok(questions[0].id.endsWith(":conflict"));
  assert.equal(questions[0].field, "ecus.contractDate");
  assert.equal(questions[0].candidateIds.length, 2);
  assert.equal(questions[0].resolved, false);
});

test("optional unreadable codes and invalid numbers remain questions until a human correction is saved", () => {
  const { state, shipment } = packet();
  addSource(state, shipment, "optional", "customsProcessingUnit: SOURCE-UNIT\nfreightAmount: 1,000", "other");
  const code = state.candidates.find(candidate => candidate.field === "customsProcessingUnit")!;
  code.confidence = "low";
  sync(state, shipment);
  const questions = getIssues(state, shipment.id);
  assert.ok(questions.some(issue => issue.ecusFieldKey === "customsProcessingUnit" && issue.id.endsWith(":uncertain")));
  assert.ok(questions.some(issue => issue.ecusFieldKey === "freightAmount" && issue.id.endsWith(":invalid")));
  assert.equal(getDeclarationEntry(shipment.declarationDraft, "1.47"), undefined, "Ambiguous freight amounts are not fabricated or converted to zero.");
  const corrected = applyAction(state, {
    type: "save_declaration_field", caseId: shipment.id, fieldId: "1.9", applicability: "applicable",
    basis: "Reviewer checked the explicitly supplied optional code.", value: { kind: "code", code: "SOURCE-UNIT" },
    provenance: [{ kind: "manual", note: "Verified with the sender." }], reason: "Confirmed the correct processing unit.", review: true,
  }, actor);
  assert.ok(!getIssues(corrected, shipment.id).some(issue => issue.ecusFieldKey === "customsProcessingUnit" && !issue.resolved));
  assert.ok(getIssues(corrected, shipment.id).some(issue => issue.ecusFieldKey === "freightAmount" && !issue.resolved));
});

test("unreadable goods taxes keep row-specific evidence and replace redundant required-blank questions", () => {
  const { state, shipment } = fixture();
  addSource(state, shipment, "goods", "COMMERCIAL INVOICE\ndescription | quantity | unit | unitPrice | amount | vatTaxAmount\nWidget | 2 | PCS | 5 | 10 | 1,000");
  sync(state, shipment);
  const questions = getIssues(state, shipment.id).filter(issue => issue.ecusFieldKey === "vatTaxAmount");
  assert.equal(questions.length, 1);
  assert.ok(questions[0].id.endsWith(":invalid"));
  assert.equal(questions[0].goodsLineId, shipment.goods[0].id);
  assert.equal(questions[0].candidateIds.length, 1);
  assert.equal(getDeclarationEntry(shipment.declarationDraft, "ecus.vatTaxAmount", shipment.goods[0].id), undefined);
});

test("supplied guide source rules settle invoice and exporter alternatives while retaining their evidence", () => {
  const { state, shipment } = packet();
  addSource(state, shipment, "packing-date", "Invoice Date: 2026-09-30", "packing_list");
  addSource(state, shipment, "contract-seller", "Seller: Contract Seller Ltd", "contract");
  const facts = buildShipmentFacts(state, shipment);
  assert.equal(facts.invoiceDate.value, "2026-10-01");
  assert.equal(facts.invoiceDate.rule?.section, "1.42");
  assert.ok(facts.invoiceDate.excludedCandidates?.some(candidate => candidate.value === "2026-09-30"));
  assert.equal(facts.exporter.value, "Contract Seller Ltd");
  sync(state, shipment);
  assert.deepEqual(entry(shipment, "1.20").value, { kind: "entity", name: "Contract Seller Ltd" });
  assert.match(entry(shipment, "1.42").basis, /Supplied VNACCS guide 1\.42/);
  assert.match(entry(shipment, "1.20").reason, /Supplied VNACCS guide 1\.20/);
  assert.ok(state.candidates.some(candidate => candidate.field === "invoiceDate" && candidate.value === "2026-09-30"), "Rule selection never erases an alternative source.");
});

test("the guide chooses a bill only when its explicit consignee matches the importer", () => {
  const { state, shipment } = packet();
  const consignee = state.candidates.find(candidate => candidate.field === "houseConsignee")!;
  const source = state.documents.find(document => document.id === consignee.documentId)!;
  source.pages[0].text = source.pages[0].text.replace("Destination Agent", "Example Buyer Ltd");
  consignee.value = "Example Buyer Ltd";
  consignee.originalText = consignee.originalText.replace("Destination Agent", "Example Buyer Ltd");
  const fact = buildShipmentFacts(state, shipment).billOfLading;
  assert.equal(fact.value, "SYN-HBL-1");
  assert.equal(fact.rule?.section, "1.26");
  sync(state, shipment);
  const value = entry(shipment, "1.26").value;
  assert.equal(value.kind === "reference_rows" && value.rows[0].reference, "SYN-HBL-1");
});

test("explicit Kimi semantic facts fill only guide-mapped codes with original source provenance", () => {
  const { state, shipment } = fixture();
  const facts = [
    ["invoiceDocumentKind", "COMMERCIAL INVOICE"],
    ["importerEntityType", "JOINT STOCK COMPANY"],
    ["exporterEntityType", "LIMITED COMPANY"],
    ["transportMethod", "BY SEA"],
    ["shipmentLoadType", "FCL"],
  ];
  const source = addSource(state, shipment, "guide-source", facts.map(([field, value]) => `${field}: ${value}`).join("\n"));
  const grounded = groundKimiProposals(source, source.pages, facts.map(([field, value]) => ({
    field, value, quote: `${field}: ${value}`, page: 1, confidence: "high", readability: "clear", evidence: "text",
  })), "test-kimi");
  state.candidates.push(...grounded.candidates);
  sync(state, shipment);
  for (const [fieldId, expected] of [["1.39", "A"], ["1.7", "4"], ["1.6", "2"]]) {
    const saved = entry(shipment, fieldId);
    assert.deepEqual(saved.value, { kind: "code", code: expected });
    assert.match(saved.basis, /vnaccs-guide:/);
    assert.equal(saved.codeVerification, "unverified");
    assert.ok(saved.provenance.every(proof => proof.kind === "document" && source.pages[0].text.includes(proof.quote)));
  }
  assert.equal(getDeclarationEntry(shipment.declarationDraft, "1.4"), undefined, "No declaration type is inferred from the product or guide alone.");
});

test("text evidence preserves an explicit model score without inventing scores for legacy readings", () => {
  const { state, shipment } = fixture();
  addSource(state, shipment, "scored-text", "COMMERCIAL INVOICE\nInvoice Number: INV-TEXT\nInvoice Date: 2026-10-01");
  const candidate = state.candidates.find(item => item.field === "invoiceNumber")!;
  candidate.confidenceScore = 83.25;
  candidate.confidence = "medium";
  sync(state, shipment);
  const source = entry(shipment, "1.41").provenance[0];
  assert.ok(source.kind === "document");
  assert.equal(source.confidenceScore, 83.25);
  assert.equal(source.candidateId, candidate.id);
  assert.equal(source.visualEvidence, undefined);
  assert.ok(getIssues(state).some(issue => issue.field === "invoiceNumber" && issue.kind === "uncertain"), "A numeric estimate does not promote a single medium-confidence reading.");
  const context = { caseId: shipment.id, documents: state.documents, goods: shipment.goods, candidates: state.candidates, actor, at };
  assert.ok(!validateDeclarationEntry(entry(shipment, "1.41"), context).some(finding => finding.code === "provenance"));
  assert.ok(entry(shipment, "1.42").provenance.every(proof => proof.kind !== "document" || proof.confidenceScore === undefined));
  const field = entry(shipment, "1.41");
  const request = { type: "save_declaration_field" as const, caseId: shipment.id, fieldId: "1.41", applicability: "applicable" as const, basis: field.basis, value: field.value, provenance: [{ ...source, confidenceScore: 99 }], reason: "Attempted changed model estimate.", review: false };
  assert.throws(() => saveDeclarationField(shipment.declarationDraft, request, context), /confidence score/);
});

function partyTypographyFixture() {
  const {state,shipment}=fixture();
  for(const [id,facts] of [
    ['invoice',{importer:'DEMO CORAL-SHIPPING JOINT STOCK COMPANY',importerAddress:'123 SAMPLE STREET,DEMO AREA,VIET NAM',exporter:'SYNTHETIC IMP AND EXP CO.,LTD',exporterAddress:'2ND FLOOR,DEMO BUILDING,CHINA'}],
    ['certificate',{importer:'DEMOCORAL-SHIPPING JOINT STOCK COMPANY',importerAddress:'ADDRESS: 123 SAMPLE STREET, DEMO AREA, VIET NAM',exporter:'SYNTHETIC IMP. & EXP. CO., LTD.',exporterAddress:'2ND FLOOR, DEMO BUILDING, CHINA'}],
  ] as const) {
    const source=addSource(state,shipment,id,Object.entries(facts).map(([field,value])=>`${field}: ${value}`).join('\n'),id==='invoice'?'invoice':'certificate_of_origin');
    state.candidates=state.candidates.filter(candidate=>candidate.documentId!==source.id);
    state.candidates.push(...groundKimiProposals(source,source.pages,Object.entries(facts).map(([field,value])=>({field,value,quote:`${field}: ${value}`,page:1,confidence:'high',confidenceScore:96,readability:'clear',evidence:'text'})),'synthetic-party').candidates);
  }
  return {state,shipment};
}

test('company typography agrees only with matching clear party evidence while raw names and confidence remain exact',()=>{
  const {state,shipment}=partyTypographyFixture();const originals=structuredClone(state.candidates);sync(state,shipment);
  const facts=buildShipmentFacts(state,shipment);
  assert.equal(facts.importer.status,'agreed');assert.equal(facts.exporter.status,'agreed');
  assert.equal(facts.importerAddress.status,'agreed');assert.equal(facts.exporterAddress.status,'agreed');
  assert.deepEqual(state.candidates,originals);
  assert.equal(getIssues(state).some(issue=>issue.kind==='conflict'&&['importer','exporter'].includes(issue.field??'')),false);
  assert.deepEqual(entry(shipment,'1.7').value,{kind:'code',code:'4'});
  const exporter=entry(shipment,'1.20');assert.match(exporter.basis,/party-typography:/);
  assert.ok(exporter.provenance.every(proof=>proof.kind==='document'&&proof.confidenceScore===96&&state.documents.find(doc=>doc.id===proof.documentId)!.pages[0].text.includes(proof.quote)));
});

test('company typography never removes real letter differences, missing corroboration or conflicting identifiers',()=>{
  for(const scenario of ['no-address','unclear-address','other-page','different-name','conflicting-code']) {
    const {state,shipment}=partyTypographyFixture();
    if(scenario==='no-address')state.candidates=state.candidates.filter(candidate=>candidate.field!=='exporterAddress');
    if(scenario==='unclear-address')state.candidates.find(candidate=>candidate.field==='exporterAddress'&&candidate.documentId==='certificate')!.readability='uncertain';
    if(scenario==='other-page')state.candidates.find(candidate=>candidate.field==='exporterAddress'&&candidate.documentId==='certificate')!.page=2;
    if(scenario==='different-name'){const candidate=state.candidates.find(candidate=>candidate.field==='exporter'&&candidate.documentId==='certificate')!;candidate.value='DIFFERENT IMP. & EXP. CO., LTD.';candidate.originalText='exporter: '+candidate.value;state.documents.find(doc=>doc.id==='certificate')!.pages[0].text+='\n'+candidate.originalText;}
    if(scenario==='conflicting-code')for(const [id,code] of [['invoice','ID-A'],['certificate','ID-B']]){const source=state.documents.find(doc=>doc.id===id)!;source.pages[0].text+=`\nexporterCode: ${code}`;state.candidates.push(...groundKimiProposals(source,source.pages,[{field:'exporterCode',value:code,quote:`exporterCode: ${code}`,page:1,confidence:'high',readability:'clear',evidence:'text'}],'synthetic-party').candidates);}
    assert.equal(buildShipmentFacts(state,shipment).exporter.status,'conflict',scenario);
  }
});


test("new conflicts in unreviewed generated values remain external questions while human decisions stay local", () => {
  for (const mode of ['generated', 'reviewed', 'manual'] as const) {
    const { state, shipment } = fixture();
    addSource(state, shipment, 'initial-contract', 'contractDate: 2026-10-01', 'contract');
    sync(state, shipment);
    const captured = entry(shipment, 'ecus.contractDate');
    if (mode !== 'generated') shipment.declarationDraft = saveDeclarationField(shipment.declarationDraft, {
      type: 'save_declaration_field', caseId: shipment.id, fieldId: 'ecus.contractDate', applicability: 'applicable',
      basis: 'Reviewer supplied decision', value: captured.value,
      provenance: mode === 'manual' ? [{kind: 'manual', note: 'Explicit human supplied date.'}] : captured.provenance,
      reason: 'Keep the reviewer decision.', review: mode === 'reviewed',
    }, {caseId: shipment.id, documents: state.documents, candidates: state.candidates, goods: shipment.goods, actor, at});
    addSource(state, shipment, 'later-contract', 'contractDate: 2026-10-02', 'contract');
    sync(state, shipment);
    assert.deepEqual(entry(shipment, 'ecus.contractDate').value, {kind: 'date', date: '2026-10-01'});
    const questions = getEcusEvidenceIssues(state, shipment).filter(issue => issue.ecusFieldKey === 'contractDate');
    assert.equal(questions.length, mode === 'generated' ? 1 : 0, mode);
    if (mode === 'generated') {
      assert.equal(entry(shipment, 'ecus.contractDate').stale, true);
      assert.ok(questions[0].id.endsWith(':conflict')); assert.equal(questions[0].candidateIds.length, 2);
      assert.equal(automaticQuestionIssues(state, shipment, questions).length, 1);
    }
  }
});


test("an omitted automatic goods code becomes a real missing question; human decisions and audit history survive", () => {
  for (const mode of ["generated", "reviewed", "manual"] as const) {
    const { state, shipment } = fixture();
    addSource(state, shipment, "goods-code", "COMMERCIAL INVOICE\ngoodsCode | description | quantity | unit | unitPrice | amount\nOBSOLETE-CODE | Synthetic widget | 2 | PCS | 5 | 10");
    sync(state, shipment);
    const field = ECUS_FORM_FIELDS.find(field => field.key === "goodsCode")!;
    const goodsLineId = shipment.goods[0].id;
    const captured = structuredClone(entry(shipment, field.fieldId, goodsLineId));
    if (mode !== "generated") shipment.declarationDraft = saveDeclarationField(shipment.declarationDraft, {
      type: "save_declaration_field", caseId: shipment.id, fieldId: field.fieldId, goodsLineId,
      applicability: "applicable", basis: "Explicit human decision.", value: captured.value,
      provenance: mode === "manual" ? [{kind: "manual", note: "The reviewer supplied this code."}] : captured.provenance,
      reason: "Keep the human decision.", review: mode === "reviewed",
    }, {caseId: shipment.id, documents: state.documents, candidates: state.candidates, goods: shipment.goods, actor, at});
    // A complete rereading retained the real row but omitted the old mistaken code.
    state.candidates = state.candidates.filter(candidate => candidate.field !== "goodsCode");
    sync(state, shipment);
    const questions = automaticQuestionIssues(state, shipment, getIssues(state, shipment.id));
    const codeQuestion = questions.find(issue => issue.ecusFieldKey === "goodsCode" && issue.goodsLineId === goodsLineId);
    if (mode === "generated") {
      assert.equal(getDeclarationEntry(shipment.declarationDraft, field.fieldId, goodsLineId), undefined);
      assert.equal(ecusFormValue(field, shipment.declarationDraft, goodsLineId), "");
      assert.ok(codeQuestion);
      assert.ok(codeQuestion.id.endsWith(":required"));
      const audit = state.audit.at(-1)!;
      assert.deepEqual((audit.before as DeclarationFieldEntry[]).find(entry => entry.fieldId === field.fieldId && entry.goodsLineId === goodsLineId), captured);
      assert.ok(!(audit.after as DeclarationFieldEntry[]).some(entry => entry.fieldId === field.fieldId && entry.goodsLineId === goodsLineId));
      syncAutomaticQuestionDrafts(state, actor, getIssues(state, shipment.id), "en");
      assert.ok(state.emailDrafts![0].issueIds.includes(codeQuestion.id));
      assert.match(state.emailDrafts![0].body, /Please provide Goods code — goods rows 1/);
    } else {
      assert.deepEqual(entry(shipment, field.fieldId, goodsLineId).value, captured.value);
      assert.equal(codeQuestion, undefined, "Human decisions need local review rather than another supplier request.");
    }
    const stable = structuredClone(state);
    sync(state, shipment);
    assert.deepEqual(state, stable, "The reread result is idempotent.");
  }
});

test("corroborated exporter selection fills the form, removes questions and retains its decision evidence", () => {
  const { state, shipment } = fixture();
  const add = (id: string, type: ShipmentDocument["type"], name: string, address: string) => {
    const quote = type === "certificate_of_origin" ? `Products consigned from (Exporter's business name, address, country) ${name}` : name;
    const doc: ShipmentDocument = {
      id, caseId: shipment.id, name: `${id}.txt`, type, mime: "text/plain", size: 1,
      sha256: id, version: 1, active: true, uploadedAt: at, synthetic: true,
      extractionPipeline: "kimi", extractionStatus: "extracted", aiStatus: "completed", aiProcessedPages: [1],
      pages: [{ page: 1, text: `${quote}\n${address}`, documentType: type, textSource: "kimi", aiReadability: "clear" }],
    };
    state.documents.push(doc);
    shipment.documentIds.push(id);
    for (const [field, value, originalText] of [["exporter", name, quote], ["exporterAddress", address, address]]) {
      state.candidates.push({ id: `${id}-${field}`, caseId: shipment.id, documentId: id, documentVersion: 1,
        page: 1, field, value, originalText, location: "Page 1", confidence: "high", confidenceScore: 98,
        readability: "clear", method: "kimi:test:source_text_proposal", normalizations: [] });
    }
  };
  add("commercial", "invoice", "DEMO IMPORT AND EXPORT CO.,LTD", "2ND FLOOR, DEMO BUILDING, TEST CITY");
  add("origin", "certificate_of_origin", "DEMO IMPORT & EXPORT CO., LTD.", "2ND FLOOR,DEMO BUILDING,TEST CITY");
  add("components", "packing_list", "DEMO MACHINERY CO., LTD.", "68 TEST ROAD, TEST CITY");
  const originalCandidates = structuredClone(state.candidates);
  sync(state, shipment);
  const facts = buildShipmentFacts(state, shipment);
  assert.equal(facts.exporter.status, "agreed");
  assert.equal(facts.exporterAddress.status, "agreed");
  assert.equal(facts.exporter.rule?.origin, "user_policy");
  for (const key of ["exporter", "exporterAddress"]) {
    const field = ECUS_FORM_FIELDS.find(field => field.key === key)!;
    assert.equal(ecusFormValue(field, shipment.declarationDraft), key === "exporter"
      ? "DEMO IMPORT AND EXPORT CO.,LTD" : "2ND FLOOR, DEMO BUILDING, TEST CITY");
    const draft = entry(shipment, field.fieldId);
    assert.match(draft.reason, /Source reconciliation policy:/);
    assert.doesNotMatch(draft.reason, /Supplied VNACCS guide exporter-reconciliation/);
    assert.equal(draft.review, null);
    assert.ok(draft.sourceCandidateIds?.includes("origin-exporter"));
    assert.ok(draft.sourceCandidateIds?.includes("origin-exporterAddress"));
    assert.ok(draft.provenance.some(source => source.kind === "document" && source.documentId === "origin" && source.quote.includes("DEMO BUILDING")));
  }
  assert.deepEqual(state.candidates, originalCandidates, "Reconciliation never rewrites Kimi readings.");
  assert.equal(automaticQuestionIssues(state, shipment, getIssues(state, shipment.id)).some(issue => /^exporter(?:Address)?$/.test(issue.ecusFieldKey ?? "")), false);
  const certificateAddress = state.candidates.find(candidate => candidate.id === "origin-exporterAddress")!;
  certificateAddress.value = "9 CONFLICT ROAD";
  certificateAddress.originalText = "9 CONFLICT ROAD";
  state.documents.find(doc => doc.id === "origin")!.pages[0].text += "\n9 CONFLICT ROAD";
  sync(state, shipment);
  assert.equal(buildShipmentFacts(state, shipment).exporterAddress.status, "conflict");
  assert.ok(automaticQuestionIssues(state, shipment, getIssues(state, shipment.id)).some(issue => issue.ecusFieldKey === "exporterAddress"));
});
