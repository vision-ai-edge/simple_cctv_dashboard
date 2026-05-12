import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 5173,
    proxy: {
      // API 프록시 — apps/api 가 동일 머신의 :3000 에서 동작한다고 가정
      // API 서버는 모든 라우트를 /api prefix 로 노출하므로 rewrite 하지 않는다
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
