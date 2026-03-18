import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import type { DisciplineProfile } from "../settings/settingsTypes";

export interface ContextMenuPosition {
  x: number;
  y: number;
}

type ContextSubmenu = "paragraph" | "insert" | null;
type EditorAction = "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll" | "delete";
type FormatAction = "bold" | "italic" | "code" | "blockquote" | "bulletList" | "orderedList" | "taskList";
type ParagraphAction = "paragraph" | "h1" | "h2" | "h3" | "blockquote" | "codeBlock" | "bulletList" | "orderedList" | "taskList";
type InsertAction = "hr" | "codeFence" | "link" | "wikiLink" | "table" | "inlineMath" | "blockMath" | "database" | "stoichiometry";

interface MarkdownContextMenuProps {
  editor: Editor;
  position: ContextMenuPosition | null;
  activeDiscipline: DisciplineProfile;
  onClose: () => void;
}

const VIEWPORT_PADDING = 8;
const SUBMENU_GAP = 8;
const PARAGRAPH_SUBMENU_TOP = 142;
const INSERT_SUBMENU_TOP = 174;
const PARAGRAPH_SUBMENU_HEIGHT = 292;
const INSERT_SUBMENU_HEIGHT = 292;
const SUBMENU_WIDTH = 196;

export default function MarkdownContextMenu({
  editor,
  position,
  activeDiscipline,
  onClose,
}: MarkdownContextMenuProps) {
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [contextSubmenu, setContextSubmenu] = useState<ContextSubmenu>(null);
  const [resolvedPosition, setResolvedPosition] = useState<ContextMenuPosition | null>(position);

  useEffect(() => {
    setResolvedPosition(position);
  }, [position]);

  const closeMenu = useCallback(() => {
    setContextSubmenu(null);
    onClose();
  }, [onClose]);

  const runEditorContextAction = useCallback(
    async (action: EditorAction) => {
      closeMenu();
      editor.commands.focus();
      switch (action) {
        case "undo":
          editor.chain().focus().undo().run();
          break;
        case "redo":
          editor.chain().focus().redo().run();
          break;
        case "cut":
          document.execCommand("cut");
          break;
        case "copy":
          document.execCommand("copy");
          break;
        case "paste":
          try {
            const text = await navigator.clipboard.readText();
            if (text) {
              editor.chain().focus().insertContent(text).run();
            }
          } catch {
            document.execCommand("paste");
          }
          break;
        case "selectAll":
          editor.chain().focus().selectAll().run();
          break;
        case "delete":
          editor.chain().focus().deleteSelection().run();
          break;
      }
    },
    [editor, closeMenu],
  );

  const runFormatAction = useCallback((action: FormatAction) => {
    closeMenu();
    const chain = editor.chain().focus();
    switch (action) {
      case "bold":
        chain.toggleBold().run();
        break;
      case "italic":
        chain.toggleItalic().run();
        break;
      case "code":
        chain.toggleCode().run();
        break;
      case "blockquote":
        chain.toggleBlockquote().run();
        break;
      case "bulletList":
        chain.toggleBulletList().run();
        break;
      case "orderedList":
        chain.toggleOrderedList().run();
        break;
      case "taskList":
        chain.toggleTaskList().run();
        break;
    }
  }, [editor, closeMenu]);

  const runParagraphAction = useCallback((action: ParagraphAction) => {
    closeMenu();
    const chain = editor.chain().focus();
    switch (action) {
      case "paragraph":
        chain.setParagraph().run();
        break;
      case "h1":
        chain.toggleHeading({ level: 1 }).run();
        break;
      case "h2":
        chain.toggleHeading({ level: 2 }).run();
        break;
      case "h3":
        chain.toggleHeading({ level: 3 }).run();
        break;
      case "blockquote":
        chain.toggleBlockquote().run();
        break;
      case "codeBlock":
        chain.toggleCodeBlock().run();
        break;
      case "bulletList":
        chain.toggleBulletList().run();
        break;
      case "orderedList":
        chain.toggleOrderedList().run();
        break;
      case "taskList":
        chain.toggleTaskList().run();
        break;
    }
  }, [editor, closeMenu]);

  const runInsertAction = useCallback((action: InsertAction) => {
    closeMenu();
    editor.commands.focus();

    const selectedText = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, "\n");

    switch (action) {
      case "hr":
        editor.chain().focus().setHorizontalRule().run();
        break;
      case "codeFence":
        editor.chain().focus().insertContent("```text\n\n```").run();
        break;
      case "link":
        editor.chain().focus().insertContent(selectedText ? `[${selectedText}](https://)` : "[link text](https://)").run();
        break;
      case "wikiLink":
        editor.chain().focus().insertContent(selectedText ? `[[${selectedText}]]` : "[[]]").run();
        break;
      case "table":
        editor.chain().focus().insertContent("| Column 1 | Column 2 |\n| --- | --- |\n| Value 1 | Value 2 |").run();
        break;
      case "inlineMath":
        editor.chain().focus().insertContent(selectedText ? `$${selectedText}$` : "$x$").run();
        break;
      case "blockMath":
        editor.chain().focus().insertContent("$$\n\n$$").run();
        break;
      case "database":
        editor.chain().focus().insertDatabaseBlock().run();
        break;
      case "stoichiometry":
        if (activeDiscipline === "chemistry") {
          editor.chain().focus().insertStoichiometryBlock().run();
        }
        break;
    }
  }, [editor, closeMenu, activeDiscipline]);

  useEffect(() => {
    if (!position) return;

    const handlePointerDown = (event: PointerEvent) => {
      const menuEl = contextMenuRef.current;
      if (!menuEl || !menuEl.contains(event.target as Node)) {
        closeMenu();
      }
    };

    const handleWindowContextMenu = (event: MouseEvent) => {
      const menuEl = contextMenuRef.current;
      if (!menuEl || !menuEl.contains(event.target as Node)) {
        closeMenu();
      } else {
        event.preventDefault();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("contextmenu", handleWindowContextMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("contextmenu", handleWindowContextMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [position, closeMenu]);

  useLayoutEffect(() => {
    if (!resolvedPosition) return;

    const menuEl = contextMenuRef.current;
    if (!menuEl) return;

    const rect = menuEl.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - VIEWPORT_PADDING;
    const maxY = window.innerHeight - rect.height - VIEWPORT_PADDING;
    const nextX = Math.max(VIEWPORT_PADDING, Math.min(resolvedPosition.x, maxX));
    const nextY = Math.max(VIEWPORT_PADDING, Math.min(resolvedPosition.y, maxY));

    if (nextX !== resolvedPosition.x || nextY !== resolvedPosition.y) {
      setResolvedPosition({ x: nextX, y: nextY });
    }
  }, [resolvedPosition, contextSubmenu]);

  const getSubmenuStyle = useCallback((baseTop: number, submenuHeight: number) => {
    const menuRect = contextMenuRef.current?.getBoundingClientRect();
    const menuWidth = menuRect?.width ?? 244;
    const menuTop = resolvedPosition?.y ?? 0;
    const menuLeft = resolvedPosition?.x ?? 0;

    const openToLeft = menuLeft + menuWidth + SUBMENU_GAP + SUBMENU_WIDTH > window.innerWidth - VIEWPORT_PADDING;
    const left = openToLeft ? -(SUBMENU_WIDTH + SUBMENU_GAP) : menuWidth + SUBMENU_GAP;
    const minTop = VIEWPORT_PADDING - menuTop;
    const maxTop = window.innerHeight - submenuHeight - VIEWPORT_PADDING - menuTop;
    const top = Math.max(minTop, Math.min(baseTop, maxTop));

    return { left: `${left}px`, top: `${top}px` };
  }, [resolvedPosition]);

  if (!resolvedPosition) return null;

  return createPortal(
    <div className="fixed z-[999]" style={{ left: `${resolvedPosition.x}px`, top: `${resolvedPosition.y}px` }}>
      <div
        ref={contextMenuRef}
        className="relative min-w-[244px] rounded-xl border border-[#343434] bg-[rgba(18,18,18,0.96)] p-2 shadow-2xl backdrop-blur-xl"
        onMouseLeave={() => setContextSubmenu(null)}
      >
        <div className="grid grid-cols-4 gap-1">
          <ContextIconButton label="剪切" title="剪切" onClick={() => { void runEditorContextAction("cut"); }}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <line x1="20" y1="4" x2="8.12" y2="15.88" />
              <line x1="14.47" y1="14.48" x2="20" y2="20" />
              <line x1="8.12" y1="8.12" x2="12" y2="12" />
            </svg>
          </ContextIconButton>
          <ContextIconButton label="复制" title="复制" onClick={() => { void runEditorContextAction("copy"); }}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
          </ContextIconButton>
          <ContextIconButton label="粘贴" title="粘贴" onClick={() => { void runEditorContextAction("paste"); }}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 4h8" />
              <rect x="6" y="2" width="12" height="20" rx="2" />
              <path d="M9 12h6M9 16h6M10 7h4" />
            </svg>
          </ContextIconButton>
          <ContextIconButton label="删除" title="删除" onClick={() => { void runEditorContextAction("delete"); }}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </ContextIconButton>
        </div>

        <div className="my-2 h-px bg-[#2A2A2A]" />

        <div className="grid grid-cols-4 gap-1">
          <ContextFormatButton label="B" active={editor.isActive("bold")} onClick={() => runFormatAction("bold")} />
          <ContextFormatButton label="I" active={editor.isActive("italic")} onClick={() => runFormatAction("italic")} italic />
          <ContextFormatButton label="<>" active={editor.isActive("code")} onClick={() => runFormatAction("code")} mono />
          <ContextFormatButton label="链" onClick={() => runInsertAction("link")} />
          <ContextFormatButton label="❝" active={editor.isActive("blockquote")} onClick={() => runFormatAction("blockquote")} />
          <ContextFormatButton label="•" active={editor.isActive("bulletList")} onClick={() => runFormatAction("bulletList")} />
          <ContextFormatButton label="1." active={editor.isActive("orderedList")} onClick={() => runFormatAction("orderedList")} />
          <ContextFormatButton label="☑" active={editor.isActive("taskList")} onClick={() => runFormatAction("taskList")} />
        </div>

        <div className="my-2 h-px bg-[#2A2A2A]" />

        <ContextMenuButton label="撤销" disabled={!editor.can().undo()} onClick={() => { void runEditorContextAction("undo"); }} />
        <ContextMenuButton label="重做" disabled={!editor.can().redo()} onClick={() => { void runEditorContextAction("redo"); }} />
        <ContextMenuButton label="全选" onClick={() => { void runEditorContextAction("selectAll"); }} />
        <ContextSubmenuButton label="段落" active={contextSubmenu === "paragraph"} onHover={() => setContextSubmenu("paragraph")} />
        <ContextSubmenuButton label="插入" active={contextSubmenu === "insert"} onHover={() => setContextSubmenu("insert")} />

        {contextSubmenu === "paragraph" && (
          <div
            className="absolute min-w-[180px] rounded-xl border border-[#343434] bg-[rgba(18,18,18,0.98)] p-1.5 shadow-2xl"
            style={getSubmenuStyle(PARAGRAPH_SUBMENU_TOP, PARAGRAPH_SUBMENU_HEIGHT)}
          >
            <ContextMenuButton label="正文" onClick={() => runParagraphAction("paragraph")} />
            <ContextMenuButton label="标题 1" onClick={() => runParagraphAction("h1")} />
            <ContextMenuButton label="标题 2" onClick={() => runParagraphAction("h2")} />
            <ContextMenuButton label="标题 3" onClick={() => runParagraphAction("h3")} />
            <ContextMenuButton label="引用块" onClick={() => runParagraphAction("blockquote")} />
            <ContextMenuButton label="代码块" onClick={() => runParagraphAction("codeBlock")} />
            <ContextMenuButton label="无序列表" onClick={() => runParagraphAction("bulletList")} />
            <ContextMenuButton label="有序列表" onClick={() => runParagraphAction("orderedList")} />
            <ContextMenuButton label="任务列表" onClick={() => runParagraphAction("taskList")} />
          </div>
        )}

        {contextSubmenu === "insert" && (
          <div
            className="absolute min-w-[196px] rounded-xl border border-[#343434] bg-[rgba(18,18,18,0.98)] p-1.5 shadow-2xl"
            style={getSubmenuStyle(INSERT_SUBMENU_TOP, INSERT_SUBMENU_HEIGHT)}
          >
            <ContextMenuButton label="水平分割线" onClick={() => runInsertAction("hr")} />
            <ContextMenuButton label="代码块模板" onClick={() => runInsertAction("codeFence")} />
            <ContextMenuButton label="Markdown 链接" onClick={() => runInsertAction("link")} />
            <ContextMenuButton label="Wiki 链接" onClick={() => runInsertAction("wikiLink")} />
            <ContextMenuButton label="表格" onClick={() => runInsertAction("table")} />
            <ContextMenuButton label="行内公式" onClick={() => runInsertAction("inlineMath")} />
            <ContextMenuButton label="块公式" onClick={() => runInsertAction("blockMath")} />
            <ContextMenuButton label="数据库" onClick={() => runInsertAction("database")} />
            {activeDiscipline === "chemistry" && (
              <ContextMenuButton label="计量矩阵" onClick={() => runInsertAction("stoichiometry")} />
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ContextMenuButton({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded px-2 py-1.5 text-left text-[12px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ color: "#D8D8D8" }}
      onMouseEnter={e => {
        if (!disabled) {
          e.currentTarget.style.background = "#1F1F1F";
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {label}
    </button>
  );
}

function ContextIconButton({
  label,
  title,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ color: "#D8D8D8" }}
      onMouseEnter={e => {
        if (!disabled) {
          e.currentTarget.style.background = "#1A1A1A";
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
      <span className="leading-none">{label}</span>
    </button>
  );
}

function ContextFormatButton({
  label,
  onClick,
  active = false,
  italic = false,
  mono = false,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  italic?: boolean;
  mono?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-8 rounded-lg border text-[12px] transition-colors"
      style={{
        color: active ? "#EDEDED" : "#B4B4B4",
        borderColor: active ? "#3B82F6" : "#2A2A2A",
        background: active ? "rgba(59,130,246,0.18)" : "#151515",
        fontStyle: italic ? "italic" : undefined,
        fontFamily: mono ? '"SF Mono", "Fira Code", Consolas, monospace' : undefined,
      }}
    >
      {label}
    </button>
  );
}

function ContextSubmenuButton({
  label,
  active,
  onHover,
}: {
  label: string;
  active: boolean;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onClick={onHover}
      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[12px] transition-colors"
      style={{
        color: "#D8D8D8",
        background: active ? "#1F1F1F" : "transparent",
      }}
    >
      <span>{label}</span>
      <span className="text-[#6F6F6F]">›</span>
    </button>
  );
}
