/**
 * Builds both targets and zips each into release/, ready to attach to a
 * GitHub Release. v0.2.0's zips were made by hand; this exists so a release
 * is reproducible and so the two conventions that matter can't be forgotten:
 *
 * - the zip name carries the version (`sb118-extension-chromium-0.2.1.zip`)
 * - it unpacks to ONE clearly-named folder, not loose files, because testers
 *   point "Load unpacked" at a folder
 *
 * The version comes from package.json, which the manifests must match — the
 * check below fails the build rather than shipping a zip whose manifest says
 * a different version than its filename.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, cpSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

for (const t of ['chromium', 'firefox']) {
  const manifest = JSON.parse(
    readFileSync(resolve(root, `src/manifest.${t}.json`), 'utf8')
  )
  if (manifest.version !== version) {
    throw new Error(
      `manifest.${t}.json is version ${manifest.version} but package.json is ${version} — bump both`
    )
  }
}

execFileSync('node', ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' })

const releaseDir = resolve(root, 'release')
rmSync(releaseDir, { recursive: true, force: true })
mkdirSync(releaseDir, { recursive: true })

for (const t of ['chromium', 'firefox']) {
  const folder = `sb118-extension-${t}-${version}`
  const staged = resolve(releaseDir, folder)
  cpSync(resolve(root, 'dist', t), staged, { recursive: true })
  execFileSync('zip', ['-qr', `${folder}.zip`, folder], {
    cwd: releaseDir,
    stdio: 'inherit',
  })
  rmSync(staged, { recursive: true, force: true })
  console.log(`packaged release/${folder}.zip`)
}

console.log(readdirSync(releaseDir).join('\n'))
