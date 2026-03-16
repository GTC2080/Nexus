import logoSvg from "../assets/logo.svg";

interface ActivityBarProps {
  onOpenSearch: () => void;
  onOpenGraph: () => void;
  onToggleAI: () => void;
  onBackToManager: () => void;
  activePanel: string;
}

/** 最左侧窄图标条 — 参考 Obsidian / VS Code Activity Bar */
export default function ActivityBar({
  onOpenSearch, onOpenGraph, onToggleAI, onBackToManager, activePanel: _,
}: ActivityBarProps) {
  return (
    <div className="w-[44px] shrink-0 flex flex-col items-center select-none"
      style={{
        background: "rgba(22,22,24,0.95)",
        borderRight: "0.5px solid rgba(255,255,255,0.04)",
      }}>
      {/* Logo / 返回首页 */}
      <button type="button" onClick={onBackToManager}
        className="w-full h-[44px] flex items-center justify-center cursor-pointer
          transition-all duration-150 hover:bg-white/[0.06] active:scale-95"
        title="返回知识库管理" aria-label="返回知识库管理">
        <img src={logoSvg} alt="" className="w-[20px] h-[20px] rounded-[4px]" />
      </button>

      {/* 分隔线 */}
      <div className="w-5 my-1" style={{ borderTop: "0.5px solid rgba(255,255,255,0.06)" }} />

      {/* 搜索 */}
      <IconBtn onClick={onOpenSearch} title="搜索 (Ctrl+K)" aria-label="搜索">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </IconBtn>

      {/* 知识图谱 */}
      <IconBtn onClick={onOpenGraph} title="知识图谱 (Ctrl+G)" aria-label="知识图谱">
        <circle cx="12" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
        <line x1="12" y1="7" x2="5" y2="17" /><line x1="12" y1="7" x2="19" y2="17" />
      </IconBtn>

      {/* AI 助手 */}
      <IconBtn onClick={onToggleAI} title="AI 助手 (Ctrl+J)" aria-label="AI 助手">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </IconBtn>
    </div>
  );
}

/** 通用图标按钮 */
function IconBtn({ onClick, title, children, "aria-label": ariaLabel }: {
  onClick: () => void; title: string; children: React.ReactNode; "aria-label": string;
}) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={ariaLabel}
      className="w-[36px] h-[36px] my-[1px] rounded-[8px] flex items-center justify-center
        cursor-pointer transition-all duration-150
        hover:bg-white/[0.06] active:scale-95"
      style={{ color: "var(--text-quaternary)" }}>
      <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}
