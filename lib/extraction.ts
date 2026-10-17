import type { Candidate, Confidence, DocumentType, ShipmentDocument, SourcePage } from './types.ts';
import { ECUS_FORM_FIELDS } from './ecus-form.ts';

/** Compatibility names identify the same source field, never a derived value. */
export function canonicalExtractionField(field: string): string {
  return field === 'customsProcedure' ? 'declarationType' : field;
}

const sourceKey = (field: typeof ECUS_FORM_FIELDS[number]) => field.sourceField ?? field.key;
const numerical = new Set(['invoiceTotal', 'packageCount', 'containerCount', 'grossWeight', 'netWeight', 'quantity', 'unitPrice', 'amount', ...ECUS_FORM_FIELDS.filter(field => ['decimal', 'integer'].includes(field.input)).map(sourceKey)]);
const dateFields = new Set(['invoiceDate', 'packingListDate', 'arrivalDate', ...ECUS_FORM_FIELDS.filter(field => field.input === 'date').map(sourceKey)]);
const percentageFields = new Set(ECUS_FORM_FIELDS.filter(field => /Rate$/.test(sourceKey(field))).map(sourceKey));

/** Normalize only an already-extracted source value; this never reads a document. */
export function normalizeValue(field: string, original: string): { value: string; confidence: Confidence; normalizations: Candidate['normalizations'] } {
  let value = original; const normalizations: Candidate['normalizations'] = [];
  const update = (next: string, reason: string) => { if (next !== value) { normalizations.push({ before: value, after: next, reason }); value = next; } };
  update(value.trim().replace(/\s+/g, ' '), 'Trim leading/trailing whitespace and collapse repeated whitespace.');
  let confidence: Confidence = 'high';
  if (field === 'currency' && /^[A-Za-z]{3}$/.test(value)) update(value.toUpperCase(), 'Normalize the case of an explicit three-letter currency token; no code-table validation.');
  if (dateFields.has(field)) {
    const iso = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value);
    const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
    const named = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[.,\s]+(\d{1,2})[.,\s]*(\d{4})$/i.exec(value);
    let target = '';
    if (iso) target = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
    else if (named) target = `${named[3]}-${String(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(named[1].slice(0, 3).toLowerCase()) + 1).padStart(2, '0')}-${named[2].padStart(2, '0')}`;
    else if (local && Number(local[1]) > 12 && Number(local[2]) <= 12) target = `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
    else if (local && Number(local[2]) > 12 && Number(local[1]) <= 12) target = `${local[3]}-${local[1].padStart(2, '0')}-${local[2].padStart(2, '0')}`;
    else confidence = 'low';
    if (target && !Number.isNaN(Date.parse(target)) && new Date(target).toISOString().slice(0, 10) === target) update(target, 'Normalize an unambiguous valid calendar date to YYYY-MM-DD.');
    else if (target) confidence = 'low';
  }
  if (numerical.has(field)) {
    if (percentageFields.has(field) && /^\d+(?:\.\d+)?\s*%$/.test(value)) update(value.replace(/\s*%$/, ''), 'Separate an explicitly printed percentage sign from its numeric rate; no tax rate is inferred.');
    if (/^\d{1,3}(,\d{3})+\.\d+$/.test(value)) update(value.replace(/,/g, ''), 'Remove explicit thousands separators from a number with a decimal point.');
    if (!/^\d+(?:\.\d+)?$/.test(value)) confidence = 'medium';
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
