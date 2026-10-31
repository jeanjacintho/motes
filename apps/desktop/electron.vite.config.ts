import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      externalizeDeps: { exclude: ['@motes/core', '@motes/protocol'] },
    },
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: { build: { outDir: 'dist/renderer' } },
});
