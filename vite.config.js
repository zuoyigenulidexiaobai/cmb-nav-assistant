import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 前端构建产物由后端（server/index.js）托管；开发态通过代理把 /api 转发到本地后端。
export default defineConfig({
  plugins: [react()],
  // 允许 `src/` 下的 .js 文件书写 JSX（如 hooks/usePortfolio.js 的 Provider）。
  // 构建 / 源码转换需要 `esbuild`，开发态依赖预扫描需要 `optimizeDeps.esbuildOptions`。
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.jsx?$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: { '.js': 'jsx' },
    },
  },
  server: {
    port: 5173,
    open: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:9001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
