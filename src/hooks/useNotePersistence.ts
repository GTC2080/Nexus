import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SaveRequest {
  vaultPath: string;
  filePath: string;
  content: string;
  fingerprint: string;
}

interface UseNotePersistenceOptions {
  onError: (message: string) => void;
}

function hashContent(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${content.length}:${hash >>> 0}`;
}

export function useNotePersistence({ onError }: UseNotePersistenceOptions) {
  const pendingRef = useRef<SaveRequest | null>(null);
  const processingRef = useRef(false);
  const waitersRef = useRef<Array<() => void>>([]);
  const lastQueuedByFileRef = useRef(new Map<string, string>());
  const lastSavedByFileRef = useRef(new Map<string, string>());

  const resolveWaiters = useCallback(() => {
    const waiters = waitersRef.current.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  }, []);

  const processQueue = useCallback(async () => {
    if (processingRef.current) {
      return;
    }

    processingRef.current = true;

    try {
      while (pendingRef.current) {
        const next = pendingRef.current;
        pendingRef.current = null;

        const lastSaved = lastSavedByFileRef.current.get(next.filePath);
        if (lastSaved === next.fingerprint) {
          continue;
        }

        try {
          await invoke("write_note", {
            vaultPath: next.vaultPath,
            filePath: next.filePath,
            content: next.content,
          });
          lastSavedByFileRef.current.set(next.filePath, next.fingerprint);
          lastQueuedByFileRef.current.set(next.filePath, next.fingerprint);
        } catch (error) {
          onError(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      processingRef.current = false;
      resolveWaiters();
    }
  }, [onError, resolveWaiters]);

  const enqueueSave = useCallback((vaultPath: string, filePath: string, content: string) => {
    if (!vaultPath || !filePath) {
      return;
    }

    const fingerprint = hashContent(content);
    const lastQueued = lastQueuedByFileRef.current.get(filePath);
    const lastSaved = lastSavedByFileRef.current.get(filePath);
    if (lastQueued === fingerprint || lastSaved === fingerprint) {
      return;
    }

    lastQueuedByFileRef.current.set(filePath, fingerprint);
    pendingRef.current = {
      vaultPath,
      filePath,
      content,
      fingerprint,
    };
    void processQueue();
  }, [processQueue]);

  const flushPendingSave = useCallback(async () => {
    void processQueue();

    if (!processingRef.current && !pendingRef.current) {
      return;
    }

    await new Promise<void>(resolve => {
      waitersRef.current.push(resolve);
    });

    if (pendingRef.current || processingRef.current) {
      await flushPendingSave();
    }
  }, [processQueue]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void flushPendingSave();
      }
    };

    const handleBeforeUnload = () => {
      void flushPendingSave();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      void flushPendingSave();
    };
  }, [flushPendingSave]);

  return {
    enqueueSave,
    flushPendingSave,
  };
}
