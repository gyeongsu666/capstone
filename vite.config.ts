import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 실제 백엔드 주소(예: http://localhost:8000). 소스에 고정하지 않고 .env.local에서 받는다.
  // 비우면 프록시를 켜지 않는다(MSW 가짜 서버만 쓸 때).
  const target = env.API_PROXY_TARGET;
  return {
    plugins: [react()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      strictPort: true,
      // /api → 백엔드. 브라우저 입장에서 같은 출처라 세션 쿠키가 그대로 붙는다.
      // Origin 헤더는 바꾸지 않는다(서버가 http://localhost:5173을 허용, 요청서 4장).
      proxy: target ? { '/api': { target, changeOrigin: false } } : undefined,
    },
  };
});
