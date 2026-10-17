import { compareDecimal, formatDecimal, multiplyDecimal, parseExactDecimal, type ExactDecimal } from './integrity.ts';
import type { Candidate } from './types.ts';

type Clear = (field: string, candidates: Candidate[]) => boolean;
const normalizedUnit = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const numericKey = (value: ExactDecimal) => formatDecimal(value).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
function kilogramsPerUnit(raw: string, context: string): bigint | undefined {
  // BIPM SI Brochure (2026), Table 8, p. 140: tonne has symbol t and equals 1000 kg.
  // https://www.bipm.org/en/web/guest/publications/si-brochure
  // SI symbols are case-sensitive: an uppercase T is not the tonne symbol.
  if (raw.trim() === 't') return BigInt(1000);
  const unit = normalizedUnit(raw);
  if (/^(KG|KGS|KGM|KILOGRAMS?)$/.test(unit)) return BigInt(1);
  if (/^(?:METRIC[ -])?TONNES?$/.test(unit)) return BigInt(1000);
  // MT alone can name a different unit. Require an explicit metric expansion.
  if (unit === 'MT' && /(?:METRIC[\s-]+TONNES?\s*\(\s*MT\s*\)|MT\s*\(\s*METRIC[\s-]+TONNES?\s*\))/i.test(context)) return BigInt(1000);
  return undefined;
}
type GrossPair = { amount: Candidate; unit: Candidate; kilograms: ExactDecimal };
/** A unit belongs only to the sole clear total on the same original page. */
function grossPairs(candidates: Candidate[], clear: Clear): GrossPair[] | undefined {
  const sources = candidates.filter(candidate => !candidate.lineId && ['grossWeight', 'grossWeightUnit'].includes(candidate.field));
  if (!sources.some(candidate => candidate.field === 'grossWeight')) return undefined;
  const pages = new Map<string, Candidate[]>();
  for (const candidate of sources) {
    const key = JSON.stringify([candidate.documentId, candidate.documentVersion, candidate.page]);
    pages.set(key, [...(pages.get(key) ?? []), candidate]);
  }
  const pairs: GrossPair[] = [];
  for (const page of pages.values()) {
    const amounts = page.filter(candidate => candidate.field === 'grossWeight');
    const units = page.filter(candidate => candidate.field === 'grossWeightUnit');
    if (amounts.length !== 1 || units.length !== 1) return undefined;
    const amount = amounts[0], unit = units[0];
    if (!clear(amount.field, [amount]) || !clear(unit.field, [unit]) || amount.readability === 'uncertain' || unit.readability === 'uncertain') return undefined;
    const number = parseExactDecimal(amount.value);
    const factor = kilogramsPerUnit(unit.value, `${amount.originalText}\n${unit.originalText}`);
    if (!number || factor === undefined) return undefined;
    pairs.push({ amount, unit, kilograms: multiplyDecimal(number, { coefficient: factor, scale: 0 }) });
  }
  return pairs;
}
/** Project current Kimi facts only. Unknown, unclear or multiply associated units block conversion. */
export function normalizeGrossWeightCandidates(candidates: Candidate[], clear: Clear): Candidate[] {
  const pairs = grossPairs(candidates, clear);
  if (!pairs) return candidates;
  const replacements = new Map<string, Candidate>();
  for (const pair of pairs) {
    for (const [source, value] of [[pair.amount, numericKey(pair.kilograms)], [pair.unit, 'KG']] as const) {
      if (source.value === value) continue;
      replacements.set(source.id, { ...source, value, normalizations: [...source.normalizations, {
        before: source.value, after: value,
        reason: `weight-unit: Express the explicit same-page gross total ${pair.amount.value} ${pair.unit.value} in kilograms using exact decimal arithmetic; retain the original amount and unit evidence.`,
      }] });
    }
  }
  return candidates.map(candidate => replacements.get(candidate.id) ?? candidate);
}
function netKilograms(candidate: Candidate): ExactDecimal | undefined {
  const number = parseExactDecimal(candidate.value);
  if (!number) return undefined;
  const literals = [...new Set([candidate.value, ...candidate.normalizations.map(change => change.before)])];
  const factors = new Set<bigint>();
  const literalLocations = new Set<number>(), boundLocations = new Set<number>();
  for (const literal of literals) {
    // Only an explicit unit adjoining the already-read net value is usable. This
    // reads Kimi's saved quotation, never a PDF or an unprocessed source file.
    const literalExpression = new RegExp(`(?:^|[^\\d.,])${escape(literal)}(?![\\d.,])`, 'g');
    for (const match of candidate.originalText.matchAll(literalExpression)) literalLocations.add(match.index!);
    // Preserve the matched spelling so kilogramsPerUnit can distinguish t from T.
    const expression = new RegExp(`(?:^|[^\\d.,])${escape(literal)}\\s*(KILOGRAMS?|KGM|KGS?|(?:METRIC[\\s-]+)?TONNES?|MT|t)(?![A-Za-z])`, 'gi');
    for (const match of candidate.originalText.matchAll(expression)) {
      const factor = kilogramsPerUnit(match[1], candidate.originalText);
      if (factor === undefined) return undefined;
      factors.add(factor);
      boundLocations.add(match.index!);
    }
  }
  return factors.size === 1 && literalLocations.size === 1 && boundLocations.size === 1 ? multiplyDecimal(number, { coefficient: [...factors][0], scale: 0 }) : undefined;
}
/** Compare physical weights only when the selected values still match explicit source units. */
export function comparableWeightTotals(candidates: Candidate[], proposed: Record<string, string>, clear: Clear): { net: ExactDecimal; gross: ExactDecimal } | undefined {
  const gross = grossPairs(candidates, clear);
  const net = candidates.filter(candidate => !candidate.lineId && candidate.field === 'netWeight');
  const proposedGross = parseExactDecimal(proposed.grossWeight ?? ''), proposedNet = parseExactDecimal(proposed.netWeight ?? '');
  if (!gross?.length || !net.length || !proposedGross || !proposedNet || gross.some(pair => compareDecimal(pair.kilograms, proposedGross) !== 0)) return undefined;
  const netValues: ExactDecimal[] = [];
  for (const candidate of net) {
    const source = parseExactDecimal(candidate.value);
    if (!source || compareDecimal(source, proposedNet) !== 0 || !clear(candidate.field, [candidate])) return undefined;
    const kilograms = netKilograms(candidate);
    if (!kilograms) return undefined;
    netValues.push(kilograms);
  }
  return netValues.every(value => compareDecimal(value, netValues[0]) === 0) ? { gross: gross[0].kilograms, net: netValues[0] } : undefined;
}
