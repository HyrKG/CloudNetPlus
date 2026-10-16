import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'CLOUDNET_');
  return {
    base: '/',
    plugins: [react()],
    build: {
      outDir: '../build/web',
      emptyOutDir: true,
    },
    server: {
      proxy: {
        '/api': {
          target: env.CLOUDNET_API_TARGET || 'http://127.0.0.1:2813',
          changeOrigin: false,
          ws: true,
        },
      },
    },
  };
});
