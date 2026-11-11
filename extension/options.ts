import type { BackgroundState, Command } from './shared/messages'
import { element } from './shared/dom'
import { loadLastError, onLastErrorChanged, type Settings } from './shared/settings'
import './styles.css'

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
const lastError = element<HTMLParagraphElement>('lastError')
const notificationHint = element<HTMLParagraphElement>('notificationHint')

render(await command({ kind: 'get-state' }))

// Only failures are worth reporting here; posture itself shows on the toolbar icon.
lastError.textContent = await loadLastError()
onLastErrorChanged((message) => {
  lastError.textContent = message
})

enabledInput.addEventListener('change', async () => {
  render(await command({ kind: 'set-enabled', enabled: enabledInput.checked }))
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

  const state = await command({ kind: 'verify-notifications' })
  showNotificationHint(state.notificationPermission)
})

recalibrateButton.addEventListener('click', () => {
  void command({ kind: 'recalibrate' })
})

testButton.addEventListener('click', () => {
  void command({ kind: 'test-alert' })
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
  render(await command({ kind: 'set-settings', settings }))
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
}

async function command(message: Command): Promise<BackgroundState> {
  return (await chrome.runtime.sendMessage(message)) as BackgroundState
}
