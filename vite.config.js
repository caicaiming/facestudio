import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // 固定 5173：端口被占用时直接报错，而不是静默切到 5174 造成「打不开」的困惑
    port: 5173,
    strictPort: true,
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
