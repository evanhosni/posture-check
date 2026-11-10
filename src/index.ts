export { PostureWatcher, createPostureWatcher } from './watcher'
export {
  DEFAULT_ALERT_OPTIONS,
  SIREN_MS,
  VOICE_DELAY_MS,
  DEFAULT_VOICE_PREFERENCES,
  listVoices,
  playAlert,
  playSiren,
  requestNotificationPermission,
  sendNotification,
  setVoicePreferences,
  speak,
} from './alerts'
export { LIMITS, MESSAGES, average, evaluate, measure, smooth } from './metrics'
export { DEFAULT_MODEL_PATH, DEFAULT_WASM_PATH, createPoseLandmarker } from './pose'
export { POSTURE_CONNECTIONS, POSTURE_POINTS, drawPose } from './overlay'
export type { DrawPoseOptions } from './overlay'
export type {
  AlertOptions,
  PostureAlert,
  PostureEvents,
  PostureFrame,
  PostureIssue,
  PostureIssueKind,
  PostureMetrics,
  PostureStats,
  PostureStatus,
  PostureVerdict,
  PostureWatcherOptions,
} from './types'
