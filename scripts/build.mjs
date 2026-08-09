import { build } from 'vite'
import { cpSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { targets } from './targets.mjs'

const root = resolve(process.cwd())
for (const t of targets) {
  const outDir = resolve(root, 'dist', t.name)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  await build({
    root,
    build: {
      outDir,
      emptyOutDir: false,
      rollupOptions: {
        input: {
          background: resolve(root, 'src/background.ts'),
          popup: resolve(root, 'src/popup/popup.ts'),
          options: resolve(root, 'src/options/options.ts'),
        },
        output: {
          // Keep background.js at the dist root (the manifest references it there),
          // but emit popup/options entry JS INTO their own folders so the copied
          // popup/popup.html and options/options.html resolve `src="popup.js"` /
          // `src="options.js"` as same-folder siblings. Shared chunks go under assets/.
          entryFileNames: (chunk) =>
            chunk.name === 'background' ? 'background.js' : `${chunk.name}/${chunk.name}.js`,
          chunkFileNames: 'assets/[name]-[hash].js',
          format: 'es',
        },
      },
    },
  })
  // Static assets
  copyFileSync(resolve(root, t.manifest), resolve(outDir, 'manifest.json'))
  cpSync(resolve(root, 'src/popup'), resolve(outDir, 'popup'), { recursive: true, filter: (s) => !s.endsWith('.ts') })
  cpSync(resolve(root, 'src/options'), resolve(outDir, 'options'), { recursive: true, filter: (s) => !s.endsWith('.ts') })
  cpSync(resolve(root, 'src/icons'), resolve(outDir, 'icons'), { recursive: true })
  console.log(`built dist/${t.name}`)
}
