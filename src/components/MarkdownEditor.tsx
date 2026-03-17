import { useState, useEffect, useCallback, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { migrateMathStrings } from "@tiptap/extension-mathematics";
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import "katex/dist/katex.min.css";
import { useDebounce } from "../hooks/useDebounce";
import { WikiLink } from "../editor/extensions/WikiLink";
import { TagHighlight } from "../editor/extensions/Tag";
import { createWikiLinkSuggestion } from "../editor/suggestion";
import { InlineMathWithMarkdown, BlockMathWithMarkdown, sharedKatexOptions } from "../editor/extensions/MathMarkdown";
import { DatabaseBlock } from "../editor/extensions/DatabaseNode";
import MathEditor from "./MathEditor";

/** Migrate block math strings: paragraphs containing $$...$$ to blockMath nodes */
function migrateBlockMathStrings(editor: Editor) {
  const { tr } = editor.state;
  const { blockMath } = editor.schema.nodes;
  if (!blockMath) return;

  let changed = false;
  editor.state.doc.descendants((node: PmNode, pos: number) => {
    if (!node.isTextblock) return;
    const text = node.textContent;
    const match = text.match(/^\$\$([\s\S]+?)\$\$\s*$/);
    if (!match) return;
    const latex = match[1].trim();
    if (!latex) return;
    const from = tr.mapping.map(pos);
    const to = tr.mapping.map(pos + node.nodeSize);
    tr.replaceWith(from, to, blockMath.create({ latex }));
    changed = true;
  });

  if (changed) {
    tr.setMeta("addToHistory", false);
    editor.view.dispatch(tr);
  }
}

interface MarkdownEditorProps {
  initialContent: string;
  onSave: (content: string) => void;
  onContentChange?: (content: string) => void;
  vaultPath: string;
  fontFamily?: string;
  enableScientific?: boolean;
}

export default function MarkdownEditor({
  initialContent,
  onSave,
  onContentChange,
  vaultPath,
  fontFamily,
  enableScientific = true,
}: MarkdownEditorProps) {
  const editorRef = useRef<Editor | null>(null);
  const [mathEdit, setMathEdit] = useState<{
    latex: string;
    isBlock: boolean;
    pos: number;
    rect: DOMRect | null;
  } | null>(null);

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
      Placeholder.configure({ placeholder: "开始书写…" }),
      Markdown,
      WikiLink.configure({
        suggestion: createWikiLinkSuggestion(vaultPath),
      }),
      TagHighlight,
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
          ]
        : []),
    ],
    content: initialContent,
    onCreate({ editor }) {
      if (!enableScientific) {
        return;
      }
      migrateBlockMathStrings(editor);
      migrateMathStrings(editor);
    },
    onUpdate({ editor }) {
      const md = (editor.storage as any).markdown?.getMarkdown?.() ?? "";
      onContentChange?.(md);
      debouncedSave(md);
    },
  });

  const debouncedSave = useDebounce((md: string) => {
    onSave(md);
  }, 400);

  // Keep ref in sync
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Sync external content changes
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = (editor.storage as any).markdown?.getMarkdown?.() ?? "";
    if (current !== initialContent) {
      editor.commands.setContent(initialContent);
      if (enableScientific) {
        migrateBlockMathStrings(editor);
        migrateMathStrings(editor);
      }
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

  if (!editor) return null;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Bubble Menu */}
      <BubbleMenu editor={editor} options={{ placement: "top" }}>
        <div
          className="glass-elevated glass-highlight rounded-[12px] flex items-center gap-0.5 px-1.5 py-1 animate-fade-in"
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.45)" }}
        >
          <Btn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} label="B" title="加粗" bold />
          <Btn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} label="I" title="斜体" italic />
          <Btn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} label="S" title="删除线" strike />
          <Btn active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} label="<>" title="代码" mono />
          <Sep />
          <Btn active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} label="H1" title="标题1" />
          <Btn active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="H2" title="标题2" />
          <Btn active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} label="H3" title="标题3" />
          <Sep />
          <Btn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} label="•" title="列表" />
          <Btn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="❝" title="引用" />
          <Btn active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} label="☑" title="待办" />
          <Sep />
          <Btn
            active={editor.isActive("databaseBlock")}
            onClick={() => editor.chain().focus().insertDatabaseBlock().run()}
            label="DB"
            title="插入数据库 (Ctrl/Cmd+Shift+D)"
            mono
          />
        </div>
      </BubbleMenu>

      {/* Editor */}
      <EditorContent
        editor={editor}
        className="flex-1 overflow-y-auto px-10 py-8"
        style={{
          fontFamily:
            fontFamily && fontFamily !== "System Default"
              ? fontFamily
              : undefined,
        }}
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
    </div>
  );
}

/** Separator for BubbleMenu */
function Sep() {
  return (
    <div
      className="w-px h-4 mx-0.5"
      style={{ background: "rgba(255,255,255,0.08)" }}
    />
  );
}

/** BubbleMenu button */
function Btn({
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
      className={`px-2 py-1 rounded-[8px] text-[12px] cursor-pointer transition-all duration-150 ${
        active
          ? "text-white"
          : "hover:bg-white/[0.06]"
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
}
