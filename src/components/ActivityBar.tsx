import logoSvg from "../assets/logo.svg";

interface ActivityBarProps {
  onOpenSearch: () => void;
  onOpenGraph: () => void;
  onToggleAI: () => void;
  onCreateCanvas: () => void;
  onBackToManager: () => void;
  activePanel: string;
}

/** 最左侧窄图标条 — 参考 Obsidian / VS Code Activity Bar */
export default function ActivityBar({
  onOpenSearch, onOpenGraph, onToggleAI, onCreateCanvas, onBackToManager, activePanel: _,
}: ActivityBarProps) {
  return (
    <div className="w-[42px] shrink-0 flex flex-col items-center select-none app-chrome"
      style={{
        borderRight: "0.5px solid var(--chrome-border)",
      }}>
      {/* Logo / 返回首页 */}
      <button type="button" onClick={onBackToManager}
        className="w-full h-[42px] flex items-center justify-center cursor-pointer
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

      {/* 新建画布 */}
      <IconBtn onClick={onCreateCanvas} title="新建画布" aria-label="新建画布">
        <rect x="4" y="4" width="4" height="4" rx="0.6" />
        <rect x="16" y="4" width="4" height="4" rx="0.6" />
        <rect x="4" y="16" width="4" height="4" rx="0.6" />
        <rect x="16" y="16" width="4" height="4" rx="0.6" />
        <line x1="8" y1="6" x2="16" y2="6" />
        <line x1="6" y1="8" x2="6" y2="16" />
        <line x1="18" y1="8" x2="18" y2="16" />
        <line x1="8" y1="18" x2="16" y2="18" />
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
      className="w-[32px] h-[32px] my-[2px] rounded-[6px] flex items-center justify-center
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
