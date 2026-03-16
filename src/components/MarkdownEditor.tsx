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
import { InlineMathWithMarkdown, BlockMathWithMarkdown } from "../editor/extensions/MathMarkdown";
import MathEditor from "./MathEditor";

/** Migrate $$...$$ text in paragraphs to blockMath nodes */
function migrateBlockMathStrings(editor: Editor) {
  const { tr } = editor.state;
  const { blockMath } = editor.schema.nodes;
  if (!blockMath) return;

  let changed = false;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const text = node.textContent;
    // Match paragraphs that are exactly $$...$$
    const match = text.match(/^\$\$([\s\S]+?)\$\$$/);
    if (!match) return;
    const latex = match[1].trim();
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
}

export default function MarkdownEditor({ initialContent, onSave, onContentChange, vaultPath }: MarkdownEditorProps) {
  const debouncedSave = useDebounce((markdown: string) => onSave(markdown), 500);
  // 保存 editor 引用，供 onClick 回调使用（回调在 useEditor 之前定义，无法直接访问 editor）
  const editorRef = useRef<Editor | null>(null);

  // 公式编辑状态：点击公式时弹出编辑浮层
  const [mathEdit, setMathEdit] = useState<{
    latex: string;
    pos: number;
    isBlock: boolean;
    anchorRect: DOMRect;
  } | null>(null);

  // 点击公式节点时，通过 editor.view.nodeDOM 精确定位 DOM 元素并弹出编辑器
  const handleMathClick = useCallback((node: PmNode, pos: number, isBlock: boolean) => {
    const ed = editorRef.current;
    if (!ed) return;

    // 使用 ProseMirror view 直接获取该 pos 对应的 DOM 节点，避免 querySelector 匹配失败
    const dom = ed.view.nodeDOM(pos);
    const el = dom instanceof HTMLElement ? dom : (dom as ChildNode)?.parentElement;
    if (!el) return;

    // 优先定位渲染容器（.tiptap-mathematics-render），否则用节点自身
    const renderEl = el.querySelector(".tiptap-mathematics-render") ?? el;
    const rect = renderEl.getBoundingClientRect();

    setMathEdit({
      latex: node.attrs.latex,
      pos,
      isBlock,
      anchorRect: rect,
    });
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "开始书写…" }),
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
      WikiLink.configure({ suggestion: createWikiLinkSuggestion(vaultPath) }),
      TagHighlight,
      InlineMathWithMarkdown.configure({
        katexOptions: { throwOnError: false },
        onClick: (node: PmNode, pos: number) => handleMathClick(node, pos, false),
      }),
      BlockMathWithMarkdown.configure({
        katexOptions: { throwOnError: false, displayMode: true },
        onClick: (node: PmNode, pos: number) => handleMathClick(node, pos, true),
      }),
    ],
    content: initialContent,
    onCreate({ editor: currentEditor }) {
      editorRef.current = currentEditor;
      migrateBlockMathStrings(currentEditor);
      migrateMathStrings(currentEditor);
    },
    onUpdate({ editor }) {
      const md = (editor.storage as Record<string, any>).markdown;
      const markdown: string = md.getMarkdown();
      debouncedSave(markdown);
      onContentChange?.(markdown);
    },
    editorProps: { attributes: { class: "outline-none min-h-full" } },
  });

  // 同步 editorRef（HMR 或 editor 重建时）
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editorRef.current = editor;
    }
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const md = (editor.storage as Record<string, any>).markdown;
    if (md.getMarkdown() === initialContent) return;
    editor.commands.setContent(initialContent);
    migrateBlockMathStrings(editor);
    migrateMathStrings(editor);
  }, [initialContent, editor]);

  // 确认公式编辑：用新的 latex 替换原有节点
  const handleMathConfirm = useCallback((newLatex: string) => {
    if (!editor || !mathEdit) return;
    const { pos, isBlock } = mathEdit;
    const nodeType = isBlock ? editor.schema.nodes.blockMath : editor.schema.nodes.inlineMath;
    if (!nodeType) return;

    // 获取当前 pos 处的节点，使用其真实 nodeSize（atom 节点的 size 不一定是 1）
    const nodeAtPos = editor.state.doc.nodeAt(pos);
    if (!nodeAtPos) return;

    const { tr } = editor.state;
    tr.replaceWith(pos, pos + nodeAtPos.nodeSize, nodeType.create({ latex: newLatex }));
    editor.view.dispatch(tr);
    setMathEdit(null);
  }, [editor, mathEdit]);

  if (!editor) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <BubbleMenu editor={editor}
        className="glass-elevated glass-highlight flex items-center gap-0.5 px-2 py-1.5 rounded-[14px]">
        <Btn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} label="B" title="加粗" bold />
        <Btn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} label="I" title="斜体" italic />
        <Btn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} label="S" title="删除线" strike />
        <Btn active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} label="<>" title="代码" mono />
        <Sep />
        <Btn active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} label="H1" title="一级标题" mono />
        <Btn active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="H2" title="二级标题" mono />
        <Btn active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} label="H3" title="三级标题" mono />
        <Sep />
        <Btn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} label="Li" title="列表" />
        <Btn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="Bq" title="引用" mono />
        <Btn active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} label="Td" title="待办" mono />
      </BubbleMenu>

      <EditorContent editor={editor} className="flex-1 overflow-y-auto px-12 py-8 prose-editor" />

      {/* 公式编辑浮层 */}
      {mathEdit && (
        <MathEditor
          latex={mathEdit.latex}
          isBlock={mathEdit.isBlock}
          anchorRect={mathEdit.anchorRect}
          onConfirm={handleMathConfirm}
          onClose={() => setMathEdit(null)}
        />
      )}
    </div>
  );
}

function Sep() {
  return <div className="w-px h-3.5 mx-1" style={{ background: "var(--separator-light)" }} />;
}

function Btn({ active, onClick, label, title, bold, italic, strike, mono }: {
  active: boolean; onClick: () => void; label: string; title: string;
  bold?: boolean; italic?: boolean; strike?: boolean; mono?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={`px-2 py-1 rounded-[8px] text-xs transition-all duration-200 cursor-pointer
        ${bold ? "font-bold" : ""} ${italic ? "italic" : ""} ${strike ? "line-through" : ""} ${mono ? "font-mono" : ""}
        hover:bg-white/[0.06] active:scale-95`}
      style={{
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-tertiary)",
      }}>
      {label}
    </button>
  );
}
