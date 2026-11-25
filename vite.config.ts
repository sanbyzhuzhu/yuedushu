import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  optimizeDeps: { entries: ['index.html'] },
  server: {
    port: 5173,
    watch: { ignored: ['**/src-tauri/**', '**/.tmp/**', '**/output/**', '**/.gradle-home/**', '**/.playwright-cli/**'] },
  },
  preview: { port: 4173, host: '127.0.0.1' },
});
