import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri 开发服务器配置
  server: {
    port: 5173,
    strictPort: true,
  },
  // 构建输出到 dist 目录，供 Tauri 打包使用
  build: {
    outDir: "dist",
    emptyOutDir: true,
    modulePreload: false,
    chunkSizeWarningLimit: 1300,
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
          if (id.includes("node_modules/plotly.js-basic-dist-min") || id.includes("node_modules/react-plotly.js")) {
            return "vendor-plotly";
          }
          if (id.includes("node_modules/@tiptap") || id.includes("node_modules/prosemirror") || id.includes("node_modules/tiptap-markdown")) {
            return "vendor-editor";
          }
          if (id.includes("node_modules/react-force-graph-2d") || id.includes("node_modules/d3-")) {
            return "vendor-graph";
          }
          if (id.includes("node_modules/katex") || id.includes("node_modules/remark-math") || id.includes("node_modules/rehype-katex")) {
            return "vendor-math";
          }
          if (id.includes("node_modules/smiles-drawer") || id.includes("node_modules/jcampconverter")) {
            return "vendor-chem";
          }
          return undefined;
        },
      },
    },
  },
});
