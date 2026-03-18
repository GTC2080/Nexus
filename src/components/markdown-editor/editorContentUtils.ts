import { migrateMathStrings } from "@tiptap/extension-mathematics";
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";

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

function buildPlainTextDoc(text: string) {
  const lines = text.split(/\r?\n/);
  const content = lines.map(line =>
    line
      ? { type: "paragraph", content: [{ type: "text", text: line }] }
      : { type: "paragraph" },
  );

  return {
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
}

export function applyEditorContentSafely(editor: Editor, content: string, enableScientific: boolean) {
  try {
    editor.commands.setContent(content);
  } catch (error) {
    console.error("Markdown parse failed, falling back to plain text:", error);
    editor.commands.setContent(buildPlainTextDoc(content));
  }

  if (!enableScientific) {
    return;
  }

  try {
    migrateBlockMathStrings(editor);
    migrateMathStrings(editor);
  } catch (error) {
    console.error("Math migration failed, skipping migration step:", error);
  }
}
