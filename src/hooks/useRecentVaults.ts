import { useCallback, useEffect, useState } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { RecentVault } from "../types/vault";

const vaultStore = new LazyStore("vaults.json");

export function useRecentVaults() {
  const [recentVaults, setRecentVaults] = useState<RecentVault[]>([]);

  useEffect(() => {
    vaultStore.get<RecentVault[]>("recentVaults").then(list => {
      if (list) setRecentVaults(list);
    }).catch(() => {});
  }, []);

  const saveToRecent = useCallback(async (path: string) => {
    const name = path.split(/[/\\]/).pop() || "Vault";
    let updated: RecentVault[] = [];
    setRecentVaults(prev => {
      const entry: RecentVault = { name, path, openedAt: Date.now() };
      updated = [entry, ...prev.filter(v => v.path !== path)].slice(0, 10);
      return updated;
    });
    await vaultStore.set("recentVaults", updated);
    await vaultStore.save();
  }, []);

  return { recentVaults, saveToRecent };
}
