import { useEffect, useRef, useCallback, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { NoteInfo } from "../types";

interface FsChangeEvent {
  changed: string[];
  removed: string[];
}

interface UseFileWatcherOptions {
  vaultPath: string;
  ignoredFolders: string;
  setNotes: Dispatch<SetStateAction<NoteInfo[]>>;
}

/**
 * 文件系统增量监听 hook。
 *
 * 当 vault 打开时自动启动 Rust 端的文件监听器，
 * 收到 `vault:fs-change` 事件后增量更新 notes 列表：
 * - removed: 从列表中移除对应文件
 * - changed: 重新扫描获取最新元数据并 merge
 *
 * vault 关闭或切换时自动停止旧的监听器。
 */
export function useFileWatcher({
  vaultPath,
  ignoredFolders,
  setNotes,
}: UseFileWatcherOptions) {
  const vaultPathRef = useRef(vaultPath);
  vaultPathRef.current = vaultPath;

  // 增量处理：收到 fs-change 事件后只更新变动的文件
  const handleFsChange = useCallback(
    async (event: { payload: FsChangeEvent }) => {
      const { changed, removed } = event.payload;

      // 1. 立即移除已删除的文件（乐观更新）
      if (removed.length > 0) {
        const removedSet = new Set(
          removed.map((r) => r.replace(/\\/g, "/"))
        );
        setNotes((prev) =>
          prev.filter((n) => !removedSet.has(n.id.replace(/\\/g, "/")))
        );
      }

      // 2. 对变更的文件，调用 scan_vault 获取最新列表并 merge
      //    （scan_vault 是快速元数据扫描，不读内容）
      if (changed.length > 0 && vaultPathRef.current) {
        try {
          const freshNotes = await invoke<NoteInfo[]>("scan_vault", {
            vaultPath: vaultPathRef.current,
            ignoredFolders: ignoredFolders || "",
          });
          setNotes(freshNotes);

          // 同时触发后台内容索引（增量，只处理变更文件）
          invoke("index_vault_content", {
            vaultPath: vaultPathRef.current,
            ignoredFolders: ignoredFolders || "",
          }).catch((err: unknown) => {
            console.warn("[index_vault_content]", err);
          });
        } catch (err) {
          console.warn("[useFileWatcher] scan failed:", err);
        }
      }
    },
    [ignoredFolders, setNotes]
  );

  useEffect(() => {
    if (!vaultPath) return;

    let unlisten: UnlistenFn | null = null;
    let stopped = false;

    const setup = async () => {
      // 启动 Rust 端 watcher
      try {
        await invoke("start_watcher", {
          vaultPath,
          ignoredFolders: ignoredFolders || "",
        });
      } catch (err) {
        console.warn("[start_watcher]", err);
        return;
      }

      if (stopped) {
        // 如果在 await 期间已经 cleanup，立即停止
        invoke("stop_watcher").catch(() => {});
        return;
      }

      // 监听事件
      unlisten = await listen<FsChangeEvent>(
        "vault:fs-change",
        handleFsChange
      );
    };

    setup();

    return () => {
      stopped = true;
      unlisten?.();
      invoke("stop_watcher").catch(() => {});
    };
  }, [vaultPath, ignoredFolders, handleFsChange]);
}
