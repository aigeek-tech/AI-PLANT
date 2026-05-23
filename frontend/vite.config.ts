import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: './node_modules/@mlightcad/data-model/dist/dxf-parser-worker.js',
          dest: 'cad-viewer-assets',
        },
        {
          src: './node_modules/@mlightcad/cad-simple-viewer/dist/libredwg-parser-worker.js',
          dest: 'cad-viewer-assets',
        },
        {
          src: './node_modules/@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js',
          dest: 'cad-viewer-assets',
        },
      ],
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
