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
  },
});
