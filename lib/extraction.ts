import type { Candidate, Confidence, DocumentType, ShipmentDocument, SourcePage } from './types.ts';
import { ECUS_FORM_FIELDS } from './ecus-form.ts';
import { explicitIsoDate } from './explicit-date.ts';
import { normalizeExplicitNumber, type NumericNotationEvidence } from './explicit-number.ts';

/** Compatibility names identify the same source field, never a derived value. */
export function canonicalExtractionField(field: string): string {
  return field === 'customsProcedure' ? 'declarationType' : field;
}

const sourceKey = (field: typeof ECUS_FORM_FIELDS[number]) => field.sourceField ?? field.key;
const numerical = new Set(['invoiceTotal', 'packageCount', 'containerCount', 'grossWeight', 'netWeight', 'quantity', 'unitPrice', 'amount', ...ECUS_FORM_FIELDS.filter(field => ['decimal', 'integer'].includes(field.input)).map(sourceKey)]);
const dateFields = new Set(['invoiceDate', 'packingListDate', 'arrivalDate', ...ECUS_FORM_FIELDS.filter(field => field.input === 'date').map(sourceKey)]);
const percentageFields = new Set(ECUS_FORM_FIELDS.filter(field => /Rate$/.test(sourceKey(field))).map(sourceKey));
export const isNumericExtractionField = (field: string) => numerical.has(field);

/** Normalize only an already-extracted source value; this never reads a document. */
export function normalizeValue(field: string, original: string, numericEvidence?: NumericNotationEvidence): { value: string; confidence: Confidence; normalizations: Candidate['normalizations'] } {
  let value = original; const normalizations: Candidate['normalizations'] = [];
  const update = (next: string, reason: string) => { if (next !== value) { normalizations.push({ before: value, after: next, reason }); value = next; } };
  update(value.trim().replace(/\s+/g, ' '), 'Trim leading/trailing whitespace and collapse repeated whitespace.');
  let confidence: Confidence = 'high';
  if (field === 'currency' && /^[A-Za-z]{3}$/.test(value)) update(value.toUpperCase(), 'Normalize the case of an explicit three-letter currency token; no code-table validation.');
  if (dateFields.has(field)) {
    const target = explicitIsoDate(value);
    if (target) update(target, 'Normalize an unambiguous valid calendar date to YYYY-MM-DD.');
    else confidence = 'low';
  }
  if (numerical.has(field)) {
    if (percentageFields.has(field) && /^\d+(?:\.\d+)?\s*%$/.test(value)) update(value.replace(/\s*%$/, ''), 'Separate an explicitly printed percentage sign from its numeric rate; no tax rate is inferred.');
    const normalized = normalizeExplicitNumber(value, numericEvidence);
    if (normalized.reason) {
      // A notation decision can clarify a raw decimal without changing its
      // characters. Keep that evidence-dependent decision in the audit too.
      if (normalized.value === value) normalizations.push({ before: value, after: value, reason: normalized.reason });
      else update(normalized.value, normalized.reason);
    }
    if (normalized.ambiguous) confidence = 'low';
    else if (!/^\d+(?:\.\d+)?$/.test(value)) confidence = 'medium';
  }
  return { value, confidence, normalizations };
}

/** Read classifications already saved from the source reader. */
export function pageDocumentType(document: ShipmentDocument, page: SourcePage): DocumentType {
  return page.documentType ?? document.type;
}
export function documentHasType(document: ShipmentDocument, type: DocumentType): boolean {
  return document.type === type || document.pages.some(page => pageDocumentType(document, page) === type);
}
