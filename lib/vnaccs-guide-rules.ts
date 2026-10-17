import type { Candidate, DocumentType, ShipmentDocument } from './types.ts';
import { addDecimal, compareDecimal, type ExactDecimal } from './integrity.ts';
import { selectCorroboratedExporter } from './exporter-reconciliation.ts';

/** Guide 1.86 permits unit price × quantity to differ from line value by at most 1. */
export function withinGuideLineTolerance(product: ExactDecimal, amount: ExactDecimal): boolean {
  const delta = addDecimal(product, { coefficient: -amount.coefficient, scale: amount.scale });
  return compareDecimal({ coefficient: delta.coefficient < BigInt(0) ? -delta.coefficient : delta.coefficient, scale: delta.scale }, { coefficient: BigInt(1), scale: 0 }) <= 0;
}

/** Scope is the user's supplied guide, recorded in vnaccs-guide-source.json.
 * These rules select Kimi evidence; they never read document text or run OCR. */
export type GuideRuleDecision = { id: string; section: string; reasonVi: string; reasonEn: string; origin?: 'user_policy' };
const rule = (section: string, reasonVi: string, reasonEn: string): GuideRuleDecision => ({ id: `vnaccs-guide:${section}`, section, reasonVi, reasonEn });
const invoiceRules: Record<string, string> = { invoiceNumber: '1.41', invoiceDate: '1.42', paymentMethod: '1.43', invoiceTotal: '1.44', currency: '1.44', incoterm: '1.44' };
const transportRules: Record<string, string> = { vessel: '1.31', vesselCode: '1.31', voyage: '1.31', arrivalDate: '1.32', portOfDischarge: '1.33', portOfDischargeCode: '1.33' };
/** Only unconditional document-priority rules can supersede a failed secondary reading. */
export function guidePrimaryDocumentTypes(field: string): readonly DocumentType[] | undefined {
  if (invoiceRules[field]) return ['invoice'];
  if (transportRules[field]) return ['bill_of_lading', 'air_waybill'];
  if (field === 'exporter') return ['contract'];
  return undefined;
}
const canonical = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase().replace(/\s*([.,])\s*/g, '$1');
function documentType(candidate: Candidate, documents: ShipmentDocument[]): DocumentType | undefined {
  const doc = documents.find(doc => doc.id === candidate.documentId && doc.caseId === candidate.caseId && doc.version === candidate.documentVersion && doc.active && !doc.referenceOnly);
  return doc?.pages.find(page => page.page === candidate.page)?.documentType ?? doc?.type;
}
function currentSource(candidate: Candidate, documents: ShipmentDocument[]) {
  const doc = documents.find(doc => doc.id === candidate.documentId && doc.caseId === candidate.caseId && doc.version === candidate.documentVersion && doc.active && !doc.referenceOnly);
  const page = doc?.pages.find(page => page.page === candidate.page);
  return !!page && doc?.extractionPipeline === 'kimi' && candidate.method.startsWith('kimi:') && !!candidate.value.trim();
}
function eligible(candidate: Candidate, documents: ShipmentDocument[]) {
  const doc = documents.find(doc => doc.id === candidate.documentId);
  return currentSource(candidate, documents) && candidate.confidence !== 'low' && candidate.readability !== 'uncertain' &&
    doc?.pages.find(page => page.page === candidate.page)?.aiReadability === 'clear' && !!doc?.aiProcessedPages?.includes(candidate.page);
}
type DependencyClear = (field: string, candidates: Candidate[]) => boolean;
// Runtime integration supplies the shared evidence/corroboration check. Direct
// callers stay conservative when they cannot evaluate the original evidence.
const strongDependency: DependencyClear = (_field, candidates) => candidates.every(candidate => candidate.confidence === 'high' && candidate.readability === 'clear');

export function selectGuideCandidates(field: string, candidates: Candidate[], documents: ShipmentDocument[], allCandidates: Candidate[], dependencyClear: DependencyClear = strongDependency): { candidates: Candidate[]; rule?: GuideRuleDecision; supportingCandidates?: Candidate[] } {
  const reconciledExporter = selectCorroboratedExporter(field, candidates, documents, allCandidates, dependencyClear);
  if (reconciledExporter) return reconciledExporter;
  let preferred: Candidate[] = [];
  let decision: GuideRuleDecision | undefined;
  if (invoiceRules[field]) {
    preferred = candidates.filter(candidate => documentType(candidate, documents) === 'invoice');
    decision = rule(invoiceRules[field], 'Lấy thông tin hóa đơn từ hóa đơn thương mại theo hướng dẫn được cung cấp.', 'Use the commercial invoice for this invoice field, as specified in the supplied guide.');
  } else if (field === 'exporter') {
    preferred = candidates.filter(candidate => documentType(candidate, documents) === 'contract');
    decision = rule('1.20', 'Dùng người bán trên hợp đồng; người gửi hàng trên vận đơn có thể là bên khác.', 'Use the seller named in the contract; the transport shipper may be a different party.');
  } else if (transportRules[field]) {
    preferred = candidates.filter(candidate => ['bill_of_lading', 'air_waybill'].includes(documentType(candidate, documents) || ''));
    decision = rule(transportRules[field], 'Dùng chứng từ vận tải cho thông tin vận chuyển theo hướng dẫn được cung cấp.', 'Use the transport document for this transport field, as specified in the supplied guide.');
  } else if (field === 'billOfLading') {
    const importers = allCandidates.filter(candidate => candidate.field === 'importer' && !candidate.lineId && currentSource(candidate, documents));
    const names = new Set(importers.map(candidate => canonical(candidate.value)));
    if (names.size === 1 && importers.every(candidate => eligible(candidate, documents)) && dependencyClear('importer', importers)) preferred = candidates.filter(candidate => {
      const matchingRoles = /house/i.test(candidate.field) ? ['houseConsignee'] : /master/i.test(candidate.field) ? ['masterConsignee'] : ['transportConsignee', 'houseConsignee', 'masterConsignee'];
      const parties = allCandidates.filter(party => party.documentId === candidate.documentId && party.page === candidate.page && matchingRoles.includes(party.field) && currentSource(party, documents));
      return parties.length > 0 && parties.every(party => names.has(canonical(party.value)) && eligible(party, documents)) && dependencyClear(parties[0].field, parties);
    });
    decision = rule('1.26', 'Chọn vận đơn có người nhận hàng trùng người nhập khẩu.', 'Choose the bill whose named consignee matches the importer.');
  }
  // Do not suppress an unclear primary document or choose between conflicting primary sources.
  if (!preferred.length || !preferred.every(candidate => eligible(candidate, documents))) return { candidates };
  const selectedValues = new Set(preferred.map(candidate => canonical(candidate.value)));
  const agreeing = selectedValues.size === 1
    ? candidates.filter(candidate => selectedValues.has(canonical(candidate.value)) && eligible(candidate, documents))
    : preferred;
  return { candidates: agreeing, rule: decision };
}

function derive(source: Candidate, field: string, value: string, decision: GuideRuleDecision): Candidate {
  return { ...source, field, value, normalizations: [...source.normalizations, { before: source.value, after: value, reason: `${decision.id}: ${decision.reasonEn}` }] };
}
function oneValue(candidates: Candidate[]) {
  return candidates.length > 0 && new Set(candidates.map(candidate => canonical(candidate.value))).size === 1;
}

/** Derivations are limited to explicit guide mappings and exact Kimi source facts.
 * Source IDs remain original IDs, so both image regions and quoted text remain inspectable. */
export function deriveGuideCandidates(candidates: Candidate[], documents: ShipmentDocument[], dependencyClear: DependencyClear = strongDependency): Candidate[] {
  const out: Candidate[] = [];
  const raw = (field: string) => candidates.filter(candidate => candidate.field === field && !candidate.lineId && currentSource(candidate, documents));
  const clear = (field: string, sources: Candidate[]) => sources.length > 0 && sources.every(candidate => eligible(candidate, documents)) && dependencyClear(field, sources);
  const has = (field: string) => candidates.some(candidate => candidate.field === field && !candidate.lineId);
  const kinds = raw('invoiceDocumentKind').filter(candidate => documentType(candidate, documents) === 'invoice');
  if (!has('invoiceForm') && clear('invoiceDocumentKind', kinds) && kinds.every(candidate => /^(commercial invoice|h[oó]a đ[oơ]n th[ưu][oơ]ng m[aạ]i)$/i.test(candidate.value.trim()))) {
    out.push(...kinds.map(candidate => derive(candidate, 'invoiceForm', 'A', rule('1.39', 'Hóa đơn thương mại được khai bằng mã A.', 'The guide maps an explicitly identified commercial invoice to form A.'))));
  }
  const type = (value: string): 'company' | 'individual' | undefined => /company|corporation|co\.?\s*,?\s*ltd|limited|joint.stock|c[oô]ng ty|t[oổ] ch[uứ]c/i.test(value) ? 'company' : /^(individual|private individual|c[aá] nh[aâ]n)$/i.test(value.trim()) ? 'individual' : undefined;
  // A legal-form phrase already read inside the party's name is explicit source
  // evidence. Unknown names never imply an individual, and a supplied entity-type
  // reading (including an unclear one) cannot be bypassed by this fallback.
  const companyName = (value: string) => /(?:^|[\s,.(])(?:joint[\s-]*stock[\s-]*company|co\.?\s*,?\s*ltd\.?|company\s+limited|limited\s+liability\s+company|corporation|incorporated|ltd\.?|l\.?l\.?c\.?|c[oô]ng\s+ty)(?=$|[\s,.)])/iu.test(value);
  const entitySources = (field: string, nameField: string) => {
    const explicit = raw(field);
    if (explicit.length) return { field, sources: explicit, support: [] as Candidate[], types: explicit.map(candidate => type(candidate.value)) };
    const selected = selectGuideCandidates(nameField, raw(nameField), documents, candidates, dependencyClear);
    const names = selected.candidates;
    const support = selected.rule?.origin === 'user_policy' ? (selected.supportingCandidates ?? []).map(candidate => ({
      ...candidate, normalizations: [...candidate.normalizations, { before: candidate.value, after: candidate.value, reason: `${selected.rule!.id}: ${selected.rule!.reasonEn}` }],
    })) : [];
    return { field: nameField, sources: names, support, types: names.map(candidate => companyName(candidate.value) ? 'company' as const : undefined) };
  };
  const buyerSource = entitySources('importerEntityType', 'importer'), sellerSource = entitySources('exporterEntityType', 'exporter');
  const buyers = buyerSource.sources, sellers = sellerSource.sources;
  const buyerTypes = new Set(buyerSource.types), sellerTypes = new Set(sellerSource.types);
  if (!has('partyClassification') && clear(buyerSource.field, buyers) && clear(sellerSource.field, sellers) &&
    (buyerSource.field === 'importerEntityType' || oneValue(buyers)) && (sellerSource.field === 'exporterEntityType' || oneValue(sellers)) &&
    buyerTypes.size === 1 && sellerTypes.size === 1 && !buyerTypes.has(undefined) && !sellerTypes.has(undefined)) {
    const buyer = [...buyerTypes][0], seller = [...sellerTypes][0];
    const code = seller === 'company' ? buyer === 'company' ? '4' : '2' : buyer === 'company' ? '3' : '1';
    const evidence = [...new Map([...buyerSource.support, ...sellerSource.support, ...buyers, ...sellers].map(candidate => [candidate.id, candidate])).values()];
    out.push(...evidence.map(candidate => derive(candidate, 'partyClassification', code, rule('1.7', 'Ánh xạ loại người gửi và người nhận được nêu rõ sang mã cá nhân/tổ chức.', 'Map the explicitly stated sender and recipient entity types to the guide’s party code.'))));
  }
  const methods = raw('transportMethod');
  const loads = raw('shipmentLoadType');
  if (!has('transportMode') && clear('transportMethod', methods) && oneValue(methods)) {
    const method = canonical(methods[0].value);
    let code = /^(by )?(air|air freight|đường không)$/.test(method) ? '1' : /^(by )?(road|truck|đường bộ)$/.test(method) ? '4' : /^(by )?(rail|railway|đường sắt)$/.test(method) ? '5' : /^(by )?(river|inland waterway|đường sông)$/.test(method) ? '6' : undefined;
    if (/^(by )?(sea|ocean|sea freight|đường biển)$/.test(method) && clear('shipmentLoadType', loads) && oneValue(loads)) {
      const load = canonical(loads[0].value);
      code = /^(fcl|full container load|containerized|containerised)$/.test(load) ? '2' : /^(lcl|less than container load|cfs|bulk|break bulk|breakbulk|liquid bulk|hàng rời)$/.test(load) ? '3' : undefined;
    }
    if (code) out.push(...[...methods, ...(code === '2' || code === '3' ? loads : [])].map(candidate => derive(candidate, 'transportMode', code!, rule('1.6', 'Ánh xạ phương thức và cách đóng hàng đã được ghi rõ theo hướng dẫn.', 'Map the explicitly documented transport mode and cargo arrangement using the guide.'))));
  }
  const categories = raw('invoicePaymentCategory');
  if (!has('invoicePriceCategory') && clear('invoicePaymentCategory', categories) && oneValue(categories)) {
    const value = canonical(categories[0].value);
    const code = /^(free of charge|foc|hàng không phải trả tiền)$/.test(value) ? 'B' : /^(goods to be paid|payable goods|hàng phải trả tiền)$/.test(value) ? 'A' : /^(paid and free of charge goods|mixed paid and foc)$/.test(value) ? 'C' : undefined;
    if (code) out.push(...categories.map(candidate => derive(candidate, 'invoicePriceCategory', code!, rule('1.44', 'Dùng phân loại thanh toán được ghi rõ; không suy đoán từ tổng tiền.', 'Use the explicitly stated payment category; do not infer it from a positive total.'))));
  }
  return out;
}
