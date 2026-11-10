import type { BackgroundState, Message } from './shared/messages'
import {
  CALIBRATION_SECONDS,
  DEFAULT_SETTINGS,
  loadState,
  readStorage,
  saveBaseline,
  saveSettings,
  writeStorage,
  type Settings,
} from './shared/settings'

const OFFSCREEN_PATH = 'offscreen.html'
const MONITOR_PATH = 'monitor.html'
const CALIBRATION_PATH = 'calibrating.html'
const KEEPALIVE_ALARM = 'posture-check-keepalive'
const ALERT_PHRASE = 'Bad posture alert'
/** Mirrors VOICE_DELAY_MS in src/alerts.ts; the worker cannot import that DOM-only module. */
const VOICE_DELAY_MS = 1350
/** How long the offscreen document gets to open the camera before the window fallback. */
const ATTACH_TIMEOUT_MS = 12000

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

const state: BackgroundState = {
  settings: DEFAULT_SETTINGS,
  baseline: null,
  notificationPermission: 'granted',
  status: 'idle',
  good: null,
  issues: [],
  monitoring: false,
}

const PENDING_KEY = 'calibrationPending'

let permissionWindowId: number | null = null

// The settings dialog is reached through the browser's own Options entry on the icon.
chrome.runtime.onInstalled.addListener(() => void hydrate())

chrome.runtime.onStartup.addListener(() => void sync())

chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 })
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
  await setEnabled(!state.settings.enabled)
}

async function setEnabled(enabled: boolean) {
  state.settings = await saveSettings({ enabled })
  paintIcon()

  if (!enabled) {
    await setCalibrationPending(false)
    clearCalibrationUi()
    await sync()
    return
  }

  await setCalibrationPending(true)
  await sync()
}

async function handle(message: Message, respond: (value: unknown) => void) {
  await hydrate()

  switch (message.kind) {
    case 'get-state':
      respond(state)
      return

    case 'set-settings':
      state.settings = await saveSettings(message.settings)
      broadcastSettings()
      paintIcon()
      respond(state)
      return

    case 'set-enabled':
      await setEnabled(message.enabled)
      respond(state)
      return

    case 'recalibrate':
      await setCalibrationPending(true)
      if (await hasMonitor()) startCalibration()
      else await sync()
      respond(state)
      return

    case 'verify-notifications':
      state.notificationPermission = await notificationPermission()
      // A notification is the only honest test: the OS can silently drop them.
      notify('Notifications are on', ['Posture alerts will appear here.'])
      respond(state)
      return

    case 'test-alert': {
      const spawned = await ensureAudioHost()
      // A freshly spawned host plays on load; an existing monitor has to be asked.
      if (!spawned) {
        void chrome.runtime.sendMessage({ kind: 'monitor-test-alert' }).catch(() => undefined)
      }
      speakWarning()
      notify('Posture alert test', ['This is what an alert looks like.'])
      respond(state)
      return
    }

    case 'permission-granted':
      await writeStorage({ cameraGranted: true })
      closePermissionWindow()
      await sync()
      respond(state)
      return

    case 'monitor-attached':
      state.monitoring = true
      await writeStorage({ monitorAttachedAt: Date.now(), lastError: null })
      if ((await isCalibrationPending()) || !state.baseline) startCalibration()
      respond(state)
      return

    case 'monitor-status':
      state.status = message.status
      respond(state)
      return

    case 'monitor-calibrated':
      await setCalibrationPending(false)
      state.baseline = message.baseline
      await saveBaseline(message.baseline)
      clearCalibrationUi()
      respond(state)
      return

    case 'monitor-absent':
      state.good = null
      state.issues = []
      paintBadge()
      respond(state)
      return

    case 'monitor-posture':
      state.good = message.good
      state.issues = message.issues
      paintBadge()
      respond(state)
      return

    case 'monitor-alert':
      speakWarning()
      notify('Bad Posture Alert', message.issues.map((issue) => issue.message))
      respond(state)
      return

    case 'monitor-error':
      await handleMonitorError(message.message)
      respond(state)
      return

    default:
      respond(state)
  }
}

let hydrated = false

async function hydrate() {
  if (hydrated) return
  const stored = await loadState()
  state.settings = stored.settings
  state.baseline = stored.baseline
  hydrated = true
  pickVoice()
  paintIcon()
  await sync()
}

/** Brings the camera host in line with the current settings. */
async function sync() {
  await hydrate()

  if (!state.settings.enabled) {
    await teardownMonitor()
    return
  }

  if (!supportsOffscreen) {
    await openMonitorWindow()
    return
  }

  if (!(await cameraGranted())) {
    await openPermissionWindow()
    return
  }

  if (await cameraNeedsWindow()) {
    await openMonitorWindow()
    return
  }

  if (!(await hasOffscreen())) {
    await writeStorage({ offscreenCreatedAt: Date.now(), monitorAttachedAt: 0 })
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'Watches posture through the webcam and plays the alert sound.',
    })
    setTimeout(() => void checkAttached(), ATTACH_TIMEOUT_MS)
    return
  }

  await checkAttached()
}

/**
 * Chrome will not always open a camera from an offscreen document. When it does not, the
 * monitor falls back to a small window, which always can.
 */
async function checkAttached() {
  const stored = await readStorage(['offscreenCreatedAt', 'monitorAttachedAt'])
  const created = (stored.offscreenCreatedAt as number | undefined) ?? 0
  const attached = (stored.monitorAttachedAt as number | undefined) ?? 0
  if (created === 0 || attached >= created) return
  if (Date.now() - created < ATTACH_TIMEOUT_MS) return

  await useWindowFallback('The camera would not start in the background.')
}

async function useWindowFallback(reason: string) {
  await writeStorage({ cameraFallback: true, lastError: reason })
  if (supportsOffscreen && (await hasOffscreen())) await chrome.offscreen.closeDocument()
  await openMonitorWindow()
}

async function cameraNeedsWindow() {
  const stored = await readStorage(['cameraFallback'])
  return stored.cameraFallback === true
}

async function teardownMonitor() {
  state.monitoring = false
  state.status = 'idle'
  state.good = null
  paintBadge()

  if (supportsOffscreen && (await hasOffscreen())) await chrome.offscreen.closeDocument()
  await closeCalibrationWindow()
  await closeMonitorWindows()
}

async function handleMonitorError(message: string) {
  state.status = 'error'
  paintBadge()
  await writeStorage({ lastError: message })

  if (/denied|notallowed|permission/i.test(message)) {
    await writeStorage({ cameraGranted: false })
    if (supportsOffscreen && (await hasOffscreen())) await chrome.offscreen.closeDocument()
    await openPermissionWindow()
    return
  }

  // A camera that fails anywhere but a window gets one.
  if (supportsOffscreen && !(await cameraNeedsWindow())) {
    await useWindowFallback(message)
  }
}

async function cameraGranted() {
  const stored = await readStorage(['cameraGranted'])
  return stored.cameraGranted === true
}

async function setCalibrationPending(pending: boolean) {
  await writeStorage({ [PENDING_KEY]: pending })
}

async function isCalibrationPending() {
  const stored = await readStorage([PENDING_KEY])
  return stored[PENDING_KEY] === true
}

/** The worker restarts freely, so monitor presence is read back rather than remembered. */
async function hasMonitor() {
  if (supportsOffscreen) return hasOffscreen()
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL(`${MONITOR_PATH}*`) })
  return tabs.length > 0
}

/**
 * Test alerts have to work with the camera off, so this spins up a sound-only offscreen
 * document when no monitor is already running. It closes itself once the alert is done.
 */
async function ensureAudioHost() {
  if (!supportsOffscreen || (await hasOffscreen())) return false
  await chrome.offscreen.createDocument({
    url: `${OFFSCREEN_PATH}?mode=audio`,
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'Plays the posture alert sound.',
  })
  return true
}

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
  return contexts.length > 0
}

async function openPermissionWindow() {
  if (permissionWindowId !== null) return
  const created = await chrome.windows.create({
    url: `${MONITOR_PATH}?mode=permission`,
    type: 'popup',
    width: 420,
    height: 260,
  })
  permissionWindowId = created?.id ?? null
}

function closePermissionWindow() {
  if (permissionWindowId === null) return
  void chrome.windows.remove(permissionWindowId).catch(() => undefined)
  permissionWindowId = null
}

/** Firefox fallback: the camera can only run in a visible page there. */
async function openMonitorWindow() {
  const existing = await chrome.tabs.query({ url: chrome.runtime.getURL(`${MONITOR_PATH}*`) })
  if (existing.length > 0) return
  await chrome.windows.create({
    url: `${MONITOR_PATH}?mode=monitor`,
    type: 'popup',
    width: 420,
    height: 200,
    focused: false,
  })
}

async function closeMonitorWindows() {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL(`${MONITOR_PATH}*`) })
  for (const tab of tabs) {
    if (tab.id !== undefined) void chrome.tabs.remove(tab.id).catch(() => undefined)
  }
  permissionWindowId = null
}

function startCalibration() {
  void openCalibrationWindow()
  void chrome.runtime
    .sendMessage({ kind: 'monitor-calibrate', seconds: CALIBRATION_SECONDS })
    .catch(() => undefined)
}

/** A centered window, rather than a badge, so calibration is visible outside the browser. */
async function openCalibrationWindow() {
  const url = `${CALIBRATION_PATH}?seconds=${CALIBRATION_SECONDS}`
  const existing = await chrome.tabs.query({ url: chrome.runtime.getURL(`${CALIBRATION_PATH}*`) })
  if (existing.length > 0) return

  await chrome.windows.create({ url, type: 'popup', width: 360, height: 190, focused: true })
}

async function closeCalibrationWindow() {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL(`${CALIBRATION_PATH}*`) })
  for (const tab of tabs) {
    if (tab.id !== undefined) void chrome.tabs.remove(tab.id).catch(() => undefined)
  }
}

function clearCalibrationUi() {
  void closeCalibrationWindow()
  paintIcon()
}

let voiceName: string | undefined

/**
 * The worker speaks through chrome.tts, which needs no page and no user activation. The
 * siren plays in the monitor page, so the voice waits for it to finish rather than
 * talking over it.
 */
function speakWarning() {
  if (!state.settings.speech) return
  setTimeout(speakNow, state.settings.siren ? VOICE_DELAY_MS : 0)
}

function speakNow() {
  if (!chrome.tts?.speak) {
    void chrome.runtime
      .sendMessage({ kind: 'monitor-speak', phrase: ALERT_PHRASE })
      .catch(() => undefined)
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
  if (!state.settings.notifications) return
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title,
    message: lines.join('\n') || 'Bad posture detected',
    priority: 2,
  })
}

function broadcastSettings() {
  void chrome.runtime
    .sendMessage({ kind: 'monitor-settings', settings: state.settings })
    .catch(() => undefined)
}

function paintIcon() {
  const suffix = state.settings.enabled ? '' : '-off'
  void chrome.action.setTitle({ title: iconTitle() })
  void chrome.action.setIcon({
    path: {
      16: `icons/icon16${suffix}.png`,
      32: `icons/icon32${suffix}.png`,
      48: `icons/icon48${suffix}.png`,
      128: `icons/icon128${suffix}.png`,
    },
  })
  paintBadge()
}

function paintBadge() {
  void chrome.action.setBadgeText({ text: badgeText() })
  void chrome.action.setBadgeBackgroundColor({ color: '#e2503f' })
  if (chrome.action.setBadgeTextColor) void chrome.action.setBadgeTextColor({ color: '#ffffff' })
}

function iconTitle() {
  if (!state.settings.enabled) return 'Posture Check — off'
  if (state.good === false) return 'Posture Check — bad posture'
  return 'Posture Check — on'
}

function badgeText() {
  if (!state.settings.enabled) return ''
  return state.good === false ? '!' : ''
}

export type { Settings }
