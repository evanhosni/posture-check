import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Everything the pose model needs is bundled into the extension: MV3 pages may only load
// code from their own origin, so nothing can be pulled from a CDN at runtime.
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const wasmTarget = resolve(root, 'extension/public/wasm')
const modelTarget = resolve(root, 'extension/public/models/pose_landmarker_lite.task')

await mkdir(dirname(wasmTarget), { recursive: true })
await cp(resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm'), wasmTarget, {
  recursive: true,
})

if (await exists(modelTarget)) {
  console.log('model already downloaded')
} else {
  console.log('downloading pose model…')
  const response = await fetch(MODEL_URL)
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`)
  await mkdir(dirname(modelTarget), { recursive: true })
  await writeFile(modelTarget, Buffer.from(await response.arrayBuffer()))
}

async function exists(path) {
  return stat(path).then(
    () => true,
    () => false,
  )
}
