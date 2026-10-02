import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 读取 .env（含无前缀变量），使前端端口与后端代理目标可配置，避免端口硬编码
  const env = loadEnv(mode, process.cwd(), '');
  const backendPort = env.VITE_BACKEND_PORT || env.PORT || '3001';
  const frontendPort = Number(env.VITE_PORT || 5173);
  const target = `http://localhost:${backendPort}`;

  return {
    plugins: [
      react({
        babel: {
          plugins: ['react-dev-locator'],
        },
      }),
      tsconfigPaths(),
    ],
    server: {
      port: frontendPort,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          secure: false,
        },
        '/storage': {
          target,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
