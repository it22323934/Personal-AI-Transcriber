import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Builds the unpacked extension into dist/. Load that folder in chrome://extensions.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        sidepanel: r('./sidepanel.html'),
        library: r('./library.html'),
        offscreen: r('./offscreen.html'),
        background: r('./src/background/index.ts'),
        widget: r('./src/widget/widget.ts'),
      },
      output: {
        // The service worker and the injected mini player need fixed filenames.
        entryFileNames: (chunk) =>
          chunk.name === 'background' || chunk.name === 'widget' ? `${chunk.name}.js` : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        manualChunks: (id) => (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) ? 'react' : undefined),
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
