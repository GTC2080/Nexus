import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          ["babel-plugin-react-compiler", {}],
        ],
      },
    }),
    tailwindcss(),
  ],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  // Tauri 开发服务器配置
  server: {
    port: 5173,
    strictPort: true,
  },
  // 构建输出到 dist 目录，供 Tauri 打包使用
  build: {
    outDir: "dist",
    emptyOutDir: true,
    modulePreload: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "vendor-react";
          }
          if (id.includes("node_modules/@tauri-apps")) {
            return "vendor-tauri";
          }
          if (id.includes("node_modules/3dmol")) {
            return "vendor-3dmol";
          }
          if (id.includes("node_modules/plotly.js-basic-dist-min") || id.includes("node_modules/react-plotly.js")) {
            return "vendor-plotly";
          }
          if (id.includes("node_modules/@tiptap") || id.includes("node_modules/prosemirror")) {
            return "vendor-editor-core";
          }
          if (id.includes("node_modules/tiptap-markdown")) {
            return "vendor-editor-markdown";
          }
          if (id.includes("node_modules/react-force-graph-2d") || id.includes("node_modules/d3-")) {
            return "vendor-graph";
          }
          if (id.includes("node_modules/katex") || id.includes("node_modules/remark-math") || id.includes("node_modules/rehype-katex")) {
            return "vendor-math";
          }
          if (id.includes("node_modules/recharts")) {
            return "vendor-charts";
          }
          if (id.includes("node_modules/smiles-drawer")) {
            return "vendor-smiles";
          }
          if (id.includes("node_modules/ketcher-") || id.includes("node_modules/indigo-")) {
            return "vendor-ketcher";
          }
          if (id.includes("node_modules/jcampconverter")) {
            return "vendor-spectroscopy";
          }
          if (id.includes("node_modules/@dnd-kit")) {
            return "vendor-dnd";
          }
          if (id.includes("node_modules/react-markdown")) {
            return "vendor-markdown-render";
          }
          return undefined;
        },
      },
    },
  },
});
