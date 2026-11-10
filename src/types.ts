import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

export type PostureStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'calibrating'
  | 'watching'
  | 'paused'
  | 'error'

export interface PostureMetrics {
  /** Ear-to-shoulder vertical gap over shoulder width. Shrinks when the neck collapses. */
  neckRatio: number
  /** Shoulder width in frame units. Grows as the body moves toward the camera. */
  shoulderWidth: number
  /** Shoulder height difference over shoulder width. Non-zero when leaning to one side. */
  shoulderSlope: number
  /** Head offset from the shoulder midpoint over shoulder width. */
  headOffset: number
}

export type PostureIssueKind = 'slouch' | 'lean' | 'shoulderSlope' | 'headOffset'

export interface PostureIssue {
  kind: PostureIssueKind
  message: string
  /** How far past the threshold this issue is. 1 is exactly at the limit. */
  severity: number
}

export interface PostureVerdict {
  good: boolean
  issues: PostureIssue[]
}

export interface AlertOptions {
  /** Desktop notification. Requires notification permission. */
  notification?: boolean
  /** Rising-falling siren through the Web Audio API. */
  siren?: boolean
  /** Spoken announcement through the Web Speech API. */
  speech?: boolean
  /** What the voice says. */
  phrase?: string
  /** Desktop notification title. */
  title?: string
  /** Voice names to prefer, best first. Defaults to modern female voices. */
  voicePreferences?: RegExp[]
  /** Utterance pitch, 0-2. Low values sound robotic. */
  pitch?: number
  /** Utterance rate, 0.1-10. */
  rate?: number
  volume?: number
}

export interface PostureWatcherOptions {
  /** Video element to run on. One is created and hidden when omitted. */
  video?: HTMLVideoElement
  /** Camera stream to use instead of opening one. */
  stream?: MediaStream
  /** Constraints for the camera this opens when no stream is given. */
  constraints?: MediaStreamConstraints
  /** Scales every threshold. Higher is pickier. */
  sensitivity?: number
  /** Seconds of sustained bad posture before an alert fires. */
  holdSeconds?: number
  /** Minimum seconds between repeat alerts while posture stays bad. */
  repeatAlertSeconds?: number
  /** Seconds of good posture that re-arm the alert. */
  recoverySeconds?: number
  /** Length of a calibration capture. */
  calibrationMs?: number
  /** Pose detections per second. Lower is cheaper. */
  fps?: number
  /** Metric smoothing, 0-1. Higher follows the camera more closely. */
  smoothing?: number
  /** Known-good baseline, e.g. restored from storage. Skips the need to calibrate. */
  baseline?: PostureMetrics | null
  /** Built-in alerting. Pass false to handle the `alert` event yourself. */
  alert?: AlertOptions | false
  /** Where the MediaPipe wasm runtime is served from. */
  wasmPath?: string
  /** Where the pose model is served from. */
  modelPath?: string
  /** Start monitoring as soon as a baseline exists. */
  autoEnable?: boolean
}

export interface PostureFrame {
  metrics: PostureMetrics | null
  landmarks: NormalizedLandmark[] | null
  verdict: PostureVerdict | null
  /** True when no person is detected in frame. */
  absent: boolean
}

export interface PostureAlert {
  issues: PostureIssue[]
  metrics: PostureMetrics
  /** Milliseconds of unbroken bad posture when the alert fired. */
  badForMs: number
  /** How many alerts have fired this session, including this one. */
  count: number
}

export interface PostureStats {
  goodMs: number
  badMs: number
  alerts: number
  startedAt: number
}

export interface PostureEvents {
  status: PostureStatus
  frame: PostureFrame
  /** Fires only when posture flips between good and bad. */
  posture: { good: boolean; issues: PostureIssue[]; metrics: PostureMetrics }
  alert: PostureAlert
  /** Progress through a calibration capture, 0-1, with the time left in the window. */
  calibrating: { progress: number; remainingMs: number }
  calibrated: PostureMetrics
  error: Error
}
