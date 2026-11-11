import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TARGETS = ['chrome', 'firefox']

// Every build names its browser: neither one is the implied default.
const target = process.argv[2]
if (!TARGETS.includes(target)) {
  throw new Error(`Name the target: ${TARGETS.join(' | ')}`)
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, `dist-${target}`)

const [manifest, pkg] = await Promise.all([
  readJson(resolve(root, `extension/manifest.${target}.json`)),
  readJson(resolve(root, 'package.json')),
])

manifest.version = pkg.version
await writeFile(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`wrote ${target} manifest v${pkg.version}`)

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}
