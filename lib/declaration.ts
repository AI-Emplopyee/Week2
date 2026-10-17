import { z } from 'zod';
import { SHIPMENT_TEXT_LIMITS } from './source-text-limits.ts';
import { DECLARATION_CATALOG, getDeclarationField } from './declaration-catalog.ts';
import { VNACCS_FIELDS } from './vnaccs.ts';
import { ECUS_FORM_FIELDS, getEcusRequiredIssues } from './ecus-form.ts';
import { compareDecimal, isIsoDate, parseExactDecimal } from './integrity.ts';
import type { Issue } from './types.ts';
import type { DeclarationContext, DeclarationCoverage, DeclarationDraft, DeclarationFieldEntry, DeclarationFinding, DeclarationProvenance, DeclarationSaveContext, DeclarationValue, RemoveDeclarationFieldAction, SaveDeclarationFieldAction } from './declaration-types.ts';

// Bounds protect the pilot workspace, not legal field lengths or allowed-value tables.
export const DECLARATION_LIMITS = { maxRows: 100, maxEntries: 5000, maxComponentLength: SHIPMENT_TEXT_LIMITS.maxComponentLength, maxTextLength: 12000, maxProvenance: 20 } as const;
const atom = z.string().max(DECLARATION_LIMITS.maxComponentLength);
const id = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_:.\-]+$/);
const goodsId = z.string().min(1).max(300).regex(/^[a-zA-Z0-9_:.\-]+$/);
const row = <T extends z.ZodRawShape>(shape: T) => z.array(z.object({ id, ...shape }).strict()).max(DECLARATION_LIMITS.maxRows);
export const declarationValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().max(DECLARATION_LIMITS.maxTextLength) }).strict(),
  z.object({ kind: z.literal('code'), code: atom }).strict(),
  z.object({ kind: z.literal('date'), date: atom }).strict(),
  z.object({ kind: z.literal('year'), year: atom }).strict(),
  z.object({ kind: z.literal('count'), count: atom }).strict(),
  z.object({ kind: z.literal('decimal'), amount: atom }).strict(),
  z.object({ kind: z.literal('reference'), reference: atom }).strict(),
  z.object({ kind: z.literal('entity'), name: atom }).strict(),
  z.object({ kind: z.literal('address'), line1: atom, line2: atom, city: atom, country: atom }).strict(),
  z.object({ kind: z.literal('first_declaration'), reference: atom, sequence: atom, total: atom }).strict(),
  z.object({ kind: z.literal('quantity'), amount: atom, unitCode: atom }).strict(),
  z.object({ kind: z.literal('location'), code: atom, name: atom }).strict(),
  z.object({ kind: z.literal('transport'), callSign: atom, name: atom }).strict(),
  z.object({ kind: z.literal('invoice'), priceCategoryCode: atom, incotermCode: atom, currencyCode: atom, amount: atom }).strict(),
  z.object({ kind: z.literal('money'), currencyCode: atom, amount: atom }).strict(),
  z.object({ kind: z.literal('unit_price'), amount: atom, currencyCode: atom, unitCode: atom }).strict(),
  z.object({ kind: z.literal('charge'), classificationCode: atom, currencyCode: atom, amount: atom }).strict(),
  z.object({ kind: z.literal('specific_tax'), amount: atom, unitCode: atom, currencyCode: atom }).strict(),
  z.object({ kind: z.literal('destination'), locationCode: atom, arrivalDate: atom }).strict(),
  z.object({ kind: z.literal('code_reference'), categoryCode: atom, reference: atom }).strict(),
  z.object({ kind: z.literal('adjustment_reference'), adjustmentRowId: atom, reference: atom }).strict(),
  z.object({ kind: z.literal('reference_rows'), rows: row({ reference: atom }) }).strict(),
  z.object({ kind: z.literal('code_rows'), rows: row({ code: atom }) }).strict(),
  z.object({ kind: z.literal('permit_rows'), rows: row({ categoryCode: atom, reference: atom }) }).strict(),
  z.object({ kind: z.literal('adjustments'), rows: row({ itemCode: atom, classificationCode: atom, currencyCode: atom, amount: atom, allocationFactor: atom }) }).strict(),
  z.object({ kind: z.literal('transit_rows'), rows: row({ locationCode: atom, arrivalDate: atom, departureDate: atom }) }).strict(),
  z.object({ kind: z.literal('tax_rows'), rows: row({ taxCode: atom, rateCode: atom }) }).strict(),
  z.object({ kind: z.literal('tax_relief_rows'), rows: row({ taxRowId: atom, reliefCode: atom }) }).strict(),
  z.object({ kind: z.literal('tax_amount_rows'), rows: row({ taxRowId: atom, amount: atom }) }).strict(),
  z.object({ kind: z.literal('blocked'), note: atom }).strict(),
]);
const visualEvidenceSchema = z.object({ candidateId: id, imageSha256: z.string().regex(/^[a-f0-9]{64}$/), bounds: z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1), z.number().finite().positive().max(1), z.number().finite().positive().max(1)]).refine(([x, y, width, height]) => x + width <= 1.000001 && y + height <= 1.000001), textAgreement: z.boolean() }).strict();
export const declarationProvenanceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual'), note: z.string().min(1).max(4000) }).strict(),
  z.object({ kind: z.literal('document'), documentId: id, documentVersion: z.number().int().positive(), page: z.number().int().positive(), quote: z.string().min(1).max(SHIPMENT_TEXT_LIMITS.maxQuoteLength), candidateId: id.optional(), confidenceScore: z.number().finite().min(0).max(100).optional(), visualEvidence: visualEvidenceSchema.optional() }).strict(),
]);
const declarationFieldIdSchema = z.string().max(160).refine(fieldId => !!getDeclarationField(fieldId), 'Unknown declaration indicator.');
export const declarationActionSchema = z.object({
  type: z.literal('save_declaration_field'), caseId: id, fieldId: declarationFieldIdSchema, goodsLineId: goodsId.optional(),
  applicability: z.enum(['unresolved', 'applicable', 'not_applicable']), basis: z.string().max(4000), value: declarationValueSchema,
  provenance: z.array(declarationProvenanceSchema).max(DECLARATION_LIMITS.maxProvenance), reason: z.string().min(1).max(4000), review: z.boolean(),
}).strict();
export const declarationRemoveActionSchema = z.object({ type: z.literal('remove_declaration_field'), caseId: id, fieldId: declarationFieldIdSchema, goodsLineId: goodsId.optional(), reason: z.string().min(1).max(4000) }).strict();

export function declarationEntryKey(fieldId: string, goodsLineId?: string): string { return JSON.stringify([fieldId, goodsLineId ?? null]); }
export function getDeclarationEntry(draft: DeclarationDraft | undefined, fieldId: string, goodsLineId?: string): DeclarationFieldEntry | undefined { return draft?.fields.find(entry => declarationEntryKey(entry.fieldId, entry.goodsLineId) === declarationEntryKey(fieldId, goodsLineId)); }
export function emptyDeclarationValue(fieldId: string): DeclarationValue {
  const field = getDeclarationField(fieldId); if (!field) throw new Error('Unknown declaration indicator.');
  if (field.kind === 'blocked') return { kind: 'blocked', note: '' };
  if (field.repeatable) return declarationValueSchema.parse({ kind: field.kind, rows: [] });
  return declarationValueSchema.parse({ kind: field.kind, ...Object.fromEntries(field.components.map(component => [component.key, ''])) });
}
export function newDeclarationRow(fieldId: string): Record<string, string> & { id: string } {
  const field = getDeclarationField(fieldId); if (!field?.repeatable) throw new Error('This indicator does not contain repeating rows.');
  return { id: `row-${crypto.randomUUID()}`, ...Object.fromEntries(field.components.map(component => [component.key, ''])) };
}
/** Migration only creates an empty draft. It never derives values from legacy fields or touches snapshots. */
export function migrateDeclarationDraft(draft?: DeclarationDraft): DeclarationDraft {
  if (draft === undefined) return { schemaVersion: 1, fields: [] };
  if (draft.schemaVersion !== 1 || !Array.isArray(draft.fields)) throw new Error('Unsupported declaration draft version.');
  return structuredClone(draft);
}
export function invalidateDeclarationDraft(draft: DeclarationDraft | undefined, reason: string): DeclarationDraft {
  const next = migrateDeclarationDraft(draft);
  for (const entry of next.fields) { entry.stale = true; entry.staleReason = reason; }
  return next;
}
function hasValue(value: DeclarationValue): boolean {
  if ('rows' in value) return value.rows.some(item => Object.entries(item).some(([key, content]) => key !== 'id' && String(content).trim()));
  return Object.entries(value).some(([key, content]) => key !== 'kind' && String(content).trim());
}
function rowValues(value: DeclarationValue): Record<string, string>[] { return 'rows' in value ? value.rows : [value as unknown as Record<string, string>]; }
/** A visual transcript is checked against saved, server-grounded evidence, not rewritten OCR text. */
export function isDeclarationSourceCurrent(source: DeclarationProvenance, context: DeclarationContext): boolean {
  if (source.kind === 'manual') return !!source.note.trim();
  const document = context.documents.find(doc => doc.id === source.documentId && doc.caseId === context.caseId && doc.active && doc.version === source.documentVersion);
  const page = document?.pages.find(page => page.page === source.page);
  if (!page || !source.quote.trim()) return false;
  if (source.confidenceScore !== undefined && (!Number.isFinite(source.confidenceScore) || source.confidenceScore < 0 || source.confidenceScore > 100)) return false;
  if (source.candidateId !== undefined || source.confidenceScore !== undefined) {
    const candidateId = source.candidateId ?? source.visualEvidence?.candidateId;
    if (!candidateId || (source.visualEvidence && candidateId !== source.visualEvidence.candidateId)) return false;
    const candidate = context.candidates?.find(item => item.id === candidateId && item.caseId === context.caseId && item.documentId === source.documentId && item.documentVersion === source.documentVersion && item.page === source.page);
    // A reread may change only the estimate. That does not revoke the same
    // literal source or invalidate a human decision; scores are informational.
    if (!candidate?.method.startsWith('kimi:') || !candidate.originalText.includes(source.quote)) return false;
  }
  if (!source.visualEvidence) return page.text.includes(source.quote);
  const evidence = source.visualEvidence;
  if (!visualEvidenceSchema.safeParse(evidence).success) return false;
  const candidate = context.candidates?.find(item => item.id === evidence.candidateId && item.caseId === context.caseId && item.documentId === source.documentId && item.documentVersion === source.documentVersion && item.page === source.page);
  return !!candidate?.visualEvidence && candidate.method.startsWith('kimi:') && candidate.originalText === source.quote && candidate.visualEvidence.imageSha256 === evidence.imageSha256 && candidate.visualEvidence.textAgreement === evidence.textAgreement && JSON.stringify(candidate.visualEvidence.bounds) === JSON.stringify(evidence.bounds);
}
function provenanceProblems(entry: DeclarationFieldEntry, context: DeclarationContext): DeclarationFinding[] {
  return entry.provenance.flatMap((source, index) => isDeclarationSourceCurrent(source, context) ? [] : [{
    code: 'provenance', path: `provenance.${index}`,
    messageVi: source.kind === 'manual' ? 'Cần ghi nguồn/căn cứ nhập tay.' : 'Bằng chứng phải khớp văn bản hoặc vùng ảnh AI đã lưu của đúng trang và phiên bản chứng từ hiện hành.',
    messageEn: source.kind === 'manual' ? 'Describe the manual source or basis.' : 'Evidence must match page text or saved AI image evidence from the active document version in this case.',
  }]);
}
/** Integrity only: no legal applicability, current code membership, precision limit or customs eligibility is inferred. */
export function validateDeclarationEntry(entry: DeclarationFieldEntry, context: DeclarationContext, draft?: DeclarationDraft): DeclarationFinding[] {
  const findings: DeclarationFinding[] = [];
  const add = (code: string, path: string, messageVi: string, messageEn: string) => findings.push({ code, path, messageVi, messageEn });
  const field = getDeclarationField(entry.fieldId);
  if (!field) { add('unknown_field','fieldId','Chỉ tiêu chưa có trong danh mục.','Unknown declaration indicator.'); return findings; }
  if (!field.editable) add('blocked','fieldId',field.blockedReasonVi!,field.blockedReasonEn!);
  if (field.scope === 'item' && (!entry.goodsLineId || !context.goods.some(line => line.id === entry.goodsLineId))) add('orphan','goodsLineId','Dòng hàng liên kết không còn trong hồ sơ; xóa bản nhập này hoặc khôi phục dòng hàng đúng ID.','The linked goods line is absent; remove this entry or restore the goods line with its original ID.');
  if (field.scope !== 'item' && entry.goodsLineId !== undefined) add('scope','goodsLineId','Chỉ tiêu phần chung không được gắn ID dòng hàng.','A header indicator cannot be bound to a goods line.');
  const parsed = declarationValueSchema.safeParse(entry.value);
  if (!parsed.success || entry.value.kind !== field.kind) { add('shape','value','Cấu trúc dữ liệu không đúng chỉ tiêu.','The value shape does not match this indicator.'); return findings; }
  if (entry.applicability === 'unresolved') add('applicability','applicability','Chưa xác nhận chỉ tiêu có áp dụng cho hồ sơ này.','Applicability has not been explicitly decided for this case.');
  if (entry.applicability !== 'unresolved' && !entry.basis.trim()) add('basis','basis','Cần ghi căn cứ cho quyết định áp dụng / không áp dụng.','Record the basis for applicable / not-applicable status.');
  // Not-applicable entries retain explicitly entered context; applicability/basis determines its use.
  // Changing applicability must never silently destroy source data.
  if (entry.applicability === 'applicable' && !hasValue(entry.value)) add('empty','value','Đã xác nhận áp dụng nhưng chưa nhập dữ liệu.','The indicator is applicable but has no captured value.');
  if (!entry.provenance.length) add('provenance_missing','provenance','Cần ghi nguồn chứng từ hoặc căn cứ nhập tay.','Record documentary evidence or a manual source basis.');
  findings.push(...provenanceProblems(entry, context));
  const rows = rowValues(entry.value);
  if ('rows' in entry.value && new Set(entry.value.rows.map(row => row.id)).size !== rows.length) add('duplicate_row','value.rows','ID các dòng lặp phải khác nhau.','Repeating-row IDs must be unique.');
  rows.forEach((record, index) => {
    const prefix = field.repeatable ? `value.rows.${record.id || index}` : 'value';
    for (const component of field.components) {
      const raw = record[component.key];
      if (!raw) continue;
      if (component.input === 'date' && !isIsoDate(raw)) add('date',`${prefix}.${component.key}`,'Ngày phải có dạng YYYY-MM-DD và là ngày có thực; không đoán ngày mơ hồ.','Use a real YYYY-MM-DD calendar date; ambiguous dates are not guessed.');
      if (component.input === 'year' && (!/^\d{4}$/.test(raw) || raw === '0000')) add('year',`${prefix}.${component.key}`,'Năm phải gồm bốn chữ số và khác 0000.','Use a four-digit year other than 0000.');
      if (['decimal','integer'].includes(component.input) && !parseExactDecimal(raw, { integer: component.input === 'integer', signed: component.input !== 'integer' && !component.nonNegative })) add('number',`${prefix}.${component.key}`,'Cần số rõ ràng, không dấu phân nhóm hoặc số mũ; số đếm không có phần thập phân.','Use an unambiguous number without grouping separators or exponents; counts must be integers.');
      if (component.input === 'row_reference') {
        const target = getDeclarationEntry(draft, component.referenceFieldId!, component.referenceFieldId === '1.49' ? undefined : entry.goodsLineId);
        const targetRow = target && 'rows' in target.value ? target.value.rows.find(row => row.id === raw) : undefined;
        if (!targetRow) add('reference',`${prefix}.${component.key}`,'Dòng được tham chiếu không còn tồn tại đúng nhóm / dòng hàng; không tự đổi liên kết sang dòng khác.','The referenced row is absent from the correct group/goods line; links are never rebound automatically.');
        else if (entry.applicability === 'applicable' && (target!.applicability !== 'applicable' || !Object.entries(targetRow).some(([key, content]) => key !== 'id' && content.trim()))) add('reference',`${prefix}.${component.key}`,'Chỉ tiêu đang áp dụng phải tham chiếu dòng có dữ liệu thuộc chỉ tiêu đã xác nhận áp dụng; dữ liệu lưu để tham khảo không tạo liên kết đang dùng.','An applicable entry must reference a populated row in an applicable indicator; retained reference context is not an active dependency.');
      }
    }
    if ('arrivalDate' in record && 'departureDate' in record && isIsoDate(record.arrivalDate) && isIsoDate(record.departureDate) && record.arrivalDate > record.departureDate) add('date_order',prefix,'Ngày rời điểm trung chuyển trước ngày đến.','Transit departure date precedes arrival date.');
    // Pairing describes the entered measurement, not a claim that any given indicator is mandatory.
    if (['invoice','charge','money','unit_price','specific_tax','adjustments'].includes(field.kind) && !['1.86','1.87'].includes(field.id) && !!record.currencyCode !== !!record.amount) add('money_pair',prefix,'Khi nhập số tiền hoặc đồng tiền, cần cả hai để xác định trị số tiền tệ.','When entering an amount or its currency, provide both to identify the monetary value.');
    if (field.kind === 'quantity' && !!record.amount !== !!record.unitCode) add('quantity_pair',prefix,'Khi nhập số lượng hoặc đơn vị, cần cả hai để xác định đại lượng.','When entering quantity or unit, provide both to identify the measurement.');
    if (field.kind === 'tax_relief_rows' && record.reliefCode && !record.taxRowId) add('reference',prefix,'Mã miễn/giảm cần liên kết tới dòng sắc thuế đã nhập.','Link the relief code to its captured tax-category row.');
    if (field.kind === 'tax_amount_rows' && record.amount && !record.taxRowId) add('reference',prefix,'Số tiền giảm cần liên kết tới dòng sắc thuế đã nhập.','Link the reduction amount to its captured tax-category row.');
  });
  if (entry.value.kind === 'first_declaration') {
    const sequence = parseExactDecimal(entry.value.sequence, { integer: true }); const total = parseExactDecimal(entry.value.total, { integer: true });
    if (sequence && total && compareDecimal(sequence,total) > 0) add('sequence','value.sequence','Thứ tự tờ khai không thể lớn hơn tổng số tờ khai đã nhập.','Declaration sequence cannot exceed the captured total declaration count.');
  }
  return findings;
}
function staleDependents(draft: DeclarationDraft, fieldId: string, goodsLineId: string | undefined) {
  const dependentIds = fieldId === '1.49' ? ['1.88'] : fieldId === '1.94' ? ['1.95','1.96'] : [];
  for (const entry of draft.fields) if (dependentIds.includes(entry.fieldId) && (fieldId === '1.49' || entry.goodsLineId === goodsLineId)) { entry.stale = true; entry.staleReason = `Referenced indicator ${fieldId} changed.`; }
}
export function saveDeclarationField(draft: DeclarationDraft | undefined, requested: SaveDeclarationFieldAction, context: DeclarationSaveContext): DeclarationDraft {
  const action = declarationActionSchema.parse(requested);
  if (action.caseId !== context.caseId) throw new Error('Declaration case mismatch.');
  if (!action.reason.trim()) throw new Error('Record a reason for the declaration edit.');
  if (!context.actor.id.trim() || !context.actor.name.trim() || !context.at || Number.isNaN(Date.parse(context.at))) throw new Error('An authenticated actor and server timestamp are required.');
  const field = getDeclarationField(action.fieldId);
  if (!field?.editable) throw new Error(field?.blockedReasonEn ?? 'Unknown declaration indicator.');
  if (action.value.kind !== field.kind) throw new Error('Declaration value does not match the indicator structure.');
  if (field.scope === 'item' ? !action.goodsLineId || !context.goods.some(line => line.id === action.goodsLineId) : action.goodsLineId !== undefined) throw new Error('Declaration field scope or goods-line identity is invalid.');
  if ('rows' in action.value && new Set(action.value.rows.map(row => row.id)).size !== action.value.rows.length) throw new Error('Repeating-row IDs must be unique.');
  const next = migrateDeclarationDraft(draft);
  for (const source of action.provenance) {
    if (source.kind !== 'document' || source.confidenceScore === undefined) continue;
    const candidateId = source.candidateId ?? source.visualEvidence?.candidateId;
    const candidate = context.candidates?.find(item => item.id === candidateId && item.caseId === context.caseId && item.documentId === source.documentId && item.documentVersion === source.documentVersion && item.page === source.page);
    const previouslyRecorded = next.fields.some(saved => saved.provenance.some(proof => JSON.stringify(proof) === JSON.stringify(source)));
    if (!previouslyRecorded && candidate?.confidenceScore !== source.confidenceScore) throw new Error('A model confidence score must match its saved source candidate.');
  }
  const entry: DeclarationFieldEntry = { fieldId: action.fieldId, ...(action.goodsLineId !== undefined ? { goodsLineId: action.goodsLineId } : {}), applicability: action.applicability, basis: action.basis, value: structuredClone(action.value), provenance: structuredClone(action.provenance), reason: action.reason, review: action.review ? { actorId: context.actor.id, actorName: context.actor.name, at: context.at, reason: action.reason } : null, stale: false, updatedBy: context.actor.id, updatedAt: context.at, codeVerification: 'unverified' };
  const invalidEvidence = provenanceProblems(entry, context);
  if (invalidEvidence.length) throw new Error(invalidEvidence[0].messageEn);
  const problems = validateDeclarationEntry(entry, context, next);
  if (action.review && problems.length) throw new Error(problems[0].messageEn);
  const index = next.fields.findIndex(existing => declarationEntryKey(existing.fieldId,existing.goodsLineId) === declarationEntryKey(entry.fieldId,entry.goodsLineId));
  const prior = index >= 0 ? next.fields[index] : undefined;
  if (index >= 0) next.fields[index] = entry; else { if (next.fields.length >= DECLARATION_LIMITS.maxEntries) throw new Error('Declaration entry limit reached.'); next.fields.push(entry); }
  if (!prior || JSON.stringify({value:prior.value,applicability:prior.applicability,basis:prior.basis,provenance:prior.provenance}) !== JSON.stringify({value:entry.value,applicability:entry.applicability,basis:entry.basis,provenance:entry.provenance})) staleDependents(next, entry.fieldId, entry.goodsLineId);
  return next;
}
export function removeDeclarationField(draft: DeclarationDraft | undefined, requested: RemoveDeclarationFieldAction, context: DeclarationContext): DeclarationDraft {
  const action = declarationRemoveActionSchema.parse(requested);
  if (action.caseId !== context.caseId || !action.reason.trim()) throw new Error('Matching case and a removal reason are required.');
  const next = migrateDeclarationDraft(draft); const key = declarationEntryKey(action.fieldId,action.goodsLineId);
  if (!next.fields.some(entry => declarationEntryKey(entry.fieldId,entry.goodsLineId) === key)) throw new Error('Declaration entry not found.');
  next.fields = next.fields.filter(entry => declarationEntryKey(entry.fieldId,entry.goodsLineId) !== key);
  staleDependents(next, action.fieldId, action.goodsLineId);
  return next;
}
function fingerprint(value: unknown): string { const text = JSON.stringify(value); let hash = 2166136261; for (let i=0;i<text.length;i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash,16777619); } return (hash >>> 0).toString(16); }
export function getDeclarationIssues(draft: DeclarationDraft | undefined, context: DeclarationContext): Issue[] {
  const issues: Issue[] = getEcusRequiredIssues(draft, context);
  for (const entry of draft?.fields ?? []) {
    const findings = validateDeclarationEntry(entry, context, draft);
    if (entry.stale) findings.push({ code:'stale',path:'review',messageVi:'Nguồn hoặc dữ liệu liên quan đã thay đổi; cần rà soát lại quyết định.',messageEn:'Evidence or related data changed; review this decision again.' });
    // Source-backed drafts are reviewed together by the explicit shipment approval
    // action. Only real uncertainty/structural findings become individual questions.
    // Keep manual unfinished decisions visible; extraction is never a human review.
    else if (!entry.review && entry.generatedBy !== 'shipment_extraction') findings.push({ code:'review',path:'review',messageVi:'Giá trị cấu trúc chưa được người phụ trách rà soát.',messageEn:'The structured entry has not been reviewed.' });
    for (const finding of findings) {
      const key = declarationEntryKey(entry.fieldId,entry.goodsLineId);
      const formField = ECUS_FORM_FIELDS.find(field => field.fieldId === entry.fieldId && (finding.path === `value.${field.component}` || finding.path.endsWith(`.${field.component}`))) ?? ECUS_FORM_FIELDS.find(field => field.fieldId === entry.fieldId);
      issues.push({ id:`${context.caseId}:declaration:${key}:${finding.code}:${finding.path}`,caseId:context.caseId,kind:'declaration',severity:'error',title:`Rà soát chỉ tiêu ${entry.fieldId}`,description:finding.messageVi,field:entry.fieldId,...(formField ? {ecusFieldKey:formField.key} : {}),...(entry.goodsLineId ? {goodsLineId:entry.goodsLineId} : {}),candidateIds:[],documentIds:entry.provenance.flatMap(source=>source.kind==='document'?[source.documentId]:[]),resolved:false,fingerprint:fingerprint({entry,finding}) });
    }
  }
  return issues;
}
export function getDeclarationCoverage(draft: DeclarationDraft | undefined, context: DeclarationContext): DeclarationCoverage {
  const entries = draft?.fields ?? [];
  const findings = entries.map(entry=>validateDeclarationEntry(entry,context,draft));
  return { total:DECLARATION_CATALOG.length,modeled:DECLARATION_CATALOG.filter(field=>field.kind!=='blocked').length,editable:DECLARATION_CATALOG.filter(field=>field.editable).length,blocked:DECLARATION_CATALOG.filter(field=>!field.editable).length,partial:DECLARATION_CATALOG.filter(field=>field.blockedComponents.length).length,sourceSupported:VNACCS_FIELDS.filter(field=>field.coverage.status==='source_proposal').length,entries:entries.length,evidenceBacked:entries.filter((entry,index)=>entry.provenance.some(source=>source.kind==='document')&&!findings[index].some(problem=>problem.code==='provenance')).length,reviewed:entries.filter((entry,index)=>entry.review&&!entry.stale&&!findings[index].length).length,manualReviewed:entries.filter((entry,index)=>entry.review&&!entry.stale&&!findings[index].length&&entry.provenance.some(source=>source.kind==='manual')).length,structurallyValid:findings.filter(list=>!list.length).length,stale:entries.filter(entry=>entry.stale).length,orphaned:findings.filter(list=>list.some(problem=>problem.code==='orphan')).length,currentLawVerified:0,ecusMapped:0 };
}
