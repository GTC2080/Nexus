import { memo, useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import "katex/dist/katex.min.css";
import { useDebounce } from "../hooks/useDebounce";
import { WikiLink } from "../editor/extensions/WikiLink";
import { TagHighlight } from "../editor/extensions/Tag";
import { createWikiLinkSuggestion } from "../editor/suggestion";
import { InlineMathWithMarkdown, BlockMathWithMarkdown, sharedKatexOptions } from "../editor/extensions/MathMarkdown";
import { DatabaseBlock } from "../editor/extensions/DatabaseNode";
import { StoichiometryBlock } from "../editor/extensions/StoichiometryNode";
import { ChemDrawCommand } from "../editor/extensions/ChemDrawCommand";
import { applyEditorContentSafely } from "./markdown-editor/editorContentUtils";
import MarkdownContextMenu, { type ContextMenuPosition } from "./markdown-editor/MarkdownContextMenu";
import MathEditor from "./MathEditor";
import type { DisciplineProfile } from "./settings/settingsTypes";
import { useT } from "../i18n";

const ChemDrawModal = lazy(() => import("./chem-editor/ChemDrawModal"));

interface MarkdownEditorProps {
  initialContent: string;
  onSave: (content: string) => void;
  onContentChange?: (content: string) => void;
  vaultPath: string;
  fontFamily?: string;
  enableScientific?: boolean;
  activeDiscipline?: DisciplineProfile;
}

export default function MarkdownEditor({
  initialContent,
  onSave,
  onContentChange,
  vaultPath,
  fontFamily,
  enableScientific = true,
  activeDiscipline = "chemistry",
}: MarkdownEditorProps) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const editorRef = useRef<Editor | null>(null);
  const editorSurfaceRef = useRef<HTMLDivElement | null>(null);
  const [mathEdit, setMathEdit] = useState<{
    latex: string;
    isBlock: boolean;
    pos: number;
    rect: DOMRect | null;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);
  const [chemModalOpen, setChemModalOpen] = useState(false);
  const debouncedSave = useDebounce((md: string) => {
    onSave(md);
  }, 400);

  // Listen for activity bar "Insert into Note" trigger
  useEffect(() => {
    const handler = () => setChemModalOpen(true);
    window.addEventListener("open-chemdraw-modal", handler);
    return () => window.removeEventListener("open-chemdraw-modal", handler);
  }, []);

  const openContextMenu = useCallback((x: number, y: number) => {
    const menuWidth = 176;
    const menuHeight = 228;
    setContextMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
    });
  }, []);

  const handleMathClick = useCallback(
    (node: PmNode, pos: number, isBlock: boolean) => {
      // Find the DOM node for this position to get its bounding rect
      const ed = editorRef.current;
      let rect: DOMRect | null = null;
      if (ed) {
        try {
          const dom = ed.view.nodeDOM(pos);
          if (dom instanceof HTMLElement) {
            rect = dom.getBoundingClientRect();
          }
        } catch { /* fallback: no rect */ }
      }
      setMathEdit({ latex: node.attrs.latex ?? "", isBlock, pos, rect });
    },
    [],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: { HTMLAttributes: { class: "hljs" } } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: "md-table",
        },
      }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: () => tRef.current("editor.placeholder") }),
      Markdown.configure({
        transformPastedText: true,
        transformCopiedText: true,
      }),
      WikiLink.configure({
        suggestion: createWikiLinkSuggestion(vaultPath),
      }),
      TagHighlight,
      ChemDrawCommand,
      ...(enableScientific
        ? [
            InlineMathWithMarkdown.configure({
              katexOptions: sharedKatexOptions,
              onClick: (node: PmNode, pos: number) => handleMathClick(node, pos, false),
            }),
            BlockMathWithMarkdown.configure({
              katexOptions: sharedKatexOptions,
              onClick: (node: PmNode, pos: number) => handleMathClick(node, pos, true),
            }),
            DatabaseBlock,
            ...(activeDiscipline === "chemistry" ? [StoichiometryBlock] : []),
          ]
        : []),
    ],
    content: "",
    onCreate({ editor }) {
      applyEditorContentSafely(editor, initialContent, enableScientific);
    },
    onUpdate({ editor }) {
      const md = (editor.storage as any).markdown?.getMarkdown?.() ?? "";
      onContentChange?.(md);
      debouncedSave(md);
    },
  });

  // Keep ref in sync
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // NOTE: "open-chemdraw-modal" listener already registered above (line 69-73)

  // Sync external content changes
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = (editor.storage as any).markdown?.getMarkdown?.() ?? "";
    if (current !== initialContent) {
      applyEditorContentSafely(editor, initialContent, enableScientific);
    }
  }, [initialContent, editor, enableScientific]);

  const handleMathConfirm = useCallback(
    (newLatex: string) => {
      if (!editor || !mathEdit) return;
      const { pos, isBlock } = mathEdit;
      const nodeType = isBlock
        ? editor.schema.nodes.blockMath
        : editor.schema.nodes.inlineMath;
      if (!nodeType) return;
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.replaceWith(pos, pos + 1, nodeType.create({ latex: newLatex }));
          return true;
        })
        .run();
      setMathEdit(null);
    },
    [editor, mathEdit],
  );

  const insertSmiles = useCallback((smiles: string) => {
    editor?.chain().focus()
      .insertContent("```smiles\n" + smiles + "\n```\n")
      .run();
    setChemModalOpen(false);
  }, [editor]);

  useEffect(() => {
    const surface = editorSurfaceRef.current;
    if (!surface) return;

    const handleNativeContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(event.clientX, event.clientY);
    };

    surface.addEventListener("contextmenu", handleNativeContextMenu, true);

    return () => {
      surface.removeEventListener("contextmenu", handleNativeContextMenu, true);
    };
  }, [openContextMenu]);

  if (!editor) return null;

  return (
    <div className="relative flex-1 flex flex-col h-full overflow-hidden">
      {/* Bubble Menu */}
      <BubbleMenu editor={editor} options={{ placement: "top" }}>
        <div
          className="glass-elevated glass-highlight rounded-[12px] flex items-center gap-0.5 px-1.5 py-1 animate-fade-in"
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.45)" }}
        >
          <Btn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} label="B" title={t("editor.bold")} bold />
          <Btn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} label="I" title={t("editor.italic")} italic />
          <Btn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} label="S" title={t("editor.strikethrough")} strike />
          <Btn active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} label="<>" title={t("editor.code")} mono />
          <Sep />
          <Btn active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} label="H1" title={t("editor.h1")} />
          <Btn active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="H2" title={t("editor.h2")} />
          <Btn active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} label="H3" title={t("editor.h3")} />
          <Sep />
          <Btn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} label="•" title={t("editor.list")} />
          <Btn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="❝" title={t("editor.quote")} />
          <Btn active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} label="☑" title={t("editor.todo")} />
          <Sep />
          <Btn
            active={editor.isActive("databaseBlock")}
            onClick={() => editor.chain().focus().insertDatabaseBlock().run()}
            label="DB"
            title={t("editor.insertDb")}
            mono
          />
          {activeDiscipline === "chemistry" && (
            <Btn
              active={editor.isActive("stoichiometryBlock")}
              onClick={() => editor.chain().focus().insertStoichiometryBlock().run()}
              label="ST"
              title={t("editor.insertStoich")}
              mono
            />
          )}
        </div>
      </BubbleMenu>

      {/* Editor */}
      <div
        ref={editorSurfaceRef}
        className="flex-1 overflow-y-auto"
      >
        <EditorContent
          editor={editor}
          className="prose-editor h-full min-h-full px-8 py-8"
          style={{
            fontFamily:
              fontFamily && fontFamily !== "System Default"
                ? fontFamily
                : undefined,
          }}
        />
      </div>

      <MarkdownContextMenu
        editor={editor}
        position={contextMenu}
        activeDiscipline={activeDiscipline}
        onClose={() => setContextMenu(null)}
      />

      {/* Math Editor Overlay */}
      {mathEdit && (
        <MathEditor
          latex={mathEdit.latex}
          isBlock={mathEdit.isBlock}
          anchorRect={mathEdit.rect}
          onConfirm={handleMathConfirm}
          onClose={() => setMathEdit(null)}
        />
      )}

      {/* ChemDraw Modal (lazy) */}
      <Suspense fallback={null}>
        {chemModalOpen && (
          <ChemDrawModal
            open={chemModalOpen}
            onClose={() => setChemModalOpen(false)}
            onConfirm={insertSmiles}
          />
        )}
      </Suspense>
    </div>
  );
}

/** Separator for BubbleMenu */
function Sep() {
  return (
    <div
      className="w-px h-4 mx-0.5"
      style={{ background: "var(--separator-light)" }}
    />
  );
}

/** BubbleMenu button */
const Btn = memo(function Btn({
  active,
  onClick,
  label,
  title,
  bold,
  italic,
  strike,
  mono,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  mono?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-2 py-1 rounded-[8px] text-[12px] cursor-pointer transition-colors duration-150 ${
        active
          ? "text-white"
          : "hover:bg-[var(--sidebar-hover)]"
      }`}
      style={{
        background: active ? "var(--accent)" : "transparent",
        color: active ? "#fff" : "var(--text-secondary)",
        fontWeight: bold ? 700 : undefined,
        fontStyle: italic ? "italic" : undefined,
        textDecoration: strike ? "line-through" : undefined,
        fontFamily: mono
          ? '"SF Mono", "Fira Code", Consolas, monospace'
          : undefined,
      }}
    >
      {label}
    </button>
  );
});

