import { defineConfig } from 'vite'

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  esbuild: { jsx: 'automatic' },
  build: {
    lib: {
      entry: 'client/index.tsx',
      formats: ['es'],
      fileName: () => 'client.js'
    },
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      external: [
        'react',
        'react/jsx-runtime',
        'react-dom',
        'react-router',
        '@chatluna/ui-client/client',
        'markdown-it-ts'
      ],
      output: {
        assetFileNames: (asset) => (asset.name?.endsWith('.css') ? 'client.css' : 'assets/[name][extname]')
      }
    }
  }
})
