import logoSvg from "../../assets/logo.svg";
import type { RecentVault } from "../../types/vault";

interface VaultManagerViewProps {
  recentVaults: RecentVault[];
  onOpenRecent: (path: string) => void | Promise<void>;
  onOpenVault: () => void | Promise<void>;
  onOpenSettings: () => void;
}

export default function VaultManagerView({
  recentVaults,
  onOpenRecent,
  onOpenVault,
  onOpenSettings,
}: VaultManagerViewProps) {
  return (
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
          </div>
        </div>
      </main>
    </div>
  );
}
