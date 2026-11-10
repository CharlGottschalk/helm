import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pkg = (path: string) => fileURLToPath(new URL(`../../packages/${path}`, import.meta.url))

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  plugins: [react()],
  // the Helm version shown in the sidebar brand line
  define: { __HELM_VERSION__: JSON.stringify(version) },
  // Windows app-container paths realpath to a virtualised location Vite can't read
  resolve: {
    preserveSymlinks: true,
    // Internal packages straight from source: with preserveSymlinks they would otherwise
    // look like node_modules deps, get pre-bundled and serve stale code in dev.
    alias: [
      { find: /^@usetdt\/helm-sdk$/, replacement: pkg('sdk/src/index.ts') },
      { find: /^@helm\/(client|widgets|ui)$/, replacement: pkg('$1/src/index.ts') },
      { find: /^@helm\/ui\/styles\//, replacement: pkg('ui/src/styles/') },
    ],
  },
  server: {
    port: 5173,
    // `npm run dev:server` runs the Helm server on 4317; open http://localhost:5173/#token=dev
    proxy: {
      '/api': { target: 'http://127.0.0.1:4317' },
      '/frame': { target: 'http://127.0.0.1:4317' },
      '/ws': { target: 'ws://127.0.0.1:4317', ws: true },
    },
  },
})
