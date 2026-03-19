import logoSvg from "../assets/logo.svg";
import type { ActivityBarItemId } from "./settings/settingsTypes";
import { useT } from "../i18n";

interface ActivityBarProps {
  onOpenSearch: () => void;
  onOpenGraph: () => void;
  onToggleAI: () => void;
  onOpenKinetics: () => void;
  onCreateChemDraw: () => void;
  onBackToManager: () => void;
  onToggleTimeline: () => void;
  canOpenKinetics: boolean;
  kineticsOpen: boolean;
  timelineOpen: boolean;
  activePanel: string;
  visibleItems: ActivityBarItemId[];
}

/** 最左侧窄图标条 — 参考 Obsidian / VS Code Activity Bar */
export default function ActivityBar({
  onOpenSearch, onOpenGraph, onToggleAI, onOpenKinetics, onCreateChemDraw, onBackToManager,
  onToggleTimeline, canOpenKinetics, kineticsOpen, timelineOpen, activePanel: _, visibleItems,
}: ActivityBarProps) {
  const t = useT();
  const show = (id: ActivityBarItemId) => visibleItems.includes(id);

  return (
    <div className="w-[42px] shrink-0 flex flex-col items-center select-none app-chrome"
      style={{
        borderRight: "0.5px solid var(--chrome-border)",
      }}>
      {/* Logo / 返回首页 */}
      <button type="button" onClick={onBackToManager}
        className="w-full h-[42px] flex items-center justify-center cursor-pointer
          transition-all duration-150 hover:bg-[var(--sidebar-hover)] active:scale-95"
        title={t("activityBar.backToManager")} aria-label={t("activityBar.backToManager")}>
        <img src={logoSvg} alt="" className="w-[20px] h-[20px] rounded-[4px]" />
      </button>

      {/* 分隔线 */}
      <div className="w-5 my-1" style={{ borderTop: "0.5px solid var(--separator-light)" }} />

      {show("search") && (
        <IconBtn onClick={onOpenSearch} title={`${t("activityBar.search")} (Ctrl+K)`} aria-label={t("activityBar.search")}>
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </IconBtn>
      )}

      {show("graph") && (
        <IconBtn onClick={onOpenGraph} title={`${t("activityBar.graph")} (Ctrl+G)`} aria-label={t("activityBar.graph")}>
          <circle cx="12" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
          <line x1="12" y1="7" x2="5" y2="17" /><line x1="12" y1="7" x2="19" y2="17" />
        </IconBtn>
      )}

      {show("ai") && (
        <IconBtn onClick={onToggleAI} title={`${t("activityBar.ai")} (Ctrl+J)`} aria-label={t("activityBar.ai")}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </IconBtn>
      )}

      {show("chemdraw") && (
        <IconBtn onClick={onCreateChemDraw} title={t("activityBar.chemdraw")} aria-label={t("activityBar.chemdraw")}>
          <polygon points="12,3 19.5,7.5 19.5,16.5 12,21 4.5,16.5 4.5,7.5" fill="none" />
        </IconBtn>
      )}

      {show("kinetics") && canOpenKinetics && (
        <IconBtn
          onClick={onOpenKinetics}
          title={t("activityBar.kinetics")}
          aria-label={t("activityBar.kinetics")}
          active={kineticsOpen}
        >
          <line x1="5" y1="19" x2="5" y2="11" />
          <line x1="12" y1="19" x2="12" y2="7" />
          <line x1="19" y1="19" x2="19" y2="4" />
          <circle cx="5" cy="9" r="1.5" />
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="19" cy="2.5" r="1.5" />
        </IconBtn>
      )}

      {show("timeline") && (
        <IconBtn
          onClick={onToggleTimeline}
          title={t("activityBar.timeline")}
          aria-label={t("activityBar.timeline")}
          active={timelineOpen}
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </IconBtn>
      )}

    </div>
  );
}

/** 通用图标按钮 */
function IconBtn({ onClick, title, children, active = false, "aria-label": ariaLabel }: {
  onClick: () => void; title: string; children: React.ReactNode; active?: boolean; "aria-label": string;
}) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={ariaLabel}
      className="w-[32px] h-[32px] my-[2px] rounded-[6px] flex items-center justify-center
        cursor-pointer transition-all duration-150
        hover:bg-[var(--sidebar-hover)] active:scale-95"
      style={{
        color: active ? "var(--accent)" : "var(--text-quaternary)",
        background: active ? "rgba(10,132,255,0.12)" : undefined,
      }}>
      <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}
