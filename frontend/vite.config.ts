// Copyright (c) 2025 Philip Choi

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/vehicles': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        followRedirects: true, // Phase 1 307 리다이렉트 대응
      },
      '/static': {
        target: 'http://localhost:8000',
        followRedirects: true,
      },
    },
  },
  build: {
    // Windows MAX_PATH 260자 회피 — 빌드 결과 폴더/파일명 평탄화
    assetsDir: 'a',
    rollupOptions: {
      output: {
        entryFileNames: 'a/[hash:8].js',
        chunkFileNames: 'a/[hash:8].js',
        assetFileNames: 'a/[hash:8][extname]',
      },
    },
  },
})
