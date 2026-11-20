import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@mercearia/contracts': resolve(__dirname, '../../packages/contracts/src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Bibliotecas mudam pouco: num arquivo à parte, ficam no cache entre versões.
        manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], query: ['@tanstack/react-query'] },
      },
    },
  },
  server: { proxy: { '/v1': 'http://localhost:3000' } },
  test: { environment: 'node', include: ['src/**/*.spec.ts'] },
});
