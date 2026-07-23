import { defineConfig } from 'vite';

// Plain static app: index.html at the root, ES modules under src/.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
