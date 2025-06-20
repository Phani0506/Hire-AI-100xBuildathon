import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Required for React Router's BrowserRouter to work in dev
    historyApiFallback: true,
  },
  build: {
    // Optional: specify output folder (default is 'dist')
    outDir: 'dist',
  },
});
