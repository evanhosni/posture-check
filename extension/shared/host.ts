import {
  createPostureWatcher,
  playSiren,
  speak,
  type PostureWatcher,
  type PostureWatcherOptions,
} from '../../src/index'
import { send, type HostSettings, type Message } from './messages'
import { sensitivityMultiplier } from './settings'

/** The badge is the only posture readout, and the worker forgets it when it is torn down. */
const POSTURE_HEARTBEAT_MS = 3000

/** A watcher that loads its model and wasm from the extension's own files. */
export function createWatcher(options: PostureWatcherOptions = {}) {
  return createPostureWatcher({
    wasmPath: chrome.runtime.getURL('wasm'),
    modelPath: chrome.runtime.getURL('models/pose_landmarker_lite.task'),
    alert: false,
    ...options,
  })
}

/**
 * Runs the camera on the worker's behalf: Chrome does this in an offscreen document,
 * Firefox in a visible window. Settings arrive by message because chrome.storage does
 * not exist in an offscreen document.
 */
export async function runCameraHost(watcher: PostureWatcher) {
  reportPosture(watcher)
  watcher.on('alert', ({ issues }) => void send({ kind: 'host-alert', issues }))
  watcher.on('error', (error) => void send({ kind: 'host-error', message: error.message }))
  acceptCommands(watcher)

  try {
    await watcher.start()
  } catch {
    // start() emits 'error' as well as throwing, and that is already on its way.
    return
  }

  applySettings(watcher, (await send({ kind: 'host-attached' })) as HostSettings | undefined)
}

function acceptCommands(watcher: PostureWatcher) {
  chrome.runtime.onMessage.addListener((message: Message, _sender, respond) => {
    // A host that is hung looks identical to a working one from the worker, so being
    // able to answer at all is what proves this document is still alive.
    if (message.kind === 'host-ping') respond(true)
    if (message.kind === 'host-settings') applySettings(watcher, message)
    if (message.kind === 'host-siren') playSiren()
    if (message.kind === 'host-speak') speak(message.phrase)
  })
}

function applySettings(watcher: PostureWatcher, state: HostSettings | undefined) {
  if (!state) return
  const { settings, baseline } = state

  watcher.setSensitivity(sensitivityMultiplier(settings.sensitivity))
  watcher.setHoldSeconds(settings.holdSeconds)
  watcher.setRepeatAlertSeconds(settings.repeatAlertSeconds)
  // The worker owns the extension APIs, so it speaks and raises the notification. The
  // siren needs a document, which makes it the one part of an alert that plays here.
  watcher.setAlertOptions({ notification: false, siren: settings.siren, speech: false })
  watcher.setBaseline(baseline)
}

function reportPosture(watcher: PostureWatcher) {
  let reported: boolean | null = null
  let reportedAt = 0

  watcher.on('frame', ({ verdict, absent }) => {
    if (!verdict && !absent) return

    const good = verdict?.good ?? null
    const now = Date.now()
    if (good === reported && now - reportedAt < POSTURE_HEARTBEAT_MS) return

    reported = good
    reportedAt = now
    void send({ kind: 'host-posture', good })
  })
}
