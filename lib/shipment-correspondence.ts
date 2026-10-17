import { getClientMemorySuggestions } from './client-memory.ts';
import { documentSourceReady } from './source-completeness.ts';
import { emailLinkedToCase } from './email-grouping.ts';
import type { Action, Actor, EmailDraft, Issue, ShipmentCase, WorkspaceState } from './types.ts';
import { ECUS_FORM_FIELDS, getEcusFormField } from './ecus-form.ts';
import { getDeclarationField } from './declaration-catalog.ts';
import { fieldLabel, translateIssue } from './i18n-core.ts';
import { actionableReviewIssues, reviewQuestion } from './review-questions.ts';

type CorrespondenceAction = Extract<Action, { type: 'draft_questions' | 'save_email_draft' | 'approve_email_draft' }>;
type Locale = 'vi' | 'en';
const addressPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const validAddress = (value: string) => value.length <= 320 && addressPattern.test(value);
const missingGoods = (issue: Issue) => issue.kind === 'goods' && /:(?:goods-missing|missing-goods)$/.test(issue.id);

/** Only one unambiguous, current external sender can become a suggested recipient. */
function suggestedRecipient(state: WorkspaceState, shipment: ShipmentCase): string {
  const ownAddress = state.settings.inboxAddress.trim().toLowerCase();
  const senders = new Map<string, string>();
  for (const email of state.emails.filter(email => emailLinkedToCase(state, email, shipment.id))) {
    const sender = email.sender.trim();
    const canonical = sender.toLowerCase();
    if (validAddress(sender) && canonical !== ownAddress) senders.set(canonical, sender);
  }
  return senders.size === 1 ? [...senders.values()][0] : '';
}

/** Questions wait for the complete source-reading pass, including every original visual page. */
export function readyForAutomaticQuestions(state: WorkspaceState, shipment: ShipmentCase): boolean {
  const documents = state.documents.filter(document => document.caseId === shipment.id && document.active && !document.referenceOnly);
  return shipment.groupingConfirmed && documents.length > 0 && documents.every(document => documentSourceReady(state, document));
}

/** External questions exclude local sign-off, grouping, and incomplete reading work. */
export function automaticQuestionIssues(state: WorkspaceState, shipment: ShipmentCase, issues: Issue[]): Issue[] {
  const chosen = new Map<string, Issue>();
  for (const issue of actionableReviewIssues(state, issues).filter(issue => issue.caseId === shipment.id)) {
    if (missingGoods(issue)) { chosen.set('__goods_list__', issue); continue; }
    const formField = issue.ecusFieldKey ? getEcusFormField(issue.ecusFieldKey)
      : ECUS_FORM_FIELDS.find(field => (field.sourceField ?? field.key) === issue.field && !field.readOnly);
    if (!formField) continue;
    const isRequired = issue.id.endsWith(':required') && !!issue.ecusFieldKey;
    const isEcusEvidence = issue.id.includes(':ecus-evidence:') && /:(?:conflict|invalid|uncertain)$/.test(issue.id);
    // A stale saved decision needs local reconciliation with current evidence.
    // It is not, by itself, a reason to ask the sender for information again.
    const isSourceQuestion = ['conflict', 'uncertain'].includes(issue.kind) && issue.candidateIds.length > 0;
    if (!isRequired && !isEcusEvidence && !isSourceQuestion) continue;
    const normalized = { ...issue, ecusFieldKey: formField.key };
    const key = JSON.stringify([formField.key, issue.goodsLineId ?? null]);
    const prior = chosen.get(key);
    // Existing but contradictory evidence asks for clarification rather than absence.
    if (!prior || (prior.id.endsWith(':required') && !isRequired)) chosen.set(key, normalized);
  }
  return [...chosen.values()].sort((left, right) => {
    const leftIndex = ECUS_FORM_FIELDS.findIndex(field => field.key === left.ecusFieldKey);
    const rightIndex = ECUS_FORM_FIELDS.findIndex(field => field.key === right.ecusFieldKey);
    return leftIndex - rightIndex || (left.goodsLineId ?? '').localeCompare(right.goodsLineId ?? '');
  });
}

function questionSection(state: WorkspaceState, shipment: ShipmentCase, issue: Issue, locale: Locale): string {
  if (missingGoods(issue)) return locale === 'en'
    ? 'Please provide the itemized goods list, including product codes and descriptions, HS codes, origin, both quantities and units, invoice and taxable unit prices and values, and the codes, rates and amounts for import duty, special consumption tax, environmental tax and VAT.'
    : 'Vui lòng cung cấp danh sách từng mặt hàng gồm mã và mô tả hàng, mã HS, xuất xứ, hai số lượng và đơn vị tính, đơn giá và trị giá hóa đơn/tính thuế, cùng mã biểu thuế, thuế suất và tiền thuế nhập khẩu, TTĐB, môi trường và VAT.';
  const definition = issue.field ? getDeclarationField(issue.field) : undefined;
  const ecusField = issue.ecusFieldKey ? getEcusFormField(issue.ecusFieldKey) : undefined;
  const baseLabel = ecusField ? `${locale === 'en' ? ecusField.sectionEn : ecusField.sectionVi} · ${locale === 'en' ? ecusField.labelEn : ecusField.labelVi}`
    : definition ? locale === 'en' ? definition.labelEn : definition.labelVi : fieldLabel(issue.field ?? '', locale);
  const lineNumber = issue.goodsLineId ? shipment.goods.findIndex(line => line.id === issue.goodsLineId) + 1 : 0;
  const label = baseLabel + (lineNumber ? locale === 'en' ? ` — goods row ${lineNumber}` : ` — dòng hàng ${lineNumber}` : '');
  const question = reviewQuestion(state, issue);
  const suppliedConflict = issue.id.includes(':ecus-evidence:') && issue.id.endsWith(':conflict');
  const suppliedUncertain = issue.id.includes(':ecus-evidence:') && /:(?:uncertain|invalid)$/.test(issue.id);
  const prompt = !issue.field ? translateIssue(issue, locale).title
    : question.kind === 'missing' ? locale === 'en' ? `Please provide ${label}; it was not found in the shipment documents.` : `Vui lòng cung cấp ${label}; chưa tìm thấy thông tin này trong chứng từ lô hàng.`
    : question.kind === 'choose' || (suppliedConflict && question.values.length > 1) ? locale === 'en' ? `The documents show different values for ${label}: ${question.values.join(' / ')}. Which value is correct?` : `Các chứng từ ghi ${label} khác nhau: ${question.values.join(' / ')}. Giá trị nào đúng?`
    : question.kind === 'confirm' || (suppliedUncertain && question.values.length === 1) ? locale === 'en' ? `Please confirm that ${label} is ${question.values[0]}.` : `Vui lòng xác nhận ${label} là ${question.values[0]}.`
    : locale === 'en' ? `Please clarify ${label}.` : `Vui lòng làm rõ ${label}.`;
  // reviewQuestion has already excluded foreign, replaced, and inactive evidence.
  const evidence = question.candidates.map(candidate => {
    const document = state.documents.find(document => document.id === candidate.documentId);
    return document ? `- ${document.name}, ${locale === 'en' ? 'page' : 'trang'} ${candidate.page}: ${candidate.value}` : '';
  }).filter(Boolean);
  return [prompt, ...new Set(evidence)].join('\n');
}

function renderQuestions(state: WorkspaceState, shipment: ShipmentCase, issues: Issue[], locale: Locale) {
  const subject = locale === 'en' ? `Information needed — ${shipment.reference}` : `Cần bổ sung thông tin — ${shipment.reference}`;
  const sections = issues.map(issue => questionSection(state, shipment, issue, locale));
  const greeting = locale === 'en' ? `Hello,\n\nPlease help clarify the following information for shipment ${shipment.reference}:` : `Chào anh/chị,\n\nVui lòng làm rõ các thông tin sau cho lô hàng ${shipment.reference}:`;
  const body = issues.length ? `${greeting}\n\n${sections.join('\n\n')}\n\n${locale === 'en' ? 'Thank you.' : 'Cảm ơn anh/chị.'}`
    : locale === 'en' ? `No outstanding information requests remain for shipment ${shipment.reference}. Review the updated shipment before preparing any correspondence.` : `Không còn yêu cầu bổ sung thông tin cho lô hàng ${shipment.reference}. Kiểm tra hồ sơ đã cập nhật trước khi chuẩn bị nội dung trao đổi.`;
  return { subject, body };
}

function rowRanges(rows: number[]): string {
  const sorted = [...new Set(rows)].sort((left, right) => left - right);
  const ranges: string[] = [];
  for (let index = 0; index < sorted.length; index++) {
    const start = sorted[index];
    let end = start;
    while (sorted[index + 1] === end + 1) end = sorted[++index];
    ranges.push(start === end ? String(start) : `${start}–${end}`);
  }
  return ranges.join(', ');
}

/** Large goods lists ask each missing column once, while retaining every target issue. */
function renderAutomaticQuestions(state: WorkspaceState, shipment: ShipmentCase, issues: Issue[], locale: Locale) {
  const base = renderQuestions(state, shipment, [], locale);
  if (!issues.length) return base;
  const intro = locale === 'en' ? `Hello,\n\nPlease provide or clarify the following information for shipment ${shipment.reference}:`
    : `Chào anh/chị,\n\nVui lòng cung cấp hoặc làm rõ các thông tin sau cho lô hàng ${shipment.reference}:`;
  const close = locale === 'en' ? 'Thank you.' : 'Cảm ơn anh/chị.';
  const wrap = (sections: string[]) => `${intro}\n\n${sections.join('\n\n')}\n\n${close}`;
  const grouped = new Map<string, number[]>();
  const sections: string[] = [];
  for (const issue of issues) {
    const row = shipment.goods.findIndex(line => line.id === issue.goodsLineId) + 1;
    if (issue.ecusFieldKey && row && issue.id.endsWith(':required')) {
      grouped.set(issue.ecusFieldKey, [...(grouped.get(issue.ecusFieldKey) ?? []), row]);
    } else sections.push(questionSection(state, shipment, issue, locale));
  }
  for (const [key, rows] of grouped) {
    const field = getEcusFormField(key)!;
    sections.push(locale === 'en' ? `Please provide ${field.labelEn} — goods rows ${rowRanges(rows)}.`
      : `Vui lòng cung cấp ${field.labelVi} — dòng hàng ${rowRanges(rows)}.`);
  }
  let body = wrap(sections);
  if (body.length <= 20_000) return { subject: base.subject, body };

  // Extremely varied conflicts use a compact request matrix instead of truncating
  // questions or evidence values. Every field/row still asks for a supplied answer.
  const headers = issues.filter(issue => !issue.goodsLineId).map(issue => getEcusFormField(issue.ecusFieldKey!)!)
    .filter((field, index, fields) => field && fields.findIndex(other => other?.key === field.key) === index);
  const goodsFields = ECUS_FORM_FIELDS.filter(field => field.tab === 'goods' && !field.readOnly && issues.some(issue => issue.ecusFieldKey === field.key && issue.goodsLineId));
  const legend = goodsFields.map((field, index) => `${String.fromCharCode(65 + index)} = ${locale === 'en' ? field.labelEn : field.labelVi}`).join('\n');
  const patterns = new Map<string, number[]>();
  for (let index = 0; index < shipment.goods.length; index++) {
    const keys = new Set(issues.filter(issue => issue.goodsLineId === shipment.goods[index].id).map(issue => issue.ecusFieldKey));
    if (!keys.size) continue;
    const included = goodsFields.flatMap((field, position) => keys.has(field.key) ? [String.fromCharCode(65 + position)] : []);
    const excluded = goodsFields.flatMap((field, position) => !keys.has(field.key) ? [String.fromCharCode(65 + position)] : []);
    const pattern = excluded.length < included.length ? `-${excluded.join('') || 'none'}` : `+${included.join('')}`;
    patterns.set(pattern, [...(patterns.get(pattern) ?? []), index + 1]);
  }
  const compact = [locale === 'en' ? 'Please supply the correct values for every field below. Some existing readings need clarification; the full evidence remains in the shipment review.'
    : 'Vui lòng cung cấp giá trị đúng cho tất cả các trường bên dưới. Một số thông tin đã đọc cần làm rõ; bằng chứng đầy đủ được lưu trong hồ sơ lô hàng.'];
  for (const issue of issues.filter(missingGoods)) compact.push(questionSection(state, shipment, issue, locale));
  if (headers.length) compact.push(headers.map(field => `- ${locale === 'en' ? field.labelEn : field.labelVi}${field.rowIndex !== undefined ? ` (${field.rowIndex + 1})` : ''}`).join('\n'));
  if (goodsFields.length) compact.push(legend, locale === 'en' ? 'Goods rows: + asks only for the listed letters; - asks for every letter except those listed (-none means all).'
    : 'Dòng hàng: + chỉ yêu cầu các chữ được liệt kê; - yêu cầu mọi chữ trừ các chữ được liệt kê (-none nghĩa là tất cả).',
  [...patterns].map(([pattern, rows]) => `${rowRanges(rows)}: ${pattern}`).join('\n'));
  body = wrap(compact);
  if (body.length > 20_000) throw new Error('The question draft exceeds the email length limit. Review the shipment questions before preparing correspondence.');
  return { subject: base.subject, body };
}

function contentFingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let first = 2166136261, second = 5381;
  for (let index = 0; index < text.length; index++) {
    first = Math.imul(first ^ text.charCodeAt(index), 16777619);
    second = Math.imul(second, 33) ^ text.charCodeAt(index);
  }
  return `${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
}

function recordDraftChange(state: WorkspaceState, actor: Actor, draft: EmailDraft, action: string, reason: string, before?: unknown): void {
  state.audit.push({ id: `audit-${crypto.randomUUID()}`, caseId: draft.caseId, at: draft.updatedAt, actor: actor.name,
    action, reason, ...(before ? { before } : {}), after: { draftId: draft.id, issueIds: [...draft.issueIds], recipient: draft.recipient, automationState: draft.automation?.state, questionCount: draft.automation?.questionCount } });
}

/** Synchronize one local review draft per case. This function never sends or approves email. */
export function syncAutomaticQuestionDrafts(state: WorkspaceState, actor: Actor, issues: Issue[], locale: Locale = 'vi', caseId?: string): void {
  for (const shipment of state.cases.filter(shipment => shipment.caseType === 'import' && shipment.status === 'review' && !shipment.mergedInto && (!caseId || shipment.id === caseId))) {
    let draft = state.emailDrafts?.find(draft => draft.caseId === shipment.id && draft.status === 'draft');
    if (!readyForAutomaticQuestions(state, shipment)) {
      if (draft?.automation && draft.automation.state !== 'waiting_for_sources') {
        const before = { state: draft.automation.state, approval: draft.approval };
        draft.automation.state = 'waiting_for_sources';
        delete draft.approval;
        draft.updatedAt = new Date().toISOString();
        recordDraftChange(state, actor, draft, 'email_questions_synchronized', 'Waiting for source reading before updating the local email draft; no email sent.', before);
      }
      continue;
    }
    const selected = automaticQuestionIssues(state, shipment, issues);
    const pendingMemories = getClientMemorySuggestions(state, shipment).filter(suggestion => selected.some(issue => !issue.goodsLineId && issue.ecusFieldKey === suggestion.memory.fieldKey));
    const pendingClientMemoryIds = pendingMemories.map(suggestion => suggestion.memory.id);
    if (!draft?.automation && !selected.length) continue;
    const language = draft?.automation?.locale ?? locale;
    const rendered = renderAutomaticQuestions(state, shipment, selected, language);
    const recipient = draft?.recipientSource === 'manual' || (draft && !draft.recipientSource && draft.recipient) ? draft.recipient : suggestedRecipient(state, shipment);
    const sources = state.documents.filter(document => document.caseId === shipment.id && document.active && !document.referenceOnly)
      .map(document => [document.id, document.version, document.sha256]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    const sourceFingerprint = contentFingerprint({ locale: language, reference: shipment.reference, sources, pendingMemories: pendingMemories.map(suggestion => [suggestion.memory.id, suggestion.memory.value]), issues: selected.map(issue => [issue.id, issue.fingerprint]), subject: rendered.subject, body: rendered.body });
    if (draft?.automation?.sourceFingerprint === sourceFingerprint && draft.automation.state !== 'waiting_for_sources') {
      if (draft.recipient !== recipient) {
        const before = { recipient: draft.recipient, approval: draft.approval };
        draft.recipient = recipient; delete draft.approval; draft.updatedAt = new Date().toISOString();
        recordDraftChange(state, actor, draft, 'email_questions_synchronized', 'Updated the suggested recipient from current shipment correspondence; no email sent.', before);
      }
      continue;
    }
    const at = new Date().toISOString();
    if (!draft) {
      draft = { id: `draft-${crypto.randomUUID()}`, caseId: shipment.id, issueIds: selected.map(issue => issue.id), recipient, recipientSource: 'sender',
        ...rendered, status: 'draft', createdBy: actor.name, createdAt: at, updatedAt: at,
        automation: { pendingClientMemoryIds, locale: language, sourceFingerprint, generatedSubject: rendered.subject, generatedBody: rendered.body, questionCount: selected.length, state: 'ready' } };
      (state.emailDrafts ??= []).push(draft);
      recordDraftChange(state, actor, draft, 'email_questions_drafted', 'Automatically prepared unresolved information requests for human review; no email sent.');
      continue;
    }
    const before = { issueIds: [...draft.issueIds], recipient: draft.recipient, state: draft.automation?.state, approval: draft.approval };
    const editedByUser = !draft.automation || !!draft.automation.editedByUser || draft.subject !== draft.automation.generatedSubject || draft.body !== draft.automation.generatedBody;
    const previousState = draft.automation?.state;
    draft.issueIds = selected.map(issue => issue.id);
    draft.recipient = recipient;
    draft.recipientSource ??= 'manual';
    draft.automation = { pendingClientMemoryIds, locale: language, sourceFingerprint, generatedSubject: rendered.subject, generatedBody: rendered.body,
      questionCount: selected.length, state: selected.length ? editedByUser ? 'needs_review' : 'ready' : 'resolved',
      ...(editedByUser ? { editedByUser: true, pendingSubject: rendered.subject, pendingBody: rendered.body } : {}) };
    if (!editedByUser) { draft.subject = rendered.subject; draft.body = rendered.body; }
    if (previousState === 'waiting_for_sources' || draft.approval?.sourceFingerprint !== sourceFingerprint) delete draft.approval;
    draft.updatedAt = at;
    recordDraftChange(state, actor, draft, 'email_questions_synchronized', 'Updated the local question draft from current shipment information; manual text is preserved and no email sent.', before);
  }
}

/** Explicit editing and local approval. There is deliberately no send operation here. */
export function applyCorrespondenceAction(state: WorkspaceState, action: CorrespondenceAction, actor: Actor, issues: Issue[]): void {
  const drafts = state.emailDrafts ??= [];
  const at = new Date().toISOString();
  if (action.type === 'save_email_draft' || action.type === 'approve_email_draft') {
    const draft = drafts.find(item => item.id === action.draftId);
    if (!draft) throw new Error('Email draft not found.');
    const shipment = state.cases.find(item => item.id === draft.caseId && !item.mergedInto);
    if (!shipment || shipment.status !== 'review') throw new Error('Reopen this shipment before editing or approving its email draft.');
    if (action.type === 'approve_email_draft') {
      syncAutomaticQuestionDrafts(state, actor, issues, draft.automation?.locale ?? 'vi', shipment.id);
      if (draft.automation?.pendingClientMemoryIds?.length) throw new Error('Review the remembered client information in the ECUS form before asking again. Apply it or dismiss it for this shipment.');
      if (!validAddress(draft.recipient.trim())) throw new Error('Choose a valid recipient before approving this email draft.');
      if (!draft.subject.trim() || !draft.body.trim()) throw new Error('Email subject and body are required.');
      if (draft.automation && (draft.automation.state !== 'ready' || draft.automation.pendingBody !== undefined)) throw new Error('Review the current shipment questions before approving this email draft.');
      if (draft.approval) return;
      draft.approval = { actorId: actor.id, actorName: actor.name, at, ...(draft.automation ? { sourceFingerprint: draft.automation.sourceFingerprint } : {}) };
      draft.updatedAt = at;
      recordDraftChange(state, actor, draft, 'email_draft_approved', 'Human approved this local email draft; no email sent.');
      return;
    }
    if (!action.subject.trim() || !action.body.trim()) throw new Error('Email subject and body are required.');
    if (action.recipient !== undefined && action.recipient.trim() && !validAddress(action.recipient.trim())) throw new Error('Enter one valid recipient email address.');
    const before = { subject: draft.subject, body: draft.body, recipient: draft.recipient, approval: draft.approval };
    const subject = action.subject.trim(), body = action.body.trim();
    const changed = subject !== draft.subject || body !== draft.body || (action.recipient !== undefined && action.recipient.trim() !== draft.recipient);
    draft.subject = subject; draft.body = body;
    if (action.recipient !== undefined) { draft.recipient = action.recipient.trim(); draft.recipientSource = 'manual'; }
    if (changed) delete draft.approval;
    if (draft.automation) {
      draft.automation.editedByUser = subject !== draft.automation.generatedSubject || body !== draft.automation.generatedBody;
      delete draft.automation.pendingSubject; delete draft.automation.pendingBody;
      if (draft.automation.state === 'needs_review') draft.automation.state = 'ready';
    }
    draft.updatedAt = at;
    state.audit.push({ id: `audit-${crypto.randomUUID()}`, caseId: draft.caseId, at, actor: actor.name, action: 'email_draft_updated', reason: 'Updated a local draft; no email sent.', before, after: { draftId: draft.id, recipient: draft.recipient, subject: draft.subject, body: draft.body } });
    return;
  }
  const shipment = state.cases.find(item => item.id === action.caseId && !item.mergedInto);
  if (!shipment || shipment.status !== 'review') throw new Error('Choose an open shipment before drafting questions.');
  const selected = [...new Set(action.issueIds)].map(id => issues.find(issue => issue.id === id && issue.caseId === shipment.id && !issue.resolved));
  if (!selected.length || selected.some(issue => !issue)) throw new Error('These questions changed or were resolved. Refresh the shipment before drafting.');
  const language = action.locale ?? 'vi';
  const draft = drafts.find(item => item.caseId === shipment.id && item.status === 'draft');
  if (draft?.automation && draft.automation.locale !== language) {
    draft.automation.locale = language;
    draft.automation.sourceFingerprint = '';
    syncAutomaticQuestionDrafts(state, actor, issues, language, shipment.id);
  }
  const additions = (selected as Issue[]).filter(issue => !draft?.issueIds.includes(issue.id));
  if (!additions.length) return;
  if (draft) {
    draft.body += `\n\n${additions.map(issue => questionSection(state, shipment, issue, language)).join('\n\n')}`;
    draft.issueIds.push(...additions.map(issue => issue.id)); draft.updatedAt = at;
    delete draft.approval;
    if (draft.automation) draft.automation.editedByUser = true;
  } else {
    drafts.push({ id: `draft-${crypto.randomUUID()}`, caseId: shipment.id, issueIds: additions.map(issue => issue.id), recipient: suggestedRecipient(state, shipment), recipientSource: 'sender',
      ...renderQuestions(state, shipment, additions, language), status: 'draft', createdBy: actor.name, createdAt: at, updatedAt: at });
  }
  recordDraftChange(state, actor, draft ?? drafts.at(-1)!, 'email_questions_drafted', 'Saved questions as a local draft for human review; no email sent.');
}
