import { InlineMath, BlockMath } from "@tiptap/extension-mathematics";

/**
 * Extends the Mathematics nodes with tiptap-markdown serialization,
 * so that LaTeX formulas round-trip correctly as $...$ and $$...$$.
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
});

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
});
