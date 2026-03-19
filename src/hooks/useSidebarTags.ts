import { useState, useEffect, useCallback, useMemo, useTransition } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { NoteInfo, TagInfo } from "../types";
import { buildTagTree } from "../components/sidebar/TagTree";

interface UseSidebarTagsOptions {
  vaultPath: string;
  notes: NoteInfo[];
  tab: "files" | "tags";
}

export function useSidebarTags({ vaultPath, notes, tab }: UseSidebarTagsOptions) {
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tagNotes, setTagNotes] = useState<NoteInfo[]>([]);
  const [tagNotesPending, startTagNotesTransition] = useTransition();

  const refreshTags = useCallback(async () => {
    try {
      const allTags = await invoke<TagInfo[]>("get_all_tags");
      setTags(allTags);
    } catch (e) {
      console.error("加载标签失败:", e);
    }
  }, []);

  useEffect(() => {
    if (!vaultPath || tab !== "tags") return;
    void refreshTags();
  }, [notes, vaultPath, tab, refreshTags]);

  const tagTree = useMemo(() => buildTagTree(tags), [tags]);

  const handleSelectTag = useCallback(async (tag: string) => {
    let nextTag: string | null = null;
    setSelectedTag(prev => {
      nextTag = prev === tag ? null : tag;
      return nextTag;
    });

    if (!nextTag) {
      setTagNotes([]);
      return;
    }

    startTagNotesTransition(async () => {
      try {
        const result = await invoke<NoteInfo[]>("get_notes_by_tag", { tag: nextTag });
        setTagNotes(result);
      } catch (e) {
        console.error("按标签查询笔记失败:", e);
        setTagNotes([]);
      }
    });
  }, []);

  return {
    tags,
    tagTree,
    selectedTag,
    tagNotes,
    tagNotesPending,
    handleSelectTag,
  };
}
