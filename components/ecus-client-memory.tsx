"use client";

import { useState } from "react";
import { Check, History, Loader2, X } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import type { ClientMemorySuggestion } from "@/lib/client-memory";

type Props = {
  suggestions: ClientMemorySuggestion[];
  disabled: boolean;
  hasPendingEdit: boolean;
  onApply: (memoryId: string, expectedValue: string) => Promise<boolean>;
  onDismiss: (memoryId: string) => Promise<boolean>;
  onForget: (memoryId: string) => Promise<boolean>;
};

/** Prior human corrections remain suggestions until the user explicitly applies one. */
export function EcusClientMemory({
  suggestions,
  disabled,
  hasPendingEdit,
  onApply,
  onDismiss,
  onForget,
}: Props) {
  const { locale, date } = useLocale();
  const say = (vi: string, en: string) => (locale === "vi" ? vi : en);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  if (!suggestions.length) return null;
  const act = async (key: string, action: () => Promise<boolean>) => {
    if (disabled || pending) return;
    setPending(key);
    setError("");
    try {
      if (!(await action()))
        setError(
          say(
            "Chưa lưu được thao tác. Thông tin đang nhập vẫn được giữ lại.",
            "The action was not saved. Your current input is preserved.",
          ),
        );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : say("Chưa lưu được thao tác.", "The action was not saved."),
      );
    } finally {
      setPending("");
    }
  };
  return (
    <section
      className="ecus-client-memory"
      aria-label={say(
        "Thông tin đã sửa trước đây của công ty",
        "Previous corrections for this company",
      )}
    >
      <header>
        <History size={15} />
        <strong>
          {say(
            "Thông tin từng sửa cho công ty này",
            "Previous correction for this company",
          )}
        </strong>
      </header>
      <p className="ecus-memory-intro">
        {say(
          "Được lưu từ lần sửa của người dùng trong hồ sơ trước. Đây không phải dữ liệu đọc từ chứng từ hiện tại.",
          "Saved from a person’s correction in an earlier shipment. This is separate from the current document evidence.",
        )}
      </p>
      {suggestions.map((suggestion) => {
        const memory = suggestion.memory;
        return (
          <article className="ecus-memory-card" key={memory.id}>
            <strong className="ecus-memory-value">{memory.value}</strong>
            <p className="ecus-memory-reason">
              {memory.reason || memory.basis}
            </p>
            <div className="ecus-memory-source">
              <span title={memory.sourceCaseTitle}>
                {memory.sourceReference} · {memory.sourceCaseTitle}
              </span>
              <span>
                {date(memory.createdAt)} · {memory.createdBy.name}
              </span>
            </div>
            <details className="ecus-memory-context">
              <summary>
                {say("Căn cứ đối chiếu công ty", "Company match and basis")}
              </summary>
              <p>
                {suggestion.match === "importer_code"
                  ? say(
                      "Trùng mã người nhập khẩu.",
                      "The importer code matches.",
                    )
                  : say(
                      "Trùng tên và địa chỉ công ty.",
                      "The company name and address match.",
                    )}
              </p>
              <p>{memory.basis}</p>
            </details>
            {suggestion.conflictsWithCurrent && (
              <p className="ecus-memory-current">
                <span>{say("Giá trị hiện tại", "Current value")}</span>
                <strong>{suggestion.currentValue}</strong>
              </p>
            )}
            <div className="ecus-memory-actions">
              <button
                className="button secondary small"
                disabled={disabled || !!pending || hasPendingEdit}
                onClick={() =>
                  void act(`apply:${memory.id}`, () =>
                    onApply(memory.id, suggestion.currentValue),
                  )
                }
              >
                {pending === `apply:${memory.id}` ? (
                  <Loader2 size={12} className="spin" />
                ) : (
                  <Check size={12} />
                )}
                {suggestion.conflictsWithCurrent
                  ? say(
                      "Dùng thay giá trị hiện tại",
                      "Use instead of current value",
                    )
                  : say("Dùng gợi ý", "Use suggestion")}
              </button>
              <button
                className="text-button"
                disabled={disabled || !!pending}
                onClick={() =>
                  void act(`dismiss:${memory.id}`, () => onDismiss(memory.id))
                }
              >
                <X size={12} />
                {say("Bỏ qua hồ sơ này", "Dismiss for this shipment")}
              </button>
            </div>
            <button
              className="text-button ecus-memory-forget"
              disabled={disabled || !!pending}
              onClick={() =>
                void act(`forget:${memory.id}`, () => onForget(memory.id))
              }
            >
              {say(
                "Không gợi ý lại thông tin này",
                "Stop suggesting this correction",
              )}
            </button>
          </article>
        );
      })}
      {hasPendingEdit && (
        <p className="ecus-memory-pending">
          {say(
            "Lưu nội dung đang sửa của ô này trước khi dùng gợi ý.",
            "Save this field’s edits before using a prior correction.",
          )}
        </p>
      )}
      {error && (
        <p className="ecus-warning-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
