import { InlineMath, BlockMath } from "@tiptap/extension-mathematics";
import { InputRule } from "@tiptap/core";

/**
 * Extends InlineMath with:
 * 1. tiptap-markdown serialization ($...$)
 * 2. Standard LaTeX input rule: typing $...$ creates inline math
 *    (the default extension requires $$...$$, which is non-standard)
 */
export const InlineMathWithMarkdown = InlineMath.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: any, node: any) {
          state.write(`$${node.attrs.latex}$`);
        },
        parse: {},
      },
    };
  },

  addInputRules() {
    return [
      // Standard: $...$ (single dollar)
      new InputRule({
        find: /(^|[^$\\])(\$([^$\n]+?)\$)(?!\$)/,
        handler: ({ state, range, match }) => {
          const latex = match[3];
          if (!latex?.trim()) return;
          const { tr } = state;
          // Preserve the character before $ (captured in match[1])
          const prefixLen = match[1].length;
          tr.replaceWith(
            range.from + prefixLen,
            range.to,
            this.type.create({ latex: latex.trim() }),
          );
        },
      }),
      // Also keep the original $$...$$ pattern for compatibility
      ...this.parent?.() ?? [],
    ];
  },
});

/**
 * Extends BlockMath with:
 * 1. tiptap-markdown serialization ($$...$$)
 * 2. Standard LaTeX input rule: typing $$...$$ on its own line creates block math
 *    (the default extension requires $$$...$$$, which is non-standard)
 */
export const BlockMathWithMarkdown = BlockMath.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: any, node: any) {
          state.write(`$$\n${node.attrs.latex}\n$$`);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },

  addInputRules() {
    return [
      // Standard: $$...$$ at the start of a line (block-level)
      new InputRule({
        find: /^\$\$([^$]+)\$\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          if (!latex?.trim()) return;
          const { tr } = state;
          tr.replaceWith(range.from, range.to, this.type.create({ latex: latex.trim() }));
        },
      }),
      // Also keep the original $$$...$$$  pattern for compatibility
      ...this.parent?.() ?? [],
    ];
  },
});
