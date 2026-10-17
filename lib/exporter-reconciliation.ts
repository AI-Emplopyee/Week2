import type { Candidate, DocumentType, ShipmentDocument } from './types.ts';

/** User-authorized reconciliation policy, not an additional customs/legal rule. */
export const CORROBORATED_EXPORTER_POLICY = {
  id: 'user-policy:corroborated-exporter',
  origin: 'user_policy' as const,
  section: 'exporter-reconciliation',
  reasonVi: 'Theo yêu cầu đối chiếu tự động của người dùng: chọn người bán trên hóa đơn khi chứng nhận xuất xứ xác nhận cùng tên và địa chỉ; giữ nguyên chứng cứ và các quyết định đã nhập tay.',
  reasonEn: 'User-requested reconciliation: select the invoice seller when the certificate of origin corroborates the same name and address; retain source evidence and existing human decisions.',
};
export type ExporterSourceSelection = { candidates: Candidate[]; supportingCandidates: Candidate[]; rule: typeof CORROBORATED_EXPORTER_POLICY };
type DependencyClear = (field: string, candidates: Candidate[]) => boolean;
const nameKey = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en').replace(/&/g, 'and').replace(/[\s.,]+/g, '');
const addressKey = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en').replace(/^address\s*:\s*/i, '').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
const codeKey = (value: string) => value.normalize('NFKC').trim().toLocaleUpperCase('en').replace(/\s+/g, '');
const explicitCertificateExporter = (candidate: Candidate) => /\bexporter(?:['’]s)?\b|\b(?:products|goods)\s+consigned\s+from\b|người\s+xuất\s+khẩu|nhà\s+xuất\s+khẩu|出口商/iu.test(candidate.originalText);

/** Only already-extracted, explicit header facts can establish the selected entity.
 * No majority voting, fuzzy names, document parsing or value invention occurs. */
export function selectCorroboratedExporter(
  field: string,
  candidates: Candidate[],
  documents: ShipmentDocument[],
  allCandidates: Candidate[],
  dependencyClear: DependencyClear,
): ExporterSourceSelection | undefined {
  if (!['exporter', 'exporterAddress'].includes(field)) return undefined;
  const active = documents.filter(document => document.active && !document.referenceOnly);
  const role = (candidate: Candidate): DocumentType | undefined => active.find(document =>
    document.id === candidate.documentId && document.caseId === candidate.caseId && document.version === candidate.documentVersion,
  )?.pages.find(page => page.page === candidate.page)?.documentType;
  // A supplied contract keeps guide 1.20 authority, including an unread contract.
  if (active.some(document => document.type === 'contract' || document.pages.some(page => page.documentType === 'contract'))) return undefined;
  if (active.some(document =>
    (['invoice', 'certificate_of_origin'].includes(document.type) && !document.pages.length) ||
    document.pages.some(page => ['invoice', 'certificate_of_origin'].includes(page.documentType ?? document.type) &&
      (document.extractionPipeline !== 'kimi' || page.aiReadability !== 'clear' || !document.aiProcessedPages?.includes(page.page))),
  )) return undefined;
  const current = allCandidates.filter(candidate => !candidate.lineId && candidate.method.startsWith('kimi:') && candidate.value.trim() && role(candidate));
  const primary = current.filter(candidate => ['invoice', 'certificate_of_origin'].includes(role(candidate)!));
  const names = primary.filter(candidate => candidate.field === 'exporter');
  if (!names.some(candidate => role(candidate) === 'invoice') || !names.some(candidate => role(candidate) === 'certificate_of_origin')) return undefined;
  // A certificate's manufacturer or logo cannot corroborate the commercial
  // seller. Require the saved quote to state the exporter role explicitly.
  if (names.some(candidate => role(candidate) === 'certificate_of_origin' && !explicitCertificateExporter(candidate))) return undefined;
  const eligible = (candidate: Candidate) => {
    const document = active.find(document => document.id === candidate.documentId && document.caseId === candidate.caseId && document.version === candidate.documentVersion);
    const page = document?.pages.find(page => page.page === candidate.page);
    return document?.extractionPipeline === 'kimi' && !!document.aiProcessedPages?.includes(candidate.page) && page?.aiReadability === 'clear' && candidate.confidence !== 'low' && candidate.readability === 'clear';
  };
  const addresses = primary.filter(candidate => candidate.field === 'exporterAddress');
  if (!names.every(eligible) || !addresses.every(eligible) || new Set(names.map(candidate => nameKey(candidate.value))).size !== 1 || new Set(addresses.map(candidate => addressKey(candidate.value))).size !== 1) return undefined;
  // Bind each primary party name to its address on that same original page.
  if (names.some(name => !addresses.some(address => address.documentId === name.documentId && address.page === name.page))) return undefined;
  const sourceKey = (candidate: Candidate) => `${active.find(document => document.id === candidate.documentId)!.sha256}:${candidate.page}`;
  if (!names.some(invoice => role(invoice) === 'invoice' && names.some(certificate => role(certificate) === 'certificate_of_origin' && sourceKey(invoice) !== sourceKey(certificate)))) return undefined;
  const sameEntityNames = current.filter(candidate => candidate.field === 'exporter' && nameKey(candidate.value) === nameKey(names[0].value));
  const sameEntityAddresses = current.filter(candidate => candidate.field === 'exporterAddress' &&
    sameEntityNames.some(name => name.documentId === candidate.documentId && name.page === candidate.page));
  // A different secondary party may be a manufacturer or shipper. A competing
  // address for this same named seller is a real unresolved contradiction.
  if (!sameEntityNames.every(eligible) || !sameEntityAddresses.every(eligible) ||
    sameEntityAddresses.some(candidate => addressKey(candidate.value) !== addressKey(addresses[0].value))) return undefined;
  const codes = current.filter(candidate => candidate.field === 'exporterCode' &&
    (primary.includes(candidate) || sameEntityNames.some(name => name.documentId === candidate.documentId && name.page === candidate.page)));
  if (codes.length && (!codes.every(eligible) || new Set(codes.map(candidate => codeKey(candidate.value))).size !== 1 || !dependencyClear('exporterCode', codes))) return undefined;
  const invoiceSpelling = (values: Candidate[]) => {
    const source = [...values].filter(candidate => role(candidate) === 'invoice')
      .sort((left, right) => left.documentId.localeCompare(right.documentId) || left.page - right.page || left.id.localeCompare(right.id))[0];
    return source.normalizations.find(change => change.reason.startsWith('party-typography:'))?.before ?? source.value;
  };
  const project = (values: Candidate[], value: string) => values.map(candidate => candidate.value === value ? candidate : {
    ...candidate, value, normalizations: [...candidate.normalizations, {
      before: candidate.value, after: value,
      reason: `${CORROBORATED_EXPORTER_POLICY.id}: Equivalent explicit party typography uses the invoice spelling; original quote, page, image and source identity are retained.`,
    }],
  });
  const selectedNames = project(names, invoiceSpelling(names));
  const selectedAddresses = project(addresses, invoiceSpelling(addresses));
  if (!dependencyClear('exporter', selectedNames) || !dependencyClear('exporterAddress', selectedAddresses)) return undefined;
  const selectedIds = new Set(candidates.map(candidate => candidate.id));
  const selected = (field === 'exporter' ? selectedNames : selectedAddresses).filter(candidate => selectedIds.has(candidate.id));
  if (!selected.length) return undefined;
  return { candidates: selected, supportingCandidates: [...new Map([...names, ...addresses, ...codes].map(candidate => [candidate.id, candidate])).values()], rule: CORROBORATED_EXPORTER_POLICY };
}
