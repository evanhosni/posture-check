import { createPostureWatcher, speak, type PostureWatcherOptions } from '../../src/index'
import { send, type Message } from './messages'
import { loadState, sensitivityMultiplier, type Settings } from './settings'

const POSTURE_HEARTBEAT_MS = 3000

/**
 * Wires a PostureWatcher to the background worker. The offscreen document runs one of
 * these in Chrome; the monitor window does on Firefox, which has no offscreen API.
 */
export async function attachMonitor(options: PostureWatcherOptions = {}) {
  const stored = await loadState()

  const watcher = createPostureWatcher({
    ...options,
    sensitivity: sensitivityMultiplier(stored.settings.sensitivity),
    holdSeconds: stored.settings.holdSeconds,
    repeatAlertSeconds: stored.settings.repeatAlertSeconds,
    baseline: stored.baseline,
    wasmPath: chrome.runtime.getURL('wasm'),
    modelPath: chrome.runtime.getURL('models/pose_landmarker_lite.task'),
    alert: alertOptions(stored.settings),
  })

  watcher.on('status', (status) => void send({ kind: 'monitor-status', status }))
  watcher.on('calibrating', ({ progress, remainingMs }) => {
    void send({ kind: 'monitor-calibrating', progress, remainingMs })
  })
  watcher.on('calibrated', (baseline) => void send({ kind: 'monitor-calibrated', baseline }))
  reportPosture(watcher)
  watcher.on('alert', ({ issues }) => void send({ kind: 'monitor-alert', issues }))
  watcher.on('error', (error) => void send({ kind: 'monitor-error', message: error.message }))

  chrome.runtime.onMessage.addListener((message: Message) => {
    if (message.kind === 'monitor-settings') {
      watcher.setSensitivity(sensitivityMultiplier(message.settings.sensitivity))
      watcher.setHoldSeconds(message.settings.holdSeconds)
      watcher.setRepeatAlertSeconds(message.settings.repeatAlertSeconds)
      watcher.setAlertOptions(alertOptions(message.settings))
    }
    if (message.kind === 'monitor-calibrate') {
      watcher.calibrate(message.seconds * 1000).catch(() => undefined)
    }
    if (message.kind === 'monitor-test-alert') watcher.testAlert()
    if (message.kind === 'monitor-speak') speak(message.phrase)
  })

  return { watcher, settings: stored.settings }
}

/**
 * The badge is the only posture readout, and the service worker forgets everything when
 * it is torn down, so posture is re-sent on a heartbeat as well as on every change.
 */
function reportPosture(watcher: ReturnType<typeof createPostureWatcher>) {
  let lastGood: boolean | null = null
  let lastSentAt = 0

  watcher.on('frame', ({ verdict, absent }) => {
    if (absent) {
      if (lastGood === null) return
      lastGood = null
      void send({ kind: 'monitor-absent' })
      return
    }
    if (!verdict) return

    const now = Date.now()
    if (verdict.good === lastGood && now - lastSentAt < POSTURE_HEARTBEAT_MS) return

    lastGood = verdict.good
    lastSentAt = now
    void send({ kind: 'monitor-posture', good: verdict.good, issues: verdict.issues })
  })
}

/**
 * The background worker owns the extension APIs, so it raises the notification and speaks
 * through chrome.tts; this page only makes the siren.
 */
function alertOptions(settings: Settings) {
  return {
    notification: false,
    siren: settings.siren,
    speech: false,
  }
}
