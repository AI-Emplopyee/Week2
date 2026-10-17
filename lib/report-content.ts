import type { Candidate, WorkspaceState } from './types.ts';
import { FIELD_DEFINITIONS } from './engine.ts';
import { buildReport } from './report-data.ts';
import { auditActionLabel, documentTypeLabel, fieldLabel, translateIssue, translateSystemText, type Locale } from './i18n-core.ts';

export type ReportBlock = { kind: 'text'; value: string; size: number; tone: 'ink' | 'muted' | 'teal' | 'amber' } | { kind: 'section'; value: string } | { kind: 'gap'; space: number } | { kind: 'page' };

/** Localizes report presentation only; source quotations, names, decisions and audit values remain unchanged. */
export function buildReportContent(state: WorkspaceState, caseId: string, locale: Locale = 'vi') {
  const data = buildReport(state, caseId);
  const blocks: ReportBlock[] = [];
  const t = (vi: string, en: string) => locale === 'en' ? en : vi;
  const text = (value: unknown, size = 9, tone: 'ink' | 'muted' | 'teal' | 'amber' = 'ink') => blocks.push({ kind: 'text', value: String(value), size, tone });
  const section = (vi: string, en: string) => blocks.push({ kind: 'section', value: t(vi, en) });
  const gap = (space = 9) => blocks.push({ kind: 'gap', space });
  const sys = (value: string) => translateSystemText(value, locale);
  const label = (key: string) => fieldLabel(key, locale);
  const date = (iso: string) => {
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString(locale === 'en' ? 'en-GB' : 'vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) + ' ICT';
  };
  const fmt = (value: unknown) => typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? t('(trống)', '(empty)'));
  const confidence = (value: string) => ({ high: t('cao', 'high'), medium: t('trung bình', 'medium'), low: t('thấp', 'low') }[value] || value);
  const extraction = (value: string) => ({ extracted: t('đã trích xuất', 'extracted'), needs_transcription: t('cần kiểm tra / chép lại', 'review / transcription required'), unsupported: t('chưa hỗ trợ', 'unsupported'), failed: t('trích xuất thất bại', 'extraction failed') }[value] || value);
  const source = (candidate: Candidate) => {
    const document = data.documents.find(item => item.id === candidate.documentId);
    return `${document?.name || candidate.documentId} · v${candidate.documentVersion} · ${t('trang', 'page')} ${candidate.page} · ${candidate.location}`;
  };
  const title = `AICD - ${t('Báo cáo rà soát', 'Review report')} - ${data.shipment.reference}`;
  const subject = t('Rà soát chứng từ, không phải xác nhận tuân thủ hải quan', 'Document review, not customs compliance certification');
  const footer = `${data.shipment.reference} · ${t('Rà soát nội bộ · Chưa đánh giá hải quan', 'Internal review · Customs not assessed')}`;
  text(t('AICD  /  BÁO CÁO RÀ SOÁT', 'AICD  /  REVIEW REPORT'), 11, 'teal'); gap(10);
  text(data.shipment.reference, 26); text(data.shipment.title, 14); gap(10);
  text(t(`Tạo lúc ${date(data.generatedAt)} · Phiên bản workspace ${data.workspaceRevision}`, `Generated ${date(data.generatedAt)} · Workspace revision ${data.workspaceRevision}`), 8, 'muted');
  if (data.shipment.synthetic) text(t('DỮ LIỆU GIẢ LẬP - không chứa thông tin khách hàng thật', 'SYNTHETIC DATA - no real client information'), 9, 'amber');
  gap();
  text(t('Đánh giá pháp lý / quy tắc hải quan: Chưa đánh giá', 'Legal / customs rules assessment: Not yet assessed'), 10, 'amber');
  text(t('Báo cáo hỗ trợ rà soát chứng từ. Không xác nhận khai báo hoàn chỉnh, phê duyệt hải quan hoặc tuân thủ pháp luật.', 'This report supports document review. It does not certify a complete declaration, customs approval or legal compliance.'), 9, 'muted');
  section('01   Tổng quan và hành động tiếp theo', '01   Overview and next actions');
  const reviewedCount = Object.values(data.shipment.fields).filter(field => !field.stale).length;
  const documentCount = data.documents.filter(document => document.active).length;
  const reviewedGoods = data.shipment.goods.filter(line => line.reviewed).length;
  text(t(`Đã nhận: ${documentCount} chứng từ hiện hành. Đã rà soát: ${reviewedCount} trường; ${reviewedGoods}/${data.shipment.goods.length} dòng hàng.`, `Received: ${documentCount} current documents. Reviewed: ${reviewedCount} fields; ${reviewedGoods}/${data.shipment.goods.length} goods lines.`));
  const status = { review: t('Đang rà soát', 'Under review'), approved: t('Đã duyệt nội bộ', 'Internally approved'), completed: t('Đã hoàn tất / lưu trữ', 'Completed / archived') }[data.shipment.status];
  text(t(`Còn cần xử lý: ${data.open.length} vấn đề. Trạng thái AICD: ${status}.`, `Unresolved: ${data.open.length} issues. AICD status: ${status}.`));
  if (data.open.length) data.open.slice(0, 5).forEach((issue, index) => { const localized = translateIssue(issue, locale); text(`${index + 1}. ${localized.title}: ${localized.description}`, 9, 'amber'); });
  else text(t('Không còn vấn đề phần mềm đang mở. Các quyết định hải quan vẫn cần người có chuyên môn đánh giá.', 'There are no open software issues. Customs decisions still require professional assessment.'));
  text(t(`AICD đã chuẩn hóa ${data.normalizations.length} giá trị an toàn; mọi thay đổi và quyết định được liệt kê ở các phần sau.`, `AICD applied ${data.normalizations.length} safe format normalizations; changes and decisions are listed below.`));
  const currentSnapshot = data.shipment.approval?.snapshotId;
  const currentRun = [...data.handoffs].reverse().find(run => run.snapshotId === currentSnapshot);
  text(`ECUS: ${currentRun ? `${currentRun.status === 'succeeded' ? t('TEST thành công', 'TEST succeeded') : t('TEST thất bại', 'TEST failed')} · ${currentRun.draftReference || t('không tạo bản nháp', 'no draft created')} · ${t('bản cố định', 'snapshot')} ${currentRun.snapshotId}` : t('Chưa có bản nháp ECUS cho phiên bản đang rà soát.', 'No ECUS draft exists for the version under review.')}`);
  text(t('Kết nối hiện tại chỉ là TEST. IDA: chưa truyền. IDC: chưa đăng ký. Chưa ký số; chưa gửi chính thức.', 'The current connector is TEST only. IDA: not transmitted. IDC: not registered. No digital signature or official submission.'), 9, 'amber');
  text(`${t('Bản duyệt nội bộ', 'Internal approval')}: ${currentSnapshot || t('Chưa duyệt', 'Not approved')}${data.shipment.approval ? ` · ${data.shipment.approval.actor} · ${date(data.shipment.approval.at)}` : ''}`, 8, 'muted');
  blocks.push({ kind: 'page' });
  section('02   Chứng từ và phiên bản', '02   Documents and versions');
  for (const document of data.documents) {
    text(`${document.active ? t('Hiện hành', 'Current') : t('Đã thay thế', 'Replaced')} · ${document.name} · v${document.version}`, 10);
    text(`${documentTypeLabel(document.type, locale)} · ${document.pages.length} ${t('trang văn bản', 'text pages')} · ${extraction(document.extractionStatus)} · ${t('nhận', 'received')} ${date(document.uploadedAt)}`, 8, 'muted');
    for (const page of document.pages) {
      if (!page.documentType && !page.textSource) continue;
      const origin = page.textSource === 'ocr' ? t('OCR cục bộ', 'Local OCR') : page.textSource === 'manual' ? t('Bản chép thủ công', 'Manual transcription') : t('Lớp văn bản PDF', 'PDF text layer');
      text(`${t('Trang', 'Page')} ${page.page}: ${page.documentType ? documentTypeLabel(page.documentType, locale) + ' · ' : ''}${origin}${page.ocrConfidence !== undefined ? ` · ${t('độ tin cậy OCR', 'OCR confidence')} ${Math.round(page.ocrConfidence * 100)}%` : ''}`, 8, 'muted');
    }
    text(`SHA-256: ${document.sha256}`, 7, 'muted');
    if (document.sourceEmailId) { const email = state.emails.find(item => item.id === document.sourceEmailId); if (email) text(`Email: ${email.subject} · ${email.sender} · ${email.receivedAt} · Message-ID ${email.messageId}`, 8, 'muted'); }
    gap();
  }
  section('03   Dữ liệu đề xuất và quyết định của người rà soát', '03   Proposed data and reviewer decisions');
  const keys = [...new Set([...FIELD_DEFINITIONS.map(field => field.key), ...Object.keys(data.shipment.fields)])];
  for (const key of keys) {
    const decision = data.shipment.fields[key], candidates = data.candidates.filter(candidate => candidate.field === key && !candidate.lineId);
    if (!decision && !candidates.length) { if (FIELD_DEFINITIONS.find(field => field.key === key)?.required) text(`${label(key)}: ${t('Thiếu thông tin', 'Missing information')}`, 9, 'amber'); continue; }
    text(label(key), 10, 'teal');
    if (decision) {
      text(`${decision.stale ? t('CẦN RÀ SOÁT LẠI', 'REVIEW AGAIN') : t('Đã rà soát', 'Reviewed')}: ${decision.value}`);
      text(`${decision.source === 'manual' ? t('Người dùng nhập', 'User entered') : t('Chọn bằng chứng', 'Selected source evidence')}${decision.unverified ? t(' · thủ công / chưa xác minh', ' · manual / unverified') : ''} · ${decision.reviewedBy} · ${date(decision.reviewedAt)}`, 8, 'muted');
      text(`${t('Lý do', 'Reason')}: ${decision.reason || t('Không ghi lý do', 'No reason recorded')}`, 8);
    } else text(t('Chưa có quyết định của người rà soát. Các giá trị dưới đây chỉ là dữ kiện trích xuất.', 'No reviewer decision has been recorded. The values below are extracted evidence only.'), 8, 'amber');
    for (const candidate of candidates) {
      text(`${t('Dữ kiện', 'Evidence')}: ${candidate.value} [${t('độ tin cậy', 'confidence')} ${confidence(candidate.confidence)}]`);
      text(`${t('Nguồn', 'Source')}: ${source(candidate)}`, 8, 'muted');
      text(`${t('Nguyên văn', 'Original text')}: ${candidate.originalText}`, 8, 'muted');
      text(`${t('Phương pháp', 'Method')}: ${candidate.method}`, 8, 'muted');
    }
    gap();
  }
  section('04   Bản nháp chỉ tiêu khai báo có cấu trúc', '04   Structured declaration draft');
  const editableDeclarationFields = data.declarationCoverage.filter(row => row.field.editable);
  const partialDeclarationFields = editableDeclarationFields.filter(row => row.field.blockedComponents.length);
  const blockedDeclarationFields = data.declarationCoverage.filter(row => !row.field.editable);
  const reviewedDeclarationEntries = data.declarationDraft.fields.filter(entry => entry.review && !entry.stale);
  text(t(`Phạm vi cấu trúc: ${editableDeclarationFields.length} chỉ tiêu có thể nhập (${partialDeclarationFields.length} chỉ tiêu còn phần bị chặn); ${blockedDeclarationFields.length} chỉ tiêu bị chặn. Đã lưu ${data.declarationDraft.fields.length} mục; ${reviewedDeclarationEntries.length} mục đã rà soát và chưa bị đánh dấu cũ.`, `Structural coverage: ${editableDeclarationFields.length} editable indicators (${partialDeclarationFields.length} retain blocked components); ${blockedDeclarationFields.length} blocked indicators. ${data.declarationDraft.fields.length} saved entries; ${reviewedDeclarationEntries.length} reviewed entries not marked stale.`));
  text(t('Đây là dữ liệu chuẩn bị nội bộ, không phải tệp nhập ECUS đã xác minh. Phạm vi mô hình không phải tỷ lệ sẵn sàng khai báo. Mã và quyết định pháp lý vẫn chưa xác minh; chỉ tiêu chưa nhập không tự động được coi là bắt buộc hoặc không áp dụng.', 'These are internal preparation records, not a verified ECUS import file. Model coverage is not a filing readiness score. Codes and legal decisions remain unverified; unentered indicators are not automatically mandatory or inapplicable.'), 8, 'amber');
  for (const { field, entries } of data.declarationCoverage) {
    const fieldName = locale === 'en' ? field.labelEn : field.labelVi;
    const stateLabel = !field.editable ? t('BỊ CHẶN', 'BLOCKED') : field.blockedComponents.length ? t('CẤU TRÚC MỘT PHẦN', 'PARTIAL STRUCTURE') : t('ĐÃ MÔ HÌNH CẤU TRÚC', 'STRUCTURE MODELED');
    text(`${field.id} · ${fieldName} · ${stateLabel} · ${entries.length ? `${entries.length} ${t('mục đã lưu', 'saved entries')}` : t('chưa nhập / chưa quyết định áp dụng', 'not entered / applicability undecided')}`, 8, field.editable ? 'muted' : 'amber');
    if (!field.editable) text(locale === 'en' ? field.blockedReasonEn || '' : field.blockedReasonVi || '', 8, 'amber');
    for (const blocked of field.blockedComponents) text(`${blocked.sourceCell}: ${locale === 'en' ? blocked.reasonEn : blocked.reasonVi}`, 8, 'amber');
  }
  for (const entry of data.declarationDraft.fields) {
    const field = data.declarationCoverage.find(row => row.field.id === entry.fieldId)?.field;
    const fieldName = field ? locale === 'en' ? field.labelEn : field.labelVi : t('Chỉ tiêu không còn trong danh mục', 'Indicator no longer in the catalog');
    const goods = entry.goodsLineId ? data.shipment.goods.find(line => line.id === entry.goodsLineId) : undefined;
    gap(); text(`${entry.fieldId} · ${fieldName}${entry.goodsLineId ? ` · ${t('ID dòng hàng', 'Goods line ID')}: ${entry.goodsLineId}${goods ? ` (${goods.description})` : t(' · KHÔNG CÒN DÒNG HÀNG', ' · ORPHANED GOODS LINE')}` : ''}`, 10, 'teal');
    const applicable = entry.applicability === 'applicable' ? t('Áp dụng', 'Applicable') : entry.applicability === 'not_applicable' ? t('Không áp dụng', 'Not applicable') : t('Chưa quyết định', 'Unresolved');
    text(`${t('Áp dụng', 'Applicability')}: ${applicable} · ${t('Căn cứ', 'Basis')}: ${entry.basis || t('(chưa ghi)', '(not recorded)')}`, 9);
    const values = 'rows' in entry.value ? entry.value.rows : [entry.value];
    if (!values.length) text(t('Chưa có dòng dữ liệu.', 'No value rows entered.'), 8, 'muted');
    values.forEach((value, index) => {
      const record = value as unknown as Record<string, unknown>;
      if ('rows' in entry.value) text(`${t('Dòng', 'Row')} ${index + 1} · ID ${record.id}`, 8, 'muted');
      for (const [key, value] of Object.entries(record)) {
        if (key === 'kind' || key === 'id') continue;
        const component = field?.components.find(item => item.key === key);
        const name = component ? locale === 'en' ? component.labelEn : component.labelVi : key;
        text(`${name}: ${fmt(value) || t('(trống)', '(empty)')}`, 9);
      }
    });
    text(`${t('Lý do lưu / rà soát', 'Save / review reason')}: ${entry.reason}`, 8);
    text(`${t('Lưu bởi', 'Saved by')}: ${entry.updatedBy} · ${date(entry.updatedAt)} · ${t('Mã: chưa xác minh', 'Codes: unverified')}`, 8, 'muted');
    if (entry.review) text(`${entry.stale ? t('RÀ SOÁT ĐÃ CŨ', 'STALE REVIEW') : t('Đã rà soát nội bộ', 'Internally reviewed')}: ${entry.review.actorName} (${entry.review.actorId}) · ${date(entry.review.at)} · ${entry.review.reason}`, 8, entry.stale ? 'amber' : 'teal');
    else text(t('Chưa có xác nhận rà soát hiện hành.', 'No current review confirmation.'), 8, 'amber');
    if (entry.stale) text(`${t('Cần rà soát lại', 'Review again')}: ${entry.staleReason ? sys(entry.staleReason) : '—'}`, 8, 'amber');
    for (const provenance of entry.provenance) {
      if (provenance.kind === 'manual') text(`${t('Căn cứ nhập tay', 'Manual evidence')}: ${provenance.note}`, 8, 'muted');
      else {
        const document = data.documents.find(item => item.id === provenance.documentId);
        text(`${t('Nguồn', 'Source')}: ${document?.name || provenance.documentId} · ${provenance.documentId} · v${provenance.documentVersion} · ${t('trang', 'page')} ${provenance.page}`, 8, 'muted');
        text(`${t('Nguyên văn', 'Exact quote')}: ${provenance.quote}`, 8, 'muted');
      }
    }
  }
  section('05   Dòng hàng đề xuất', '05   Proposed goods lines');
  if (!data.shipment.goods.length) text(t('Chưa có dòng hàng.', 'No goods lines are available.'));
  data.shipment.goods.forEach((line, index) => {
    text(`${index + 1}. ${line.description || t('(thiếu mô tả)', '(description missing)')} - ${line.reviewed ? t('đã rà soát', 'reviewed') : t('chưa rà soát', 'not reviewed')}`, 10);
    text(`${t('Số lượng', 'Quantity')}: ${line.quantity || '—'} ${line.unit || ''} · ${t('Đơn giá', 'Unit price')}: ${line.unitPrice || '—'} · ${t('Trị giá', 'Amount')}: ${line.amount || '—'}`);
    const document = data.documents.find(item => item.id === line.sourceDocumentId);
    if (document) text(`${t('Nguồn', 'Source')}: ${document.name} · ${t('trang', 'page')} ${line.sourcePage || 1} · ${line.originalText || ''}`, 8, 'muted');
    const missing = t('chưa nhập', 'not entered');
    text(`HS: ${line.hsCode || missing} · ${t('Xuất xứ khai báo', 'Declared origin')}: ${line.origin || missing} · ${t('Thuế NK', 'Import duty')}: ${line.dutyRate || missing} · VAT: ${line.vatRate || missing}`, 8);
    text(t('HS, xuất xứ và thuế được ghi từ chứng từ hoặc người rà soát; chưa xác minh, không tự tính thuế hoặc ưu đãi FTA.', 'HS codes, origin and taxes are captured from documents or reviewers; unverified. Duties and FTA preferences are not calculated.'), 8, 'amber');
    if (line.reason) text(`${t('Lý do rà soát', 'Review reason')}: ${line.reason}`, 8); gap();
  });
  section('06   Vấn đề, mâu thuẫn và cách xử lý', '06   Issues, conflicts and resolutions');
  if (!data.issues.length) text(t('Không có vấn đề phần mềm được phát hiện. Phạm vi kiểm tra hạn chế; không đồng nghĩa tuân thủ.', 'No software issues were detected. Checks have limited scope; this does not establish compliance.'));
  for (const original of data.issues) {
    const issue = translateIssue(original, locale);
    text(`${issue.resolved ? t('Đã xử lý', 'Resolved') : t('CÒN MỞ', 'OPEN')} · ${issue.title}`, 10, issue.resolved ? 'teal' : 'amber'); text(issue.description);
    for (const id of issue.candidateIds) { const candidate = data.candidates.find(item => item.id === id); if (candidate) text(`${candidate.value} ← ${source(candidate)}`, 8, 'muted'); }
    if (issue.resolution) text(`${t('Giải trình', 'Explanation')}: ${issue.resolution.reason} · ${issue.resolution.actor} · ${date(issue.resolution.at)}`, 8); gap();
  }
  section('07   Chuẩn hóa tự động có bằng chứng', '07   Evidence-backed format normalization');
  if (!data.normalizations.length) text(t('Không có chuẩn hóa tự động trên các chứng từ hiện hành.', 'No automatic normalization was applied to the current documents.'));
  for (const normalization of data.normalizations) {
    const document = data.documents.find(item => item.id === normalization.documentId);
    text(`${label(normalization.field)}: “${normalization.before}” → “${normalization.after}”`);
    text(`${sys(normalization.reason)} · ${document?.name || normalization.documentId} · ${t('trang', 'page')} ${normalization.page}`, 8, 'muted');
  }
  section('08   Nhật ký chỉnh sửa và giá trị trước / sau', '08   Audit trail and before / after values');
  text(t('Giá trị và lý do đã ghi được giữ nguyên ngôn ngữ gốc để bảo toàn dấu vết.', 'Recorded values and reasons retain their original language to preserve the audit trail.'), 8, 'muted');
  for (const entry of data.audit) {
    text(`${date(entry.at)} · ${entry.actor} · ${auditActionLabel(entry.action, locale)}${entry.field ? ` · ${label(entry.field)}` : ''}`, 9, 'teal');
    if (entry.before !== undefined) text(`${t('Trước', 'Before')}: ${fmt(entry.before)}`, 8);
    if (entry.after !== undefined) text(`${t('Sau', 'After')}: ${fmt(entry.after)}`, 8);
    text(`${t('Lý do đã ghi', 'Recorded reason')}: ${entry.reason || '—'}`, 8, 'muted'); gap(5);
  }
  section('09   Lịch sử bàn giao ECUS và phiên bản cố định', '09   ECUS handoff history and frozen versions');
  if (!data.handoffs.length) text(t('Chưa chạy kết nối thử nghiệm. Chưa tạo hoặc kiểm tra bản nháp trên ECUS thật.', 'The test connector has not run. No draft has been created or checked in a real ECUS installation.'));
  for (const run of data.handoffs) {
    text(`TEST · ${run.status === 'succeeded' ? t('thành công', 'succeeded') : t('thất bại', 'failed')} · ${date(run.at)} · ${run.actor}`, 10);
    text(`${t('Bản cố định', 'Snapshot')} ${run.snapshotId} · ${t('lượt', 'run')} ${run.id} · ${run.draftReference || t('không có mã bản nháp', 'no draft reference')}`, 8);
    text(sys(run.message));
    text(t('IDA: chưa truyền · IDC: chưa đăng ký · Hải quan: chưa đánh giá', 'IDA: not transmitted · IDC: not registered · Customs: not assessed'), 8, 'muted');
  }
  for (const snapshot of data.snapshots) text(`${t('Phiên bản cố định', 'Frozen version')} ${snapshot.id} · ${t('bản duyệt', 'approved version')} v${snapshot.version} · ${date(snapshot.createdAt)} · ${snapshot.actor} · ${t('Chưa đánh giá hải quan', 'Customs not assessed')}`, 8, 'muted');
  section('10   Phạm vi và giới hạn', '10   Scope and limitations');
  text(t('Phần mềm đối chiếu dữ kiện lặp lại và kiểm tra số học trong phạm vi được hỗ trợ. PDF có lớp văn bản được đọc theo bố cục; bản scan được OCR cục bộ trong trình duyệt. OCR có thể đọc sai chữ, số hoặc cột. Mọi dữ kiện phải được đối chiếu với bản gốc; có thể sửa bằng bản chép thủ công có nhật ký.', 'The software compares repeated facts and arithmetic within its supported scope. PDF text layers are read using page layout; scans use local browser OCR. OCR can misread characters, numbers or columns. Every fact requires comparison with the original; corrections can use an audited manual transcription.'));
  text(t('Quy tắc pháp lý, bảng mã hiện hành, định giá, thuế, HS và ưu đãi FTA chưa được nạp hoặc kiểm chứng. Không có kết nối ECUS thật. Dữ liệu tổng hợp chỉ kiểm tra hành vi phần mềm; chưa chứng minh độ chính xác trên nhiều nhà cung cấp.', 'Legal rules, current code tables, valuation, taxes, HS classifications and FTA preferences have not been loaded or verified. No real ECUS connection exists. Synthetic data tests software behavior; it does not establish accuracy across suppliers.'));
  return { data, blocks, title, subject, footer, locale };
}
