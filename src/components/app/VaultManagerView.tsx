import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import logoSvg from "../../assets/logo.svg";
import type { RecentVault } from "../../types/vault";

const RECENT_MENU_WIDTH = 196;
const RECENT_MENU_MAX_HEIGHT = 120;

interface RecentVaultContextMenuState {
  x: number;
  y: number;
  vault: RecentVault;
}

interface VaultManagerViewProps {
  recentVaults: RecentVault[];
  onOpenRecent: (path: string) => void | Promise<void>;
  onRemoveRecent: (path: string) => void | Promise<void>;
  onOpenVault: () => void | Promise<void>;
  onOpenSettings: () => void;
  onOpenTruth: () => void;
}

export default function VaultManagerView({
  recentVaults,
  onOpenRecent,
  onRemoveRecent,
  onOpenVault,
  onOpenSettings,
  onOpenTruth,
}: VaultManagerViewProps) {
  const [contextMenu, setContextMenu] = useState<RecentVaultContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const handlePointerDownCapture = (e: Event) => {
      const menuEl = contextMenuRef.current;
      if (!menuEl) {
        close();
        return;
      }
      if (!menuEl.contains(e.target as Node)) {
        close();
      }
    };
    const handleContextMenuCapture = (e: Event) => {
      const menuEl = contextMenuRef.current;
      if (!menuEl) {
        close();
        return;
      }
      if (!menuEl.contains(e.target as Node)) {
        close();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const handleScroll = () => close();

    document.addEventListener("pointerdown", handlePointerDownCapture, true);
    document.addEventListener("contextmenu", handleContextMenuCapture, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("wheel", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDownCapture, true);
      document.removeEventListener("contextmenu", handleContextMenuCapture, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("wheel", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [contextMenu]);

  const handleRecentContextMenu = useCallback((e: ReactMouseEvent<HTMLButtonElement>, vault: RecentVault) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      vault,
    });
  }, []);

  const handleRemoveRecent = useCallback((vault: RecentVault) => {
    const ok = window.confirm(`确认从近期列表移除「${vault.name}」？`);
    if (!ok) return;
    void onRemoveRecent(vault.path);
    setContextMenu(null);
  }, [onRemoveRecent]);

  return (
    <>
      <div className="flex flex-1 min-h-0">
      <aside
        className="w-64 flex flex-col select-none shrink-0"
        style={{ background: "var(--sidebar-bg)", borderRight: "0.5px solid var(--separator-light)" }}
      >
        <div className="px-4 pt-5 pb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-quaternary)]">
            近期知识库
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {recentVaults.length === 0 ? (
            <div className="px-4 py-8">
              <p className="text-[12px] leading-relaxed text-[var(--text-quaternary)]">
                打开一个知识库后，<br />它会出现在这里
              </p>
            </div>
          ) : (
            recentVaults.map(vault => (
              <button
                key={vault.path}
                type="button"
                onClick={() => { void onOpenRecent(vault.path); }}
                onContextMenu={e => {
                  handleRecentContextMenu(e, vault);
                }}
                className="w-full text-left px-4 py-3 cursor-pointer transition-colors duration-150
                  hover:bg-[var(--sidebar-hover)] flex flex-col gap-1 border-l-2 border-l-transparent hover:border-l-[var(--accent)]"
              >
                <span className="text-[13px] font-medium text-[var(--text-secondary)]">
                  {vault.name}
                </span>
                <span className="text-[11px] truncate block text-[var(--text-quaternary)]">
                  {vault.path}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col items-center justify-center px-8 bg-[var(--surface-1)]">
        <div className="max-w-xl w-full animate-fade-in">
          <div className="flex flex-col items-center mb-10">
            <img src={logoSvg} alt="Nexus" className="w-20 h-20 rounded-[18px] mb-4" />
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">
              Nexus
            </h1>
            <span className="text-[12px] mt-1 text-[var(--text-quaternary)]">
              版本 0.1.0
            </span>
          </div>

          <div className="flex flex-col gap-3 w-full">
            <div className="flex justify-between items-center p-4 rounded-xl transition-colors duration-150
              hover:bg-[var(--sidebar-hover)] bg-[var(--subtle-surface)] border-[0.5px] border-[var(--separator-light)]">
              <div>
                <p className="text-[14px] font-medium text-[var(--text-secondary)]">
                  打开本地知识库
                </p>
                <p className="text-[12px] mt-1 text-[var(--text-quaternary)]">
                  将一个本地文件夹作为知识库打开
                </p>
              </div>
              <button
                type="button"
                onClick={() => { void onOpenVault(); }}
                className="px-5 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer
                  transition-colors duration-150 shrink-0 ml-4
                  bg-[var(--accent)] text-white shadow-[0_1px_4px_rgba(10,132,255,0.25)]"
              >
                打开
              </button>
            </div>

            <div className="flex justify-between items-center p-4 rounded-xl transition-colors duration-150
              hover:bg-[var(--sidebar-hover)] bg-[var(--subtle-surface)] border-[0.5px] border-[var(--separator-light)]">
              <div>
                <p className="text-[14px] font-medium text-[var(--text-secondary)]">
                  新建知识库
                </p>
                <p className="text-[12px] mt-1 text-[var(--text-quaternary)]">
                  在指定文件夹下创建一个新的知识库
                </p>
              </div>
              <button
                type="button"
                onClick={() => { void onOpenVault(); }}
                className="px-5 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer
                  transition-colors duration-150 shrink-0 ml-4
                  hover:bg-[var(--surface-3)] bg-[var(--subtle-surface-strong)] text-[var(--text-secondary)] border-[0.5px] border-[var(--separator-light)]"
              >
                创建
              </button>
            </div>

            <div className="flex justify-between items-center p-4 rounded-xl transition-colors duration-150
              hover:bg-[var(--sidebar-hover)] bg-[var(--subtle-surface)] border-[0.5px] border-[var(--separator-light)]">
              <div>
                <p className="text-[14px] font-medium text-[var(--text-secondary)]">
                  系统设置
                </p>
                <p className="text-[12px] mt-1 text-[var(--text-quaternary)]">
                  调整 AI 模型参数与全局偏好
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenSettings}
                className="px-5 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer
                  transition-colors duration-150 shrink-0 ml-4
                  hover:bg-[var(--surface-3)] bg-[var(--subtle-surface-strong)] text-[var(--text-secondary)] border-[0.5px] border-[var(--separator-light)]"
              >
                设置
              </button>
            </div>

            <div className="flex justify-between items-center p-4 rounded-xl transition-colors duration-150
              hover:bg-[var(--sidebar-hover)] bg-[var(--subtle-surface)] border-[0.5px] border-[var(--separator-light)]">
              <div>
                <p className="text-[14px] font-medium text-[var(--text-secondary)]">
                  TRUTH_SYSTEM 看板
                </p>
                <p className="text-[12px] mt-1 text-[var(--text-quaternary)]">
                  查看成长等级、属性雷达与经验进度
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenTruth}
                className="px-5 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer
                  transition-colors duration-150 shrink-0 ml-4
                  hover:bg-[var(--surface-3)] bg-[var(--subtle-surface-strong)] text-[var(--text-secondary)] border-[0.5px] border-[var(--separator-light)]"
              >
                打开
              </button>
            </div>
          </div>
        </div>
      </main>
      </div>

      {contextMenu && createPortal(
        <>
          <div
            className="fixed inset-0 z-[9999]"
            style={{ background: "transparent" }}
            onPointerDown={() => setContextMenu(null)}
            onContextMenu={e => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            ref={contextMenuRef}
            className="fixed z-[10000] w-[196px] rounded-lg p-1"
            style={{
              left: `${Math.max(8, Math.min(contextMenu.x, window.innerWidth - RECENT_MENU_WIDTH))}px`,
              top: `${Math.max(8, Math.min(contextMenu.y, window.innerHeight - RECENT_MENU_MAX_HEIGHT))}px`,
              background: "var(--menu-bg)",
              border: "1px solid var(--separator-light)",
              boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
            }}
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] leading-5 transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--menu-hover)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              onClick={() => {
                void onOpenRecent(contextMenu.vault.path);
                setContextMenu(null);
              }}
            >
              打开知识库
            </button>
            <div className="my-1 h-px" style={{ background: "var(--separator-light)" }} />
            <button
              type="button"
              className="w-full text-left px-2.5 py-1.5 rounded-md text-[12px] leading-5 transition-colors"
              style={{ color: "rgba(255,75,75,0.95)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--menu-hover)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              onClick={() => {
                handleRemoveRecent(contextMenu.vault);
              }}
            >
              从近期列表删除
            </button>
          </div>
        </>,
        document.body
      )}
    </>
  );
}
