import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace, getIssues, getProposedFields } from '../lib/engine.ts';
import { applyFixtureAction as applyAction } from './helpers/kimi-fixtures.ts';
import { classifyDocument, extractDocument, normalizeValue } from './helpers/legacy-extraction.ts';
import { syntheticShipments } from '../lib/demo.ts';
import { assessCustomsRules, CUSTOMS_RULES, decisionsAffectedByRuleChange } from '../lib/rules.ts';
import type { Actor, Action, ShipmentDocument, UploadedDocument, WorkspaceState } from '../lib/types.ts';
import { completeRequiredEcusFixture } from './ecus-fixtures.ts';

const actor: Actor = { id: 'reviewer-1', name: 'Người rà soát Demo', email: 'reviewer@example.invalid' };
const empty = () => createEmptyWorkspace('workspace-test');
const act = (s: WorkspaceState, a: Action) => applyAction(s, a, actor);
function upload(id: string, text: string, name = `${id}.txt`): UploadedDocument { return { id, sha256: `sha-${id}`, name, mime: 'text/plain', size: text.length, extractionStatus: 'extracted', pages: [{ page: 1, text }] }; }
function ready() {
  let s = act(empty(), { type: 'intake', documents: syntheticShipments()[1].documents });
  const c = s.cases[0];
  s = act(s, { type: 'confirm_grouping', caseId: c.id, reason: 'Đã đối chiếu vận đơn và hóa đơn.' });
  for (const [field, value] of Object.entries(getProposedFields(s, c.id))) {
    const candidate = s.candidates.find(x => x.caseId === c.id && !x.lineId && x.field === field && x.value === value)!;
    s = act(s, { type: 'review_field', caseId: c.id, field, value, candidateId: candidate.id, reason: 'Đã kiểm tra chứng từ và đơn vị kg.' });
  }
  const netWeight = s.candidates.find(candidate => candidate.field === 'netWeight')!;
  s = act(s, { type: 'review_field', caseId: c.id, field: 'netWeight', value: netWeight.value, candidateId: netWeight.id, reason: 'Synthetic reviewer explicitly checked the single medium-confidence reading.' });
  s = act(s, { type: 'review_goods', caseId: c.id, goods: s.cases[0].goods, reviewedLineIds: s.cases[0].goods.map(line => line.id), reason: 'Đối chiếu số lượng và trị giá với nguồn.' });
  // This synthetic fixture supplies a manually confirmed gross-weight unit instruction.
  s = act(s, { type: 'save_declaration_field', caseId: c.id, fieldId: '1.28', applicability: 'applicable', basis: 'Synthetic gross weight instruction.', value: { kind: 'quantity', amount: '630', unitCode: 'KG' }, provenance: [{ kind: 'manual', note: 'Synthetic broker confirms the unit; code remains unverified.' }], reason: 'Synthetic manual unit confirmation.', review: true });
  return completeRequiredEcusFixture(s, c.id, actor);
}

test('workspace starts empty, demo requires an explicit action and all demo docs are synthetic', () => {
  const s = empty(); assert.equal(s.cases.length, 0);
  const seeded = act(s, { type: 'seed_demo' });
  assert.equal(s.cases.length, 0); assert.equal(seeded.cases.length, 3); assert.ok(seeded.documents.every(d => d.synthetic));
  assert.throws(() => act(seeded, { type: 'seed_demo' }), /demo/);
});

test('classify headings rather than incidental document references', () => {
  assert.equal(classifyDocument('supplier.txt', 'COMMERCIAL INVOICE\nBill of Lading Number: BL123\nInvoice Number: INV1'), 'invoice');
  assert.equal(classifyDocument('packing-list.txt', 'Invoice Number: INV1'), 'packing_list');
  assert.equal(classifyDocument('unknown.txt', 'Bill of Lading Number: BL123'), 'other');
});

test('normalizations are conservative, logged and ambiguous dates/numbers stay uncertain', () => {
  const currency = normalizeValue('currency', '  usd  '); assert.equal(currency.value, 'USD'); assert.equal(currency.normalizations.length, 2);
  const total = normalizeValue('invoiceTotal', '1,250.00'); assert.equal(total.value, '1250.00'); assert.equal(total.confidence, 'high');
  assert.equal(normalizeValue('invoiceTotal', '1,250').value, '1,250'); assert.notEqual(normalizeValue('invoiceTotal', '1,250').confidence, 'high');
  assert.equal(normalizeValue('invoiceDate', '03/04/2026').value, '03/04/2026'); assert.equal(normalizeValue('invoiceDate', '03/04/2026').confidence, 'low');
  assert.equal(normalizeValue('invoiceDate', '2026/09/26').value, '2026-09-26');
  assert.equal(normalizeValue('invoiceDate', '2026-02-31').confidence, 'low');
});

test('bilingual labels and delimited tables retain exact source evidence and never assign customs decisions', () => {
  const doc: ShipmentDocument = { ...upload('vn', 'HÓA ĐƠN\nSố hóa đơn: VN001\nNgười nhập khẩu: Demo A\nDescription,Quantity,Unit,Unit Price,Amount,HS Code,Origin\n"Widget, blue",2,PCS,10,20,12345678,DemoLand'), caseId: 'case-1', version: 1, type: 'invoice', active: true, uploadedAt: '2026-10-10', synthetic: true };
  const result = extractDocument(doc); const invoice = result.candidates.find(x => x.field === 'invoiceNumber')!;
  assert.equal(invoice.value, 'VN001'); assert.equal(invoice.page, 1); assert.equal(invoice.location, 'Line 2'); assert.equal(invoice.originalText, 'Số hóa đơn: VN001'); assert.equal(invoice.documentVersion, 1);
  assert.equal(result.goods[0].description, 'Widget, blue'); assert.equal(result.goods[0].hsCode, ''); assert.equal(result.goods[0].origin, ''); assert.equal(result.goods[0].reviewed, false);
  assert.equal(result.candidates.find(x => x.field === 'hsCode')!.value, '12345678');
});

test('intake groups strong identifiers, records normalizations and does not mutate input', () => {
  const before = empty(); const s = act(before, { type: 'intake', documents: syntheticShipments()[1].documents });
  assert.equal(before.documents.length, 0); assert.equal(s.cases.length, 1); assert.equal(s.documents.length, 3); assert.equal(s.cases[0].groupingConfidence, 'high');
  assert.equal(getIssues(s).some(i => i.kind === 'grouping'), false); assert.ok(getIssues(s).some(i => i.kind === 'uncertain')); assert.equal(s.revision, 1);
});

test('party similarity cannot override contradictory invoice identifiers', () => {
  const docs = [upload('one', 'COMMERCIAL INVOICE\nInvoice Number: INV1\nImporter: A\nExporter: B'), upload('two', 'COMMERCIAL INVOICE\nInvoice Number: INV2\nImporter: A\nExporter: B')];
  const s = act(empty(), { type: 'intake', documents: docs }); assert.equal(s.cases.length, 2);
});

test('duplicate attachments and emails are skipped and original metadata retained', () => {
  const doc = syntheticShipments()[1].documents[0]; const email = { id: 'email-1', messageId: 'message-1', sender: 'sender@example.invalid', subject: 'Demo', receivedAt: '2026-10-10T00:00:00Z', originalName: 'demo.eml', documentIds: [], sha256: 'email-sha' };
  let s = act(empty(), { type: 'intake', documents: [doc], email }); s = act(s, { type: 'intake', documents: [doc], email });
  assert.equal(s.documents.length, 1); assert.equal(s.emails.length, 1); assert.deepEqual(s.emails[0].documentIds, [doc.id]); assert.ok(s.audit.some(a => a.action === 'duplicate_email_skipped'));
  s = act(s, { type: 'intake', documents: [{ ...doc, id: 'duplicate-id' }] }); assert.equal(s.documents.length, 1); assert.ok(s.audit.some(a => a.action === 'duplicate_document_skipped'));
});

test('conflicting headers are never silently proposed and require documented selection', () => {
  const a = upload('a', 'COMMERCIAL INVOICE\nInvoice Number: INV1\nImporter: Synthetic Buyer\nInvoice Total: 100');
  const b = upload('b', 'COMMERCIAL INVOICE\nInvoice Number: INV1\nImporter: Synthetic Buyer\nInvoice Total: 200');
  let s = act(empty(), { type: 'intake', documents: [a, b] }); const id = s.cases[0].id;
  assert.equal(getProposedFields(s, id).invoiceTotal, undefined);
  const issue = getIssues(s, id).find(i => i.field === 'invoiceTotal' && i.kind === 'conflict')!; assert.equal(issue.candidateIds.length, 2);
  const candidate = s.candidates.find(c => c.field === 'invoiceTotal')!;
  assert.throws(() => act(s, { type: 'review_field', caseId: id, field: 'invoiceTotal', value: candidate.value, candidateId: candidate.id, reason: '' }));
  assert.throws(() => act(s, { type: 'resolve_issue', caseId: id, issueId: issue.id, reason: 'ignore' }));
  s = act(s, { type: 'review_field', caseId: id, field: 'invoiceTotal', value: candidate.value, candidateId: candidate.id, reason: 'Confirmed the correct invoice amount with the supplier.' });
  assert.equal(getProposedFields(s, id).invoiceTotal, '100'); assert.ok(getIssues(s, id).find(i => i.id === issue.id)!.resolved);
});

test('candidate selection is constrained to active case, field and document version', () => {
  const s = act(empty(), { type: 'intake', documents: syntheticShipments()[1].documents }); const c = s.cases[0]; const candidate = s.candidates.find(x => x.field === 'invoiceNumber')!;
  assert.throws(() => act(s, { type: 'review_field', caseId: c.id, field: 'importer', value: candidate.value, candidateId: candidate.id, reason: 'wrong field' }));
  assert.throws(() => act(s, { type: 'review_field', caseId: c.id, field: 'invoiceNumber', value: 'override', reason: '' }));
});

test('quantity conflicts and arithmetic produce factual issues; unitless manual weights are not compared', () => {
  const s = act(empty(), { type: 'intake', documents: syntheticShipments()[0].documents });
  assert.ok(getIssues(s).some(i => i.kind === 'conflict' && i.title.includes('quantity')));
  assert.ok(getIssues(s).some(i => i.kind === 'conflict' && i.field === 'packageCount'));
  let r = ready(); const id = r.cases[0].id;
  r = act(r, { type: 'review_field', caseId: id, field: 'invoiceTotal', value: '9000', reason: 'Manual test override.' });
  r = act(r, { type: 'review_field', caseId: id, field: 'netWeight', value: '1000', reason: 'Manual test override.' });
  assert.ok(getIssues(r).some(i => i.title.includes('Tổng dòng'))); assert.equal(getIssues(r).some(i => i.title.includes('Trọng lượng tịnh lớn')), false);
});

test('manual customs decisions are explicit, unverified and require a reason', () => {
  let s = ready(); const id = s.cases[0].id;
  assert.throws(() => act(s, { type: 'review_field', caseId: id, field: 'countryOfOrigin', value: 'DemoLand', reason: '' }));
  s = act(s, { type: 'review_field', caseId: id, field: 'countryOfOrigin', value: 'DemoLand', reason: 'Manual qualified reviewer entry; source not legally validated.' });
  assert.equal(s.cases[0].fields.countryOfOrigin.unverified, true); assert.equal(s.cases[0].fields.countryOfOrigin.source, 'manual');
  const goods = structuredClone(s.cases[0].goods); goods[0].hsCode = '12345678';
  s = act(s, { type: 'review_goods', caseId: id, goods, reason: 'Manual reviewer decision, unverified.' }); assert.equal(s.cases[0].goods[0].manual, true);
});

test('later review invalidation cannot alter previously recorded field or goods audit payloads', () => {
  let s = ready();
  const fieldEntry = s.audit.find(entry => entry.action === 'field_reviewed')!;
  const goodsEntry = s.audit.find(entry => entry.action === 'goods_reviewed')!;
  const recordedField = structuredClone(fieldEntry);
  const recordedGoods = structuredClone(goodsEntry);
  const document = s.documents.find(d => d.active)!;
  s = act(s, { type: 'classify_document', documentId: document.id, documentType: document.type });
  assert.ok(Object.values(s.cases[0].fields).every(field => field.stale));
  assert.ok(s.cases[0].goods.every(line => !line.reviewed));
  assert.deepEqual(s.audit.find(entry => entry.id === fieldEntry.id), recordedField);
  assert.deepEqual(s.audit.find(entry => entry.id === goodsEntry.id), recordedGoods);
});

test('approval freezes immutable evidence and test handoff retries are idempotent per snapshot', () => {
  let s = ready(); const id = s.cases[0].id; assert.deepEqual(getIssues(s, id).filter(i => !i.resolved), []);
  s = act(s, { type: 'approve', caseId: id }); const snapshot = structuredClone(s.snapshots[0]);
  assert.equal(snapshot.customsValidation, 'Not yet assessed');
  s = act(s, { type: 'handoff', caseId: id, simulateFailure: true }); assert.ok(getIssues(s).some(i => i.kind === 'transfer'));
  s = act(s, { type: 'handoff', caseId: id }); s = act(s, { type: 'handoff', caseId: id });
  assert.equal(s.handoffs.length, 2); assert.equal(s.handoffs[0].idempotencyKey, s.handoffs[1].idempotencyKey); assert.equal(s.handoffs[1].idaStatus, 'not_transmitted'); assert.equal(s.handoffs[1].idcStatus, 'not_registered'); assert.equal(getIssues(s).filter(i => !i.resolved).length, 0);
  s = act(s, { type: 'review_field', caseId: id, field: 'importer', value: 'Changed Demo Importer', reason: 'Amendment.' });
  assert.equal(s.cases[0].approval, undefined); assert.deepEqual(s.snapshots[0], snapshot);
});

test('replacement retains originals and historical candidates, stales prior decisions, invalidates approval', () => {
  let s = ready(); const id = s.cases[0].id; s = act(s, { type: 'approve', caseId: id });
  const old = s.documents.find(d => d.type === 'invoice')!; const originalSnapshot = structuredClone(s.snapshots[0]); const previousIds = s.candidates.filter(c => c.documentId === old.id).map(c => c.id);
  const replacement = upload('replacement', old.pages[0].text.replace('8400.00', '8500.00'), 'replacement-invoice.txt');
  s = act(s, { type: 'replace_document', documentId: old.id, document: replacement });
  assert.equal(s.documents.find(d => d.id === old.id)!.active, false); assert.equal(s.documents.find(d => d.id === replacement.id)!.version, 2);
  assert.ok(previousIds.every(id => s.candidates.some(c => c.id === id))); assert.ok(Object.values(s.cases[0].fields).every(f => f.stale)); assert.equal(s.cases[0].approval, undefined); assert.deepEqual(s.snapshots[0], originalSnapshot);
  assert.throws(() => act(s, { type: 'approve', caseId: id }));
});

test('transcription preserves source pages and waits for a new Kimi reading', () => {
  const doc = { ...upload('partial', 'COMMERCIAL INVOICE\nInvoice Number: PARTIAL1', 'invoice.pdf'), mime: 'application/pdf', pages: [{ page: 1, text: 'COMMERCIAL INVOICE\nInvoice Number: PARTIAL1' }, { page: 2, text: '' }], extractionStatus: 'needs_transcription' as const };
  let s = act(empty(), { type: 'intake', documents: [doc] });
  s = act(s, { type: 'transcribe_document', documentId: doc.id, pages: [{ page: 2, text: 'Invoice Total: 123.00' }], reason: 'Human transcribed second page.' });
  assert.equal(s.documents[0].pages.length, 2); assert.equal(s.documents[0].pages[0].text, doc.pages[0].text);
  assert.equal(s.candidates.some(c => c.documentId === doc.id && c.documentVersion === 2), false);
  assert.equal(s.documents[0].pages[1].textSource, 'manual');
  assert.equal(s.documents[0].extractionStatus, 'pending_ai');
  s = act(s, { type: 'intake', documents: [upload('extra', 'PACKING LIST\nInvoice Number: PARTIAL1')], targetCaseId: s.cases[0].id });
  assert.equal(s.candidates.some(c => c.documentId === doc.id && c.documentVersion === 2), false);
  assert.equal(s.documents.find(d => d.id === doc.id)!.extractionStatus, 'pending_ai');
});

test('move and merge invalidate source/target reviews and preserve snapshots', () => {
  let s = ready(); const first = s.cases[0].id; s = act(s, { type: 'approve', caseId: first }); const snapshot = structuredClone(s.snapshots[0]);
  const docId = s.documents.find(d => d.type === 'packing_list')!.id;
  s = act(s, { type: 'move_documents', documentIds: [docId], title: 'Tách kiểm tra' });
  const target = s.cases[1].id; assert.equal(s.documents.find(d => d.id === docId)!.caseId, target); assert.equal(s.cases[0].approval, undefined); assert.ok(s.cases.every(c => !c.groupingConfirmed));
  s = act(s, { type: 'merge_cases', sourceCaseId: target, targetCaseId: first }); assert.equal(s.documents.find(d => d.id === docId)!.caseId, first); assert.deepEqual(s.snapshots[0], snapshot); assert.equal(s.cases.find(c => c.id === target)!.mergedInto, first); assert.deepEqual(getIssues(s, target), []);
  assert.throws(() => act(s, { type: 'update_case', caseId: target, title: 'Cannot edit merged source' }));
});

test('completed archive requires responsible reviewer, approval and no outstanding work; reopen is audited', () => {
  let s = ready(); const id = s.cases[0].id;
  assert.throws(() => act(s, { type: 'complete', caseId: id, reason: 'Done' }));
  s = act(s, { type: 'approve', caseId: id });
  assert.throws(() => applyAction(s, { type: 'complete', caseId: id, reason: 'Done' }, { id: 'other', name: 'Other reviewer', email: 'other@example.invalid' }));
  s = act(s, { type: 'complete', caseId: id, reason: 'Reviewed draft archived; no official submission claimed.' }); assert.equal(s.cases[0].status, 'completed');
  assert.throws(() => act(s, { type: 'classify_document', documentId: s.documents[0].id, documentType: 'other' }));
  s = act(s, { type: 'reopen', caseId: id, reason: 'Amendment requested.' }); assert.equal(s.cases[0].status, 'review'); assert.equal(s.cases[0].approval, undefined); assert.ok(s.audit.some(a => a.action === 'case_reopened'));
});

test('rules remain empty and cannot advertise assessed customs compliance', () => {
  assert.equal(CUSTOMS_RULES.length, 0); assert.equal(assessCustomsRules().status, 'Not yet assessed'); assert.equal(assessCustomsRules().rulesEvaluated, 0); assert.deepEqual(decisionsAffectedByRuleChange([], []), []);
});

test('explicit Other classification preserves the source and requires a fresh Kimi reading', () => {
  let s = act(empty(), { type: 'intake', documents: [upload('supplement', 'SUPPLIER MEMO\nInvoice Number: EXTRA-1')] });
  assert.equal(getIssues(s).some(i => i.id.includes('classification-')), false);
  s = act(s, { type: 'classify_document', documentId: 'supplement', documentType: 'other' });
  assert.equal(s.documents[0].type, 'other'); assert.equal(s.documents[0].classificationConfirmed, true);
  assert.equal(getIssues(s).some(i => i.id.includes('classification-')), false);
});

test('partial transcription leaves remaining blank pages as actionable blockers', () => {
  const scan = { ...upload('scan', '', 'scan-invoice.pdf'), pages: [{ page: 1, text: '' }, { page: 2, text: '' }], extractionStatus: 'needs_transcription' as const };
  let s = act(empty(), { type: 'intake', documents: [scan] });
  s = act(s, { type: 'transcribe_document', documentId: scan.id, pages: [{ page: 1, text: 'Invoice Number: SCAN1' }], reason: 'Only page one transcribed.' });
  assert.equal(s.documents[0].pages.length, 2); assert.equal(s.documents[0].extractionStatus, 'pending_ai');
  assert.ok(getIssues(s).some(i => i.kind === 'document' && i.documentIds.includes(scan.id)));
});

test('transcribing one page cannot clear weak OCR on another page', () => {
  const document = {
    ...upload('weak-ocr-pages', 'COMMERCIAL INVOICE\nInvoice Number: DEMO-WEAK', 'DEMO-weak-ocr.pdf'),
    pages: [
      { page: 1, text: 'COMMERCIAL INVOICE\nInvoice Number: DEMO-WEAK', textSource: 'ocr' as const, ocrConfidence: 0.52 },
      { page: 2, text: 'PACKING LIST\nPackages: 3', textSource: 'ocr' as const, ocrConfidence: 0.41 },
    ],
    extractionStatus: 'extracted' as const,
  };
  let s = act(createEmptyWorkspace('weak-ocr'), { type: 'intake', documents: [document] });
  assert.ok(getIssues(s).some(issue => issue.kind === 'document' && issue.documentIds.includes(document.id)));
  s = act(s, { type: 'transcribe_document', documentId: document.id, pages: [{ page: 1, text: 'COMMERCIAL INVOICE\nInvoice Number: DEMO-WEAK' }], reason: 'Checked and transcribed only the first source page.' });
  assert.equal(s.documents[0].extractionStatus, 'pending_ai');
  assert.ok(s.documents[0].pages.every(page => !page.aiReadability));
  assert.equal(s.documents[0].pages[0].ocrConfidence, undefined);
  assert.equal(s.documents[0].pages[1].ocrConfidence, 0.41);
  s = act(s, { type: 'transcribe_document', documentId: document.id, pages: [{ page: 2, text: 'PACKING LIST\nPackages: 3' }], reason: 'Checked and transcribed the remaining source page.' });
  assert.equal(s.documents[0].extractionStatus, 'pending_ai');
  assert.equal(s.candidates.some(candidate => candidate.documentVersion === s.documents[0].version), false);
  assert.ok(getIssues(s).some(issue => issue.kind === 'document' && issue.documentIds.includes(document.id)));
});

test('manual numeric and date ambiguity cannot be approved as a clear source fact', () => {
  let s = ready(); const id = s.cases[0].id;
  s = act(s, { type: 'review_field', caseId: id, field: 'invoiceTotal', value: '1,000', reason: 'Test ambiguous value.' });
  s = act(s, { type: 'review_field', caseId: id, field: 'invoiceDate', value: '03/04/2026', reason: 'Test ambiguous date.' });
  assert.ok(getIssues(s).some(i => i.id.endsWith(':number-invoiceTotal'))); assert.ok(getIssues(s).some(i => i.id.endsWith(':date-format')));
  assert.throws(() => act(s, { type: 'approve', caseId: id }));
});

test('unsupported case types and foreign goods source references are blocked', () => {
  let s = ready(); const id = s.cases[0].id;
  const goods = structuredClone(s.cases[0].goods); goods[0].sourceDocumentId = 'somebody-elses-document';
  assert.throws(() => act(s, { type: 'review_goods', caseId: id, goods, reason: 'Invalid source.' }));
  s = act(s, { type: 'update_case', caseId: id, caseType: 'unsupported' });
  assert.ok(getIssues(s).some(i => i.kind === 'unsupported')); assert.throws(() => act(s, { type: 'approve', caseId: id }));
});
