/**
 * Vitest 配置
 * - 复用 Vite 配置（react 插件 + tsconfig paths）
 * - 后端 API 测试使用 node 环境
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['api/**/*.ts', 'src/lib/**/*.ts'],
      exclude: ['**/*.d.ts', 'api/points-data.ts'],
    },
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15000,
  },
});
