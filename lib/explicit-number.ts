export type DecimalSeparator = '.' | ',';
export type NumericNotationEvidence = { decimalSeparator: DecimalSeparator; reason: string };

/** Interpret only an already-read numeric token, never surrounding document text. */
export function explicitDecimalSeparator(value: string): DecimalSeparator | undefined {
  if (/^\d{1,3}(?:,\d{3})+\.\d+$/.test(value)) return '.';
  if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(value)) return ',';
  const decimal = /^(\d+)([.,])(\d+)$/.exec(value);
  // A single separator before three digits could be a grouping mark. It cannot
  // establish notation for another cell, even if the internal decimal parser
  // already accepts the dot form as a canonical value.
  if (decimal && (decimal[3].length !== 3 || decimal[1].length > 3 || decimal[1] === '0')) return decimal[2] as DecimalSeparator;
  return undefined;
}

export function normalizeExplicitNumber(value: string, evidence?: NumericNotationEvidence): { value: string; reason?: string; ambiguous?: boolean } {
  if (/^\d{1,3}(?:,\d{3})+\.\d+$/.test(value)) return { value: value.replace(/,/g, ''), reason: 'Remove explicit thousands separators from a number with a decimal point.' };
  if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(value)) return { value: value.replace(/\./g, '').replace(',', '.'), reason: 'Normalize explicit dot grouping and comma decimals to a decimal point; retain every printed digit.' };
  if (/^\d{1,3}(?:,\d{3}){2,}$/.test(value)) return { value: value.replace(/,/g, ''), reason: 'Remove multiple explicit three-digit comma grouping marks.' };
  if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(value)) return { value: value.replace(/\./g, ''), reason: 'Remove multiple explicit three-digit dot grouping marks.' };
  const comma = /^(\d+),(\d+)$/.exec(value);
  if (comma && explicitDecimalSeparator(value) === ',') return { value: value.replace(',', '.'), reason: 'Normalize an explicit comma decimal whose shape cannot be a standard three-digit grouping; retain every printed digit.' };
  if (comma && evidence?.decimalSeparator === ',') return { value: value.replace(',', '.'), reason: `Normalize the comma decimal using consistent explicit notation in the same source row. ${evidence.reason}` };
  if (comma && evidence?.decimalSeparator === '.' && /^\d{1,3},\d{3}$/.test(value)) return { value: value.replace(',', ''), reason: `Remove the comma grouping mark using consistent explicit notation in the same source row. ${evidence.reason}` };
  if (comma) return { value, ambiguous: true };
  if (/^\d{1,3}\.\d{3}$/.test(value) && !value.startsWith('0.')) {
    if (evidence?.decimalSeparator === ',') return { value: value.replace('.', ''), reason: `Remove the dot grouping mark using consistent explicit notation in the same source row. ${evidence.reason}` };
    if (evidence?.decimalSeparator === '.') return { value, reason: `Retain the dot decimal using consistent explicit notation in the same source row. ${evidence.reason}` };
    return { value, ambiguous: true };
  }
  return { value };
}
