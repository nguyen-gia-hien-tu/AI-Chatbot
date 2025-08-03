import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
    watch: {
      usePolling: true,
    },
    hmr: {
      overlay: true,
    },
    proxy: {
      '/answer_question': 'http://127.0.0.1:8000',
      '/answer_question_sse': 'http://127.0.0.1:8000',
    },
  },
});
