"use client";

import { SessionControl } from "@/components/account-access";
import { useLocale } from "@/lib/i18n";
import type { Actor } from "@/lib/types";
import {
  Bell,
  ChevronRight,
  FolderOpen,
  FlaskConical,
  HardDrive,
  Settings2,
} from "lucide-react";
import type { ReactNode } from "react";
import { initials } from "./shared";

export type WorkspaceView = "shipments" | "settings" | "samples";

type Props = {
  view: WorkspaceView;
  shipmentReference?: string;
  actor?: Actor;
  role?: "owner" | "reviewer";
  localMode: boolean;
  shipmentCount: number;
  sessionDisabled: boolean;
  onNavigate: (view: WorkspaceView) => void;
  onActivity: () => void;
  children: ReactNode;
};

export function WorkspaceShell({
  view,
  shipmentReference,
  actor,
  role,
  localMode,
  shipmentCount,
  sessionDisabled,
  onNavigate,
  onActivity,
  children,
}: Props) {
  const { t, locale, setLocale } = useLocale();
  return (
    <div className="workspace-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => onNavigate("shipments")}
          aria-label={t("Hồ sơ lô hàng")}
        >
          <span className="brand-mark">
            <span />
            <span />
            <span />
          </span>
          <span>
            AICD<span className="brand-dot">.</span>
          </span>
        </button>
        <p className="sidebar-description">{t("Từ chứng từ đến bản khai.")}</p>
        <nav aria-label={t("Điều hướng chính")}>
          <button
            className={`nav-item ${view === "shipments" ? "active" : ""}`}
            aria-label={t("Lô hàng")}
            title={t("Lô hàng")}
            aria-current={view === "shipments" ? "page" : undefined}
            onClick={() => onNavigate("shipments")}
          >
            <FolderOpen size={18} />
            <span>{t("Lô hàng")}</span>
            {shipmentCount > 0 && (
              <span className="nav-count">{shipmentCount}</span>
            )}
          </button>
          {localMode && <button className={`nav-item ${view === "samples" ? "active" : ""}`} aria-current={view === "samples" ? "page" : undefined} aria-label={locale==='en'?'Sample tests':'Kiểm thử mẫu'} title={locale==='en'?'Sample tests':'Kiểm thử mẫu'} onClick={()=>onNavigate('samples')}><FlaskConical size={18}/><span>{locale==='en'?'Sample tests':'Kiểm thử mẫu'}</span></button>}
          <button
            className={`nav-item ${view === "settings" ? "active" : ""}`}
            aria-label={t("Cài đặt")}
            title={t("Cài đặt")}
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => onNavigate("settings")}
          >
            <Settings2 size={18} />
            <span>{t("Cài đặt")}</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <span className="avatar">{initials(actor?.name || "AICD")}</span>
            <span>
              <strong>
                {localMode
                  ? t("Người dùng trên Mac này")
                  : actor?.name || t("Không gian làm việc")}
              </strong>
              <small>
                {localMode
                  ? t("Cục bộ · một người")
                  : role === "owner"
                    ? t("Quản trị viên")
                    : t("Người rà soát")}
              </small>
            </span>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumbs">
            {view==='samples' ? (locale==='en'?'Sample tests':'Kiểm thử mẫu') : t(view === "settings" ? "Cài đặt" : "Lô hàng")}
            {shipmentReference && (
              <>
                <ChevronRight size={14} />
                <strong>{shipmentReference}</strong>
              </>
            )}
          </div>
          <div className="topbar-right">
            {actor && <SessionControl disabled={sessionDisabled} />}
            <label className="language-switch">
              <span className="sr-only">{t("Ngôn ngữ giao diện")}</span>
              <select
                aria-label={t("Ngôn ngữ giao diện")}
                value={locale}
                onChange={(event) =>
                  setLocale(event.target.value as "vi" | "en")
                }
              >
                <option value="vi" lang="vi">
                  Tiếng Việt
                </option>
                <option value="en" lang="en">
                  English
                </option>
              </select>
            </label>
            <span
              className={`test-label ${localMode ? "local-mode-label" : ""}`}
            >
              {localMode && <HardDrive size={12} />}
              {t(localMode ? "LƯU TRÊN MAC NÀY" : "MÔI TRƯỜNG THỬ NGHIỆM")}
            </span>
            <button
              className="icon-button"
              aria-label={t("Xem hoạt động gần đây")}
              onClick={onActivity}
            >
              <Bell size={18} />
            </button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
