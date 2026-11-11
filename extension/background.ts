import type { PostureMetrics } from '../src/index'
import { send, type BackgroundState, type HostSettings, type Message } from './shared/messages'
import {
  DEFAULT_SETTINGS,
  loadState,
  saveBaseline,
  saveLastError,
  saveSettings,
} from './shared/settings'

const OFFSCREEN_PATH = 'offscreen.html'
const MONITOR_PATH = 'monitor.html'
const CALIBRATION_PATH = 'calibrating.html'
const KEEPALIVE_ALARM = 'posture-check-keepalive'
const ALERT_PHRASE = 'Bad posture alert'
/** Mirrors VOICE_DELAY_MS in src/alerts.ts; the worker cannot import that DOM-only module. */
const VOICE_DELAY_MS = 1350

const BADGE_STARTING = { text: '…', color: '#3f7fe2' }
const BADGE_BAD = { text: '!', color: '#e2503f' }
const BADGE_CLEAR = { text: '', color: '#3f7fe2' }

/** Voice preference order, mirroring the one the page-side speech synthesis uses. */
const VOICE_PREFERENCES = [
  /google (us|uk) english(?!.*male)/i,
  /\b(ava|zoe|allison|nicky|siri)\b/i,
  /premium|enhanced|neural|natural/i,
  /\b(sandy|flo|shelley|kathy)\b/i,
  /samantha|victoria|karen|moira|tessa|fiona|zira|female/i,
]

/** Chrome runs the camera in an offscreen document; Firefox has no such API. */
const supportsOffscreen = typeof chrome.offscreen !== 'undefined'

let settings = DEFAULT_SETTINGS
let baseline: PostureMetrics | null = null
/** Null until a host reports, and whenever nobody is in front of the camera. */
let posture: boolean | null = null
let attached = false
let voiceName: string | undefined

chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 })

chrome.runtime.onInstalled.addListener(() => void sync())
chrome.runtime.onStartup.addListener(() => void sync())

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) void sync()
})

chrome.action.onClicked.addListener(() => void toggle())

chrome.runtime.onMessage.addListener((message: Message, _sender, respond) => {
  void handle(message, respond)
  return true
})

async function toggle() {
  await hydrate()
  await setEnabled(!settings.enabled)
}

/**
 * Commands from the settings dialog are answered with the state it renders; reports from
 * the camera host and the calibration window are answered with whatever the sender needs.
 */
async function handle(message: Message, respond: (value: unknown) => void) {
  await hydrate()
  respond(await route(message))
}

async function route(message: Message): Promise<unknown> {
  switch (message.kind) {
    case 'get-state':
      return dialogState()

    case 'set-settings':
      settings = await saveSettings(message.settings)
      void send({ kind: 'host-settings', settings, baseline })
      await paint()
      return dialogState()

    case 'set-enabled':
      await setEnabled(message.enabled)
      return dialogState()

    case 'recalibrate':
      await startCalibration()
      return dialogState()

    case 'verify-notifications':
      // A notification is the only honest test: the OS can silently drop them.
      notify('Notifications are on', ['Posture alerts will appear here.'])
      return dialogState()

    case 'test-alert':
      await playTestAlert()
      speakWarning()
      notify('Posture alert test', ['This is what an alert looks like.'])
      return dialogState()

    case 'host-attached':
      attached = true
      await saveLastError(null)
      await paint()
      // chrome.storage does not exist in an offscreen document, so the host is told.
      return { settings, baseline } satisfies HostSettings

    case 'host-posture':
      // Posture only ever comes from a running host, which is the proof of life the
      // badge needs after the worker has been torn down and revived.
      attached = true
      posture = message.good
      await paint()
      return null

    case 'host-alert':
      speakWarning()
      notify('Bad Posture Alert', message.issues.map((issue) => issue.message))
      return null

    case 'host-error':
      await reportError(message.message)
      return null

    case 'calibrated':
      await finishCalibration(message.baseline)
      return null

    case 'calibration-failed':
      await failCalibration(message.message)
      return null

    default:
      return null
  }
}

async function setEnabled(enabled: boolean) {
  settings = await saveSettings({ enabled })

  if (!enabled) {
    await closeWindows(CALIBRATION_PATH)
    await stopCameraHost()
    await paint()
    return
  }

  // Switching on always recalibrates, so the baseline matches how you are sitting now.
  await startCalibration()
}

/**
 * Hands the camera to the calibration window for the length of a capture. Nothing else
 * may hold it meanwhile, which is also what lets calibration run with the extension off.
 */
async function startCalibration() {
  await stopCameraHost()
  await openCalibrationWindow()
  await paint()
}

async function finishCalibration(captured: PostureMetrics) {
  baseline = captured
  await saveBaseline(captured)
  await saveLastError(null)

  // Closed from here rather than left to the window: sync reads "a calibration is
  // running" off the open window, so the tab has to be gone before it runs.
  await closeWindows(CALIBRATION_PATH)
  // A host left from an earlier attempt can be hung in a way nothing here can see, so a
  // calibration always builds a fresh one.
  await stopCameraHost()
  await sync()
}

async function failCalibration(message: string) {
  await saveLastError(message)
  // Without a baseline there is nothing to watch against, so stay off rather than
  // reopening the calibration window on a loop.
  if (!baseline) settings = await saveSettings({ enabled: false })
  await paint()
}

/** Brings the camera host in line with the settings, and repaints what changed. */
async function sync() {
  await hydrate()
  await reconcileCameraHost()
  await paint()
}

async function reconcileCameraHost() {
  // The calibration window owns the camera while it is open, and only one context may.
  if (await isCalibrating()) return

  if (settings.enabled && baseline) {
    await startCameraHost()
    return
  }

  await stopCameraHost()
}

/** Brings up whichever context holds the camera, and keeps it the only one that does. */
async function startCameraHost() {
  if (!supportsOffscreen) {
    await openMonitorWindow()
    return
  }

  // An existing document proves nothing: one that is hung holds no camera and reports
  // nothing, which from here looks exactly like one that is working. So ask it.
  if (await hasOffscreen()) {
    if (await hostAnswers()) return
    await chrome.offscreen.closeDocument()
  }

  attached = false
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'Watches posture through the webcam and plays the alert sound.',
    })
  } catch (error) {
    // Whatever went wrong here is invisible otherwise: no document means no reports.
    await reportError(`Could not start the camera: ${(error as Error).message}`)
  }
}

async function stopCameraHost() {
  attached = false
  posture = null
  if (supportsOffscreen && (await hasOffscreen())) await chrome.offscreen.closeDocument()
  await closeWindows(MONITOR_PATH)
}

/** Only a camera host answers this, so silence means there is no healthy one. */
async function hostAnswers() {
  return (await send({ kind: 'host-ping' })) === true
}

/**
 * A host that cannot run is replaced rather than papered over with a visible window: the
 * keepalive alarm builds a fresh one. The Firefox window shows the error itself, so only
 * the invisible host is torn down here.
 */
async function reportError(message: string) {
  attached = false
  await saveLastError(message)
  if (supportsOffscreen && (await hasOffscreen())) await chrome.offscreen.closeDocument()
  await paint()
}

/**
 * The siren needs a document. With nothing running, a sound-only offscreen document is
 * spun up; it plays on load and closes itself, so the test works with the camera off.
 */
async function playTestAlert() {
  if (supportsOffscreen && !(await hasOffscreen())) {
    await chrome.offscreen.createDocument({
      url: `${OFFSCREEN_PATH}?mode=audio`,
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'Plays the posture alert sound.',
    })
    return
  }

  void send({ kind: 'host-siren' })
}

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
  return contexts.length > 0
}

/** A centered window, rather than a badge, so calibration is visible outside the browser. */
async function openCalibrationWindow() {
  if (await isCalibrating()) return

  const created = await chrome.windows.create({
    url: CALIBRATION_PATH,
    type: 'popup',
    width: 380,
    height: 400,
    focused: true,
  })

  // The settings dialog is modal over its own window, so make sure this lands in front.
  if (created?.id !== undefined) {
    void chrome.windows.update(created.id, { focused: true, drawAttention: true })
  }
}

/** Firefox fallback: the camera can only run in a visible page there. */
async function openMonitorWindow() {
  if ((await findTabs(MONITOR_PATH)).length > 0) return
  await chrome.windows.create({
    url: `${MONITOR_PATH}?mode=monitor`,
    type: 'popup',
    width: 420,
    height: 200,
    focused: false,
  })
}

/** The open window is the only record that a calibration is running; a worker is not. */
async function isCalibrating() {
  return (await findTabs(CALIBRATION_PATH)).length > 0
}

function findTabs(path: string) {
  return chrome.tabs.query({ url: chrome.runtime.getURL(`${path}*`) })
}

async function closeWindows(path: string) {
  for (const tab of await findTabs(path)) {
    if (tab.id !== undefined) await chrome.tabs.remove(tab.id).catch(() => undefined)
  }
}

let loaded: Promise<void> | null = null

/** The worker is torn down freely, so nothing may assume it has run before. */
function hydrate() {
  loaded ??= load()
  return loaded
}

async function load() {
  const stored = await loadState()
  settings = stored.settings
  baseline = stored.baseline
  pickVoice()
}

async function dialogState(): Promise<BackgroundState> {
  return { settings, notificationPermission: await notificationPermission() }
}

/**
 * The worker speaks through chrome.tts, which needs no page and no user activation. The
 * siren plays in the host page, so the voice waits for it to finish rather than talking
 * over it.
 */
function speakWarning() {
  if (!settings.speech) return
  setTimeout(speakNow, settings.siren ? VOICE_DELAY_MS : 0)
}

function speakNow() {
  if (!chrome.tts?.speak) {
    void send({ kind: 'host-speak', phrase: ALERT_PHRASE })
    return
  }

  chrome.tts.speak(ALERT_PHRASE, { rate: 0.9, pitch: 0.75, enqueue: false, voiceName })
}

function pickVoice() {
  if (!chrome.tts?.getVoices) return
  chrome.tts.getVoices((voices) => {
    const english = voices.filter((voice) => voice.lang?.startsWith('en'))
    for (const preference of VOICE_PREFERENCES) {
      const match = english.find((voice) => voice.voiceName && preference.test(voice.voiceName))
      if (match) {
        voiceName = match.voiceName
        return
      }
    }
  })
}

async function notificationPermission(): Promise<'granted' | 'denied'> {
  if (!chrome.notifications?.getPermissionLevel) return 'granted'
  return new Promise((resolve) => {
    chrome.notifications.getPermissionLevel((level) =>
      resolve(level === 'granted' ? 'granted' : 'denied'),
    )
  })
}

function notify(title: string, lines: string[]) {
  if (!settings.notifications) return
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title,
    message: lines.join('\n') || 'Bad posture detected',
    priority: 2,
  })
}

async function paint() {
  const suffix = settings.enabled ? '' : '-off'
  void chrome.action.setIcon({
    path: {
      16: `icons/icon16${suffix}.png`,
      32: `icons/icon32${suffix}.png`,
      48: `icons/icon48${suffix}.png`,
      128: `icons/icon128${suffix}.png`,
    },
  })
  void chrome.action.setTitle({ title: iconTitle() })

  const badge = await badgeState()
  void chrome.action.setBadgeText({ text: badge.text })
  void chrome.action.setBadgeBackgroundColor({ color: badge.color })
  if (chrome.action.setBadgeTextColor) void chrome.action.setBadgeTextColor({ color: '#ffffff' })
}

function iconTitle() {
  if (!settings.enabled) return 'Posture Check — off'
  if (!baseline) return 'Posture Check — not calibrated'
  if (posture === false) return 'Posture Check — bad posture'
  return 'Posture Check — on'
}

async function badgeState() {
  if (await isCalibrating()) return BADGE_STARTING
  if (!settings.enabled) return BADGE_CLEAR
  if (posture === false) return BADGE_BAD
  if (baseline && !attached) return BADGE_STARTING
  return BADGE_CLEAR
}
