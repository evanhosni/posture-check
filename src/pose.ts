import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

const VERSION = '0.10.35'

export const DEFAULT_WASM_PATH = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`
export const DEFAULT_MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

export interface PoseLandmarkerPaths {
  wasmPath?: string
  modelPath?: string
}

export async function createPoseLandmarker({
  wasmPath = DEFAULT_WASM_PATH,
  modelPath = DEFAULT_MODEL_PATH,
}: PoseLandmarkerPaths = {}) {
  const vision = await FilesetResolver.forVisionTasks(wasmPath)
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelPath, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
  })
}
