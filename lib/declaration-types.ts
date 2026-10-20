import type { Actor, Candidate, GoodsLine, ShipmentDocument } from './types.ts';

export type DeclarationApplicability = 'unresolved' | 'applicable' | 'not_applicable';
export type DeclarationProvenance =
  | { kind: 'manual'; note: string }
  | { kind: 'document'; documentId: string; documentVersion: number; page: number; quote: string; candidateId?: string; /** Original model estimate, not a calculated or calibrated probability. */ confidenceScore?: number; visualEvidence?: { candidateId: string; imageSha256: string; bounds: [number, number, number, number]; textAgreement: boolean } };
export type DeclarationValue =
  | { kind: 'text'; text: string }
  | { kind: 'code'; code: string }
  | { kind: 'date'; date: string }
  | { kind: 'year'; year: string }
  | { kind: 'count'; count: string }
  | { kind: 'decimal'; amount: string }
  | { kind: 'reference'; reference: string }
  | { kind: 'entity'; name: string }
  | { kind: 'address'; line1: string; line2: string; city: string; country: string }
  | { kind: 'first_declaration'; reference: string; sequence: string; total: string }
  | { kind: 'quantity'; amount: string; unitCode: string }
  | { kind: 'location'; code: string; name: string }
  | { kind: 'transport'; callSign: string; name: string }
  | { kind: 'invoice'; priceCategoryCode: string; incotermCode: string; currencyCode: string; amount: string }
  | { kind: 'money'; currencyCode: string; amount: string }
  | { kind: 'unit_price'; amount: string; currencyCode: string; unitCode: string }
  | { kind: 'charge'; classificationCode: string; currencyCode: string; amount: string }
  | { kind: 'specific_tax'; amount: string; unitCode: string; currencyCode: string }
  | { kind: 'destination'; locationCode: string; arrivalDate: string }
  | { kind: 'code_reference'; categoryCode: string; reference: string }
  | { kind: 'adjustment_reference'; adjustmentRowId: string; reference: string }
  | { kind: 'reference_rows'; rows: { id: string; reference: string }[] }
  | { kind: 'code_rows'; rows: { id: string; code: string }[] }
  | { kind: 'permit_rows'; rows: { id: string; categoryCode: string; reference: string }[] }
  | { kind: 'adjustments'; rows: { id: string; itemCode: string; classificationCode: string; currencyCode: string; amount: string; allocationFactor: string }[] }
  | { kind: 'transit_rows'; rows: { id: string; locationCode: string; arrivalDate: string; departureDate: string }[] }
  | { kind: 'tax_rows'; rows: { id: string; taxCode: string; rateCode: string }[] }
  | { kind: 'tax_relief_rows'; rows: { id: string; taxRowId: string; reliefCode: string }[] }
  | { kind: 'tax_amount_rows'; rows: { id: string; taxRowId: string; amount: string }[] }
  | { kind: 'blocked'; note: string };
export type DeclarationReview = { actorId: string; actorName: string; at: string; reason: string };
export type DeclarationComponentIssue = { component: string; rowIndex?: number; reason: 'conflict' | 'invalid' };
export type DeclarationFieldEntry = {
  generatedBy?: 'shipment_extraction'; sourceFingerprint?: string; sourceCandidateIds?: string[];
  fieldId: string; goodsLineId?: string; applicability: DeclarationApplicability; basis: string;
  value: DeclarationValue; provenance: DeclarationProvenance[]; reason: string;
  review: DeclarationReview | null; stale: boolean; staleReason?: string;
  /** Current generated cells can be usable while another component still blocks approval. */
  componentIssues?: DeclarationComponentIssue[];
  updatedBy: string; updatedAt: string; codeVerification: 'unverified';
};
export type DeclarationDraft = { schemaVersion: 1; fields: DeclarationFieldEntry[] };
export type SaveDeclarationFieldAction = {
  type: 'save_declaration_field'; caseId: string; fieldId: string; goodsLineId?: string;
  applicability: DeclarationApplicability; basis: string; value: DeclarationValue;
  provenance: DeclarationProvenance[]; reason: string; review: boolean;
};
export type RemoveDeclarationFieldAction = { type: 'remove_declaration_field'; caseId: string; fieldId: string; goodsLineId?: string; reason: string };
export type DeclarationFinding = { code: string; path: string; messageVi: string; messageEn: string };
export type DeclarationCoverage = {
  total: number; modeled: number; editable: number; blocked: number; partial: number;
  /** Existing extractor relationships, not populated declaration entries. */
  sourceSupported: number;
  entries: number; evidenceBacked: number; reviewed: number; manualReviewed: number;
  structurallyValid: number; stale: number; orphaned: number;
  currentLawVerified: 0; ecusMapped: 0;
};
export type DeclarationContext = { caseId: string; documents: ShipmentDocument[]; goods: GoodsLine[]; candidates?: Candidate[] };
export type DeclarationSaveContext = DeclarationContext & { actor: Actor; at: string };
export type DeclarationInput = 'text' | 'long_text' | 'code' | 'date' | 'year' | 'integer' | 'decimal' | 'row_reference';
export type DeclarationComponent = {
  key: string; labelVi: string; labelEn: string; input: DeclarationInput; sourceCell: string;
  nonNegative?: boolean; referenceFieldId?: string;
};
export type DeclarationCatalogField = {
  id: string; labelVi: string; labelEn: string; scope: 'header' | 'item' | 'system';
  tab: 'general_1' | 'general_2' | 'goods'; section: string; sectionVi: string; sectionEn: string;
  kind: DeclarationValue['kind']; components: DeclarationComponent[]; repeatable: boolean;
  editable: boolean; blockedReasonVi?: string; blockedReasonEn?: string;
  blockedComponents: { sourceCell: string; reasonVi: string; reasonEn: string }[];
  structureVi: string; structureEn: string;
  sourceRefs: { sourceId: string; section: string; pages: number[]; effectiveFrom: string }[];
};
