"use client";
import { KimiReviewButton } from "@/components/kimi-review";
import { assessPageRejections } from '@/lib/source-completeness';
import { DOCUMENT_LABELS } from "@/lib/engine";
import { useLocale } from "@/lib/i18n";
import { translateSystemText } from "@/lib/i18n-core";
import type {
  Action,
  DocumentType,
  ShipmentCase,
  WorkspaceResponse,
  WorkspaceState,
} from "@/lib/types";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  GitBranch,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import React from "react";
import { Empty, activeDocs, documentLabel } from "./shared";
import { ExtractionTrace } from "./extraction-trace";
type Props = {
  state: WorkspaceState;
  shipment: ShipmentCase;
  documentId: string;
  page: number;
  mode: string;
  selectedDocuments: string[];
  onDocumentChange: (id: string) => void;
  onPageChange: (page: number) => void;
  onModeChange: (mode: string) => void;
  onSelectionChange: React.Dispatch<React.SetStateAction<string[]>>;
  busy: boolean;
  hasPendingDrafts: boolean;
  reviewReason: string;
  mutation: (action: Action, success?: string) => Promise<boolean>;
  onUpload: () => void;
  onGroup: () => void;
  onReplace: (id: string) => void;
  onBusyChange: (busy: boolean) => void;
  onApplied: (response: WorkspaceResponse, message: string) => void;
  onConflict: (response: WorkspaceResponse) => void;
};
export function ShipmentDocuments({
  state,
  shipment: current,
  documentId,
  page,
  mode: sourceMode,
  selectedDocuments: selectedDocs,
  onDocumentChange: setDocId,
  onPageChange: setPage,
  onModeChange: setSourceMode,
  onSelectionChange: setSelectedDocs,
  busy,
  hasPendingDrafts,
  reviewReason,
  mutation,
  onUpload,
  onGroup,
  onReplace,
  onBusyChange: setBusy,
  onApplied,
  onConflict,
}: Props) {
  const { t, locale } = useLocale();
  const editable = current.status === "review";
  const documents = activeDocs(state, current.id);
  const [documentSearch, setDocumentSearch] = React.useState({
    caseId: current.id,
    query: "",
  });
  const documentQuery =
    documentSearch.caseId === current.id ? documentSearch.query : "";
  const visibleDocuments = documents.filter((document) =>
    [document.name, ...(document.sourcePaths || [])]
      .join(" ")
      .toLocaleLowerCase()
      .includes(documentQuery.trim().toLocaleLowerCase()),
  );
  const source = documents.find((d) => d.id === documentId) || documents[0];
  const sourcePage =
    source?.pages.find((p) => p.page === page) || source?.pages[0];
  const legacySource =
    !!source && source.extractionPipeline !== "kimi" && !source.referenceOnly;
  const kimiVisualPage =
    source?.extractionPipeline === "kimi" &&
    (source.mime === "application/pdf" || source.mime.startsWith("image/"));
  const pageQuotes = [
    ...new Set(
      state.candidates
        .filter(
          (candidate) =>
            candidate.documentId === source?.id &&
            candidate.documentVersion === source.version &&
            candidate.page === sourcePage?.page &&
            candidate.method.startsWith("kimi:"),
        )
        .map((candidate) => candidate.originalText),
    ),
  ];
  const visibleText = kimiVisualPage
    ? pageQuotes.join("\n\n")
    : sourcePage?.text;
  const pageRead = !!sourcePage?.aiReadability;
  const clearSupplementalPage =
    sourcePage?.aiReadability === "clear" &&
    sourcePage.documentType === "other";
  const sourceFormatUnsupported = source?.extractionStatus === "unsupported";
  const sourceCannotOpen =
    source?.extractionStatus === "failed" || (!!source && !source.pages.length);
  const sourceBlocked = sourceFormatUnsupported || sourceCannotOpen;
  const blockingRejectedPages = source?.aiRejectedPages?.filter(page => assessPageRejections(state, source, page).blocking) ?? [];
  return (
    <aside className="source-panel">
      <div className="panel-heading">
        <h2>
          <FileText size={16} />
          {t("Chứng từ nguồn ")}
          <span>{documents.length}</span>
        </h2>
        <button
          className="icon-button"
          aria-label={t("Tải thêm chứng từ")}
          disabled={busy || !editable}
          onClick={() => onUpload()}
        >
          <Plus size={17} />
        </button>
      </div>
      {current.sourceCollection && (
        <div
          className="source-collection"
          style={{ display: "block", overflowWrap: "anywhere" }}
        >
          <p className="muted">
            {current.sourceCollection.name} · {current.sourceCollection.folder}
          </p>
          {!current.groupingConfirmed && (
            <p>
              <strong>{t("Chưa xác nhận phân nhóm")}</strong>
              <br />
              {t(
                "Đối chiếu chứng từ trong thư mục trước khi xác nhận cùng lô hàng.",
              )}
            </p>
          )}
        </div>
      )}
      <label className="search-field" style={{ margin: "0 16px 12px" }}>
        <Search size={15} />
        <input
          type="search"
          aria-label={t("Tìm chứng từ theo tên hoặc đường dẫn")}
          placeholder={t("Tìm tên tệp hoặc đường dẫn…")}
          value={documentQuery}
          onChange={(event) =>
            setDocumentSearch({ caseId: current.id, query: event.target.value })
          }
        />
      </label>
      <div className="document-list">
        {visibleDocuments.map((doc) => (
          <div
            className={`document-item ${source?.id === doc.id ? "selected" : ""}`}
            key={doc.id}
          >
            <input
              aria-label={t("Chọn {p0} để di chuyển", { p0: doc.name })}
              type="checkbox"
              checked={selectedDocs.includes(doc.id)}
              disabled={!editable}
              onChange={(e) =>
                setSelectedDocs((v) =>
                  e.target.checked
                    ? [...v, doc.id]
                    : v.filter((id) => id !== doc.id),
                )
              }
            />
            <button
              onClick={() => {
                setDocId(doc.id);
                setPage(1);
              }}
            >
              <span
                className={`file-symbol ${doc.type === "invoice" ? "blue" : doc.type === "packing_list" ? "green" : "amber"}`}
              >
                <FileText size={18} />
              </span>
              <span>
                <strong>{doc.name}</strong>
                <small>
                  {doc.referenceOnly
                    ? t("Chỉ tham khảo")
                    : t(documentLabel(doc.type))}{" "}
                  · v{doc.version}
                </small>
              </span>
              {!doc.referenceOnly && doc.extractionStatus !== "extracted" && (
                <AlertTriangle size={13} className="text-amber" />
              )}
            </button>
          </div>
        ))}
        {!visibleDocuments.length && documentQuery && (
          <p className="muted">{t("Không có chứng từ khớp tìm kiếm.")}</p>
        )}
      </div>
      <div className="source-tools">
        <button
          className="text-button"
          disabled={busy || !editable || !documents.length}
          onClick={() => onGroup()}
        >
          <GitBranch size={13} />
          {t("Gộp / tách / di chuyển")}
        </button>
        {!current.groupingConfirmed && (
          <button
            className="text-button"
            disabled={busy || !editable}
            onClick={() =>
              void mutation(
                {
                  type: "confirm_grouping",
                  caseId: current.id,
                  reason:
                    reviewReason ||
                    t("Đã đối chiếu chứng từ và xác nhận cùng lô hàng"),
                },
                t("Đã xác nhận phân nhóm"),
              )
            }
          >
            <Check size={13} />
            {t("Xác nhận nhóm")}
          </button>
        )}
      </div>
      {source && !source.referenceOnly && !sourceBlocked && (
        <div className="source-ai-tools">
          {legacySource && (
            <div className="source-legacy-reading">
              <strong>
                {locale === "vi"
                  ? "Kết quả từ bộ đọc trước đây"
                  : "Previous extractor results"}
              </strong>
              <p>
                {locale === "vi"
                  ? "Dữ liệu đang lưu có thể đến từ OCR hoặc trình đọc PDF cũ. Quy trình hiện tại dùng Kimi để đọc lại bản gốc; các giá trị cũ không được gắn nhãn là kết quả Kimi."
                  : "Saved data may come from an earlier OCR or PDF reader. The current workflow uses Kimi to read the original; earlier values are not labeled as Kimi results."}
              </p>
            </div>
          )}
          <KimiReviewButton
            document={source}
            caseId={current.id}
            revision={state.revision}
            initialPage={page}
            disabled={busy || !editable || hasPendingDrafts}
            label={
              legacySource
                ? locale === "vi"
                  ? "Đọc bản gốc bằng Kimi"
                  : "Read original with Kimi"
                : undefined
            }
            onBusyChange={setBusy}
            onApplied={(response, message) => {
              onApplied(response, message);
            }}
            onConflict={(response) => {
              onConflict(response);
            }}
          />
          {source.aiStatus && (
            <p className="muted" role="status">
              {legacySource || source.aiStatus === "unavailable"
                ? locale === "vi"
                  ? "Đang chờ Kimi đọc bản gốc."
                  : "Waiting for Kimi to read the original."
                : source.aiStatus === "completed"
                  ? t("Kimi đã xử lý toàn bộ trang chứng từ.")
                  : source.aiStatus === "partial"
                    ? t(
                        "Kimi đã xử lý {p0}/{p1} trang. Có thể tiếp tục các trang còn lại.",
                        {
                          p0: source.aiProcessedPages?.length || 0,
                          p1: source.pages.length,
                        },
                      )
                    : t(
                        "Kimi chưa hoàn tất. Bản gốc và kết quả các trang đã xử lý vẫn được lưu.",
                      )}
            </p>
          )}
          {source.aiRejectedPages?.length ? (
            <p className="muted" role="status">
              {blockingRejectedPages.length ? t(
                "Một số đề xuất AI chưa đủ căn cứ trên trang {p0}. Kiểm tra hoặc đọc lại các trang này; giá trị bị loại chưa được lưu.",
                { p0: blockingRejectedPages.join(", ") },
              ) : locale === 'vi'
                ? 'Các đề xuất bị loại vẫn được giữ trong nhật ký. Hướng dẫn ưu tiên nguồn rõ ràng khác cho cùng chỉ tiêu; các đề xuất này không chặn việc kiểm tra thông tin còn thiếu.'
                : 'Rejected readings remain in the audit trail. The guide selects clear evidence from a primary document for the same fields; these readings do not block missing-information checks.'}
            </p>
          ) : source.aiError &&
            source.aiError !==
              "AI has not checked every page. Continue the remaining pages." ? (
            <p className="muted" role="status">
              {translateSystemText(source.aiError, locale)}
            </p>
          ) : null}
        </div>
      )}
      {source ? (
        <>
          {source.referenceOnly && (
            <p className="muted" style={{ margin: "12px 16px" }}>
              {t(
                "Tài liệu tham khảo: giữ bản gốc để tra cứu, không dùng để tự điền bản khai.",
              )}
            </p>
          )}
          {!!source.sourcePaths?.length && (
            <details
              className="version-history source-paths"
              style={{ margin: "12px 16px", overflowWrap: "anywhere" }}
            >
              <summary>
                {t("Đường dẫn nguồn ({p0})", { p0: source.sourcePaths.length })}
              </summary>
              <ul>
                {source.sourcePaths.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="source-controls">
            <select
              aria-label={t("Loại chứng từ")}
              value={
                source.type === "other" && !source.classificationConfirmed
                  ? ""
                  : source.type
              }
              disabled={busy || !editable || source.referenceOnly}
              onChange={(e) =>
                void mutation(
                  {
                    type: "classify_document",
                    documentId: source.id,
                    documentType: e.target.value as DocumentType,
                  },
                  t("Đã cập nhật loại chứng từ"),
                )
              }
            >
              <option value="" disabled>
                {t("Chọn loại chứng từ…")}
              </option>
              {Object.entries(DOCUMENT_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {t(label)}
                </option>
              ))}
            </select>
            <a
              href={`/api/documents/${source.id}`}
              target="_blank"
              rel="noreferrer"
              title={t("Mở tệp gốc")}
              aria-label={t("Mở tệp gốc")}
            >
              <ArrowUpRight size={17} />
            </a>
          </div>
          {sourcePage?.label && (
            <p
              className="muted"
              style={{ margin: "8px 16px", overflowWrap: "anywhere" }}
            >
              {sourcePage.label}
            </p>
          )}
          <div className="source-preview-toolbar">
            <span>
              <button
                className={sourceMode === "text" ? "active" : ""}
                onClick={() => setSourceMode("text")}
              >
                {t("Văn bản")}
              </button>
              <button
                className={sourceMode === "original" ? "active" : ""}
                onClick={() => setSourceMode("original")}
              >
                {t("Bản gốc")}
              </button>
            </span>
            <span>
              <button
                className="icon-button"
                disabled={page <= 1}
                aria-label={t("Trang trước")}
                onClick={() => setPage(Math.max(1, page - 1))}
              >
                <ChevronLeft size={14} />
              </button>
              {sourcePage?.page || page} / {Math.max(1, source.pages.length)}
              <button
                className="icon-button"
                disabled={page >= source.pages.length}
                aria-label={t("Trang sau")}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={14} />
              </button>
            </span>
          </div>
          {!source.referenceOnly && (
            <ExtractionTrace
              state={state}
              shipment={current}
              document={source}
              page={sourcePage}
            />
          )}
          {sourceMode === "original" ? (
            <div className="original-preview">
              {source.mime.startsWith("image/") ? (
                <img
                  alt={t("Bản gốc {p0}", { p0: source.name })}
                  src={`/api/documents/${source.id}`}
                />
              ) : source.mime === "application/pdf" ? (
                <iframe
                  title={source.name}
                  src={`/api/documents/${source.id}#page=${page}`}
                />
              ) : (
                <p>
                  <a
                    href={`/api/documents/${source.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("Mở chứng từ gốc ")}
                    <ArrowUpRight size={14} />
                  </a>
                </p>
              )}
            </div>
          ) : (
            <div className="paper-wrap">
              <div className="source-paper">
                <div className="paper-topline">
                  {kimiVisualPage || sourcePage?.textSource === "kimi"
                    ? t("NỘI DUNG KIMI ĐỌC TỪ CHỨNG TỪ")
                    : sourcePage?.textSource === "ocr" ||
                        sourcePage?.textSource === "pdf_text"
                      ? t("VĂN BẢN ĐÃ LƯU TỪ LẦN NHẬP TRƯỚC")
                      : sourcePage?.textSource === "office"
                        ? t("VĂN BẢN TỪ TÀI LIỆU / BẢNG TÍNH")
                        : sourcePage?.textSource === "xml"
                          ? t("VĂN BẢN TỪ XML")
                          : t("VĂN BẢN TỪ CHỨNG TỪ ")}
                  <span>
                    {sourcePage?.label ||
                      `${t("TRANG ")}${sourcePage?.page || page}`}
                  </span>
                </div>
                {visibleText ? (
                  <pre>{visibleText}</pre>
                ) : (
                  <div className="source-empty">
                    {!sourceBlocked && sourcePage?.aiReadability === "clear" ? (
                      <Check size={24} />
                    ) : (
                      <AlertCircle size={24} />
                    )}
                    <strong>
                      {t(
                        sourceFormatUnsupported
                          ? "Cần đổi định dạng chứng từ"
                          : sourceCannotOpen
                            ? "Không mở được trang gốc"
                            : clearSupplementalPage
                              ? "Trang bổ sung đã được đọc"
                              : pageRead
                                ? "Kimi đã đọc trang này"
                                : source.extractionStatus === "pending_ai"
                                  ? "Đang chờ Kimi đọc chứng từ"
                                  : "Chưa có nội dung đọc được",
                      )}
                    </strong>
                    <p>
                      {sourceFormatUnsupported
                        ? t(
                            "Bản gốc đã được lưu. Thay bằng PDF hoặc ảnh được hỗ trợ để Kimi đọc nội dung.",
                          )
                        : sourceCannotOpen
                          ? t(
                              "Bản gốc đã được lưu nhưng chưa mở được trang. Thay bằng PDF không khóa hoặc ảnh đọc được.",
                            )
                          : clearSupplementalPage
                            ? t(
                                "Đây là trang bổ sung, không có trường tờ khai cần trích xuất. Không cần xác nhận trang này.",
                              )
                            : sourcePage?.aiReadability === "clear"
                              ? t(
                                  "Trang này không có giá trị thuộc các trường đang hỗ trợ. Bạn có thể xem bản gốc hoặc yêu cầu Kimi đọc lại.",
                                )
                              : source.extractionError
                                ? translateSystemText(
                                    source.extractionError,
                                    locale,
                                  )
                                : t(
                                    "Dùng Kimi để đọc trang gốc. Thông tin rõ ràng sẽ tự điền vào bản nháp; bạn vẫn có thể sửa thủ công.",
                                  )}
                    </p>
                    {sourceBlocked ? (
                      <button
                        className="button secondary small"
                        disabled={busy || !editable}
                        onClick={() => onReplace(source.id)}
                      >
                        {t("Thay bản đọc được")}
                      </button>
                    ) : clearSupplementalPage ? (
                      <button
                        className="button secondary small"
                        onClick={() => setSourceMode("original")}
                      >
                        {t("Xem bản gốc")}
                      </button>
                    ) : (
                      !source.referenceOnly && (
                        <KimiReviewButton
                          document={source}
                          caseId={current.id}
                          revision={state.revision}
                          initialPage={page}
                          disabled={busy || !editable || hasPendingDrafts}
                          onBusyChange={setBusy}
                          onApplied={onApplied}
                          onConflict={onConflict}
                        />
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="source-footer">
            <span>
              v{source.version} · {Math.max(1, Math.round(source.size / 1024))}{" "}
              KB {source.synthetic && t("· Giả lập")}
            </span>
            <div>
              <button
                className="text-button"
                disabled={!editable || busy}
                onClick={() => {
                  onReplace(source.id);
                }}
              >
                {t("Thay bản mới")}
              </button>
            </div>
            {state.documents.some(
              (d) => d.caseId === current.id && !d.active,
            ) && (
              <details className="version-history">
                <summary>{t("Chứng từ phiên bản trước")}</summary>
                {state.documents
                  .filter((d) => d.caseId === current.id && !d.active)
                  .map((d) => (
                    <a
                      key={d.id}
                      href={`/api/documents/${d.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {d.name} · v{d.version}
                      <ArrowUpRight size={10} />
                    </a>
                  ))}
              </details>
            )}
          </div>
        </>
      ) : (
        <Empty icon={FileText} title={t("Chưa có chứng từ")}>
          <p>{t("Tải lên chứng từ để bắt đầu rà soát.")}</p>
          <button className="button secondary" onClick={() => onUpload()}>
            <Upload size={15} />
            {t("Tải chứng từ")}
          </button>
        </Empty>
      )}
    </aside>
  );
}
