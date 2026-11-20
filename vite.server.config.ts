import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'node22',
    outDir: '.',
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: 'index.ts',
      formats: ['es'],
      fileName: () => 'server.js'
    },
    rollupOptions: {
      external: [/^@chatluna\//, /^@satorijs\//, /^node:/]
    }
  }
})
