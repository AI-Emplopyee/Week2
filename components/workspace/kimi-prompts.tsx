"use client";

import { useState } from "react";
import { ArrowUpRight, FileCode2 } from "lucide-react";
import type { AiPrompt, AiPromptsResponse } from "@/lib/ai-prompts";
import { useLocale } from "@/lib/i18n";
import { fetchWithSession } from "@/lib/auth-client";

const promptLabels: Record<AiPrompt['id'], [string, string]> = {
  extraction: ["Đọc chứng từ và điền bản nháp", "Document extraction and draft fields"],
  'page-image': ["Nhãn ảnh trang", "Page image label"],
  repair: ["Sửa kết quả không đạt kiểm tra", "Repair a failed validation"],
  'email-matching': ["Đối chiếu email với lô hàng", "Match emails to shipments"],
};

export function KimiPrompts() {
  const { locale } = useLocale();
  const [data, setData] = useState<AiPromptsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const say = (vi: string, en: string) => locale === "vi" ? vi : en;

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetchWithSession('/api/ai/prompts', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load prompts');
      setData(await response.json() as AiPromptsResponse);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card settings-card kimi-prompts-card">
      <div className="section-heading">
        <h2><FileCode2 size={19} />{say("Prompt Kimi", "Kimi prompts")}</h2>
        {data?.model && <span className="muted">{data.model}</span>}
      </div>
      <p>{say(
        "Xem nguyên văn các chỉ dẫn mà ứng dụng hiện gửi đến Kimi để đọc chứng từ, sửa kết quả và đối chiếu email.",
        "Read the exact instructions the app currently sends to Kimi to read documents, repair results and match emails.",
      )}</p>
      <button className="button secondary" disabled={loading} onClick={() => void load()}>
        {loading ? say("Đang tải…", "Loading…") : data ? say("Làm mới prompt", "Refresh prompts") : say("Xem prompt Kimi", "View Kimi prompts")}
      </button>
      {failed && <p role="alert">{say("Không tải được prompt. Vui lòng thử lại.", "Could not load prompts. Please try again.")}</p>}
      {data && (
        <div className="kimi-prompts-list">
          <p className="muted">{say(
            "Ảnh trang hoặc nội dung tệp được gửi riêng cùng các chỉ dẫn này. {{pageNumber}} và {{validationFeedback}} được thay bằng số trang và kết quả kiểm tra của lần chạy. Nội dung prompt gốc được giữ bằng tiếng Anh.",
            "Page images or file contents accompany these instructions. {{pageNumber}} and {{validationFeedback}} are replaced with the page number and validation feedback for that run. The original prompt wording is in English.",
          )}</p>
          {data.prompts.map(prompt => (
            <details className="kimi-prompt" key={prompt.id}>
              <summary>{promptLabels[prompt.id][locale === 'vi' ? 0 : 1]} <small>· {prompt.role}</small></summary>
              <pre tabIndex={0}>{prompt.text}</pre>
            </details>
          ))}
          <a className="text-button" href="/api/ai/prompts" target="_blank" rel="noreferrer">
            {say("Mở JSON prompt", "Open prompts as JSON")} <ArrowUpRight size={14} />
          </a>
        </div>
      )}
    </section>
  );
}
