import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const TARGETS = ['chrome', 'firefox']

// Every build names its browser: neither one is the implied default.
const target = process.env.EXT_TARGET ?? ''
if (!TARGETS.includes(target)) {
  throw new Error(`Set EXT_TARGET to one of: ${TARGETS.join(', ')}`)
}

export default defineConfig({
  root: 'extension',
  publicDir: 'public',
  build: {
    // Extension pages and the background worker are loaded as ES modules, so top-level
    // await and the MediaPipe bundle both need an untranspiled target.
    target: 'esnext',
    outDir: resolve(__dirname, `dist-${target}`),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        options: resolve(__dirname, 'extension/options.html'),
        calibrating: resolve(__dirname, 'extension/calibrating.html'),
        monitor: resolve(__dirname, 'extension/monitor.html'),
        offscreen: resolve(__dirname, 'extension/offscreen.html'),
        background: resolve(__dirname, 'extension/background.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
