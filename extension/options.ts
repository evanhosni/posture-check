import type { PostureStatus } from '../src/index'
import type { BackgroundState, Message } from './shared/messages'
import { readStorage, type Settings } from './shared/settings'
import './styles.css'

const STATUS_TEXT: Record<PostureStatus, string> = {
  idle: 'Off',
  loading: 'Starting the camera…',
  ready: 'Ready.',
  calibrating: 'Calibrating posture. Sit up straight.',
  watching: 'Watching your posture.',
  paused: 'Paused.',
  error: 'Something went wrong.',
}

const enabledInput = element<HTMLInputElement>('enabled')
const enabledLabel = element<HTMLSpanElement>('enabledLabel')
const sensitivityInput = element<HTMLInputElement>('sensitivity')
const sensitivityValue = element<HTMLSpanElement>('sensitivityValue')
const holdInput = element<HTMLInputElement>('hold')
const holdValue = element<HTMLSpanElement>('holdValue')
const soundInput = element<HTMLInputElement>('sound')
const notificationsInput = element<HTMLInputElement>('notifications')
const recalibrateButton = element<HTMLButtonElement>('recalibrate')
const testButton = element<HTMLButtonElement>('test')
const liveStatus = element<HTMLParagraphElement>('liveStatus')
const lastError = element<HTMLParagraphElement>('lastError')
const notificationHint = element<HTMLParagraphElement>('notificationHint')

render((await chrome.runtime.sendMessage({ kind: 'get-state' })) as BackgroundState)
void showLastError()

async function showLastError() {
  const stored = await readStorage(['lastError'])
  lastError.textContent = (stored.lastError as string | null) ?? ''
}

enabledInput.addEventListener('change', async () => {
  const next = (await chrome.runtime.sendMessage({
    kind: 'set-enabled',
    enabled: enabledInput.checked,
  })) as BackgroundState
  render(next)
})

bindRange(sensitivityInput, sensitivityValue, (value) => String(value), (sensitivity) => ({
  sensitivity,
}))
bindRange(holdInput, holdValue, (value) => `${value}s`, (holdSeconds) => ({ holdSeconds }))

soundInput.addEventListener('change', () => {
  void update({ siren: soundInput.checked, speech: soundInput.checked })
})

notificationsInput.addEventListener('change', async () => {
  await update({ notifications: notificationsInput.checked })
  if (!notificationsInput.checked) {
    notificationHint.replaceChildren()
    return
  }

  const state = (await chrome.runtime.sendMessage({
    kind: 'verify-notifications',
  })) as BackgroundState
  showNotificationHint(state.notificationPermission)
})

/**
 * Neither browser exposes the operating system's own notification switch, so this sends a
 * real notification and offers the system settings for when it does not show up.
 */
function showNotificationHint(permission: BackgroundState['notificationPermission']) {
  const blocked = permission === 'denied'
  const message = blocked
    ? 'Notifications are blocked for this browser. Turn them on in system settings:'
    : 'Sent a test notification. Nothing appeared? Turn them on in system settings:'

  notificationHint.replaceChildren(document.createTextNode(message))

  const url = systemSettingsUrl()
  if (!url) return

  const link = document.createElement('a')
  link.href = url
  link.textContent = 'Open system settings'
  notificationHint.append(' ', link)
}

function systemSettingsUrl() {
  if (navigator.userAgent.includes('Mac')) {
    return 'x-apple.systempreferences:com.apple.Notifications-Settings.extension'
  }
  if (navigator.userAgent.includes('Windows')) return 'ms-settings:notifications'
  return null
}

recalibrateButton.addEventListener('click', () => {
  liveStatus.textContent = STATUS_TEXT.calibrating
  void chrome.runtime.sendMessage({ kind: 'recalibrate' })
})

testButton.addEventListener('click', () => {
  void chrome.runtime.sendMessage({ kind: 'test-alert' })
})

// The toolbar badge is hidden behind this dialog, so progress is mirrored here.
chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.kind === 'monitor-calibrating') {
    const seconds = Math.max(1, Math.ceil(message.remainingMs / 1000))
    liveStatus.textContent = `${STATUS_TEXT.calibrating} ${seconds}s`
  }
  if (message.kind === 'monitor-calibrated') liveStatus.textContent = STATUS_TEXT.watching
  if (message.kind === 'monitor-status') liveStatus.textContent = STATUS_TEXT[message.status]
  if (message.kind === 'monitor-absent') liveStatus.textContent = 'Nobody in frame.'
  if (message.kind === 'monitor-posture') {
    liveStatus.textContent = message.good ? 'Posture looks good.' : 'Bad posture.'
  }
  if (message.kind === 'monitor-error') lastError.textContent = message.message
})

function bindRange(
  input: HTMLInputElement,
  output: HTMLElement,
  format: (value: number) => string,
  toSettings: (value: number) => Partial<Settings>,
) {
  input.addEventListener('input', () => {
    output.textContent = format(Number(input.value))
  })
  input.addEventListener('change', () => {
    void update(toSettings(Number(input.value)))
  })
}

async function update(settings: Partial<Settings>) {
  const next = (await chrome.runtime.sendMessage({
    kind: 'set-settings',
    settings,
  })) as BackgroundState
  render(next)
}

function render(state: BackgroundState) {
  enabledInput.checked = state.settings.enabled
  enabledLabel.textContent = state.settings.enabled ? 'On' : 'Off'
  sensitivityInput.value = String(state.settings.sensitivity)
  sensitivityValue.textContent = String(state.settings.sensitivity)
  holdInput.value = String(state.settings.holdSeconds)
  holdValue.textContent = `${state.settings.holdSeconds}s`
  soundInput.checked = state.settings.siren || state.settings.speech
  notificationsInput.checked = state.settings.notifications
  liveStatus.textContent = state.settings.enabled ? STATUS_TEXT[state.status] : STATUS_TEXT.idle
}

function element<T extends HTMLElement>(id: string) {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element #${id}`)
  return node as T
}
