import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * GitHub Pages serves a project site under https://<user>.github.io/<repo-name>/,
 * so `base` has to contain the repo name. The GitHub Actions workflow sets BASE_PATH;
 * locally (npm run dev / build) the variable is unset and the root ("/") is used.
 */
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Libraries change less often than the app: separate chunks stay cached between releases
        manualChunks: (id) => (id.includes('@xyflow') ? 'flow' : /node_modules\/(react|react-dom|scheduler)\//.test(id) ? 'react' : undefined),
      },
    },
  },
});
