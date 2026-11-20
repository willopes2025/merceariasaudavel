import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: {
      '@mercearia/contracts': resolve(__dirname, '../../packages/contracts/src'),
    },
  },
  test: { environment: 'node', include: ['src/**/*.spec.ts'] },
});
