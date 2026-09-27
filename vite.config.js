import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 相对路径：一套产物同时适配三种部署位置 —— 站点根域、GitHub Pages 子路径
  // /<repo>/、以及本地 file/dist 直接打开。改用 '/<repo>/' 会锁死仓库名，
  // 换仓库或换自定义域名就得重新构建。运行时资源（models）须同步用
  // import.meta.env.BASE_URL 拼接，见 App.jsx 的 MODEL_URL。
  base: './',
  server: {
    // 固定 5173：端口被占用时直接报错，而不是静默切到 5174 造成「打不开」的困惑
    port: 5173,
    strictPort: true,
    // Codespaces / 容器内的端口转发会把请求带上来，不写会拒绝访问
    host: true,
  },
  build: {
    // face-api / tfjs 运行时体积约 1.4MB，属于已知且必要的开销。
    // 已通过动态 import 从主包中拆出（应用外壳可先渲染），故放宽告警阈值。
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
})
