import type { PostureMetrics } from '../../src/index'

export interface Settings {
  enabled: boolean
  /** 1-10, shown as-is in settings. Converted with sensitivityMultiplier(). */
  sensitivity: number
  holdSeconds: number
  repeatAlertSeconds: number
  siren: boolean
  speech: boolean
  notifications: boolean
}

export interface StoredState {
  settings: Settings
  baseline: PostureMetrics | null
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  sensitivity: 5,
  holdSeconds: 5,
  repeatAlertSeconds: 60,
  siren: true,
  speech: true,
  notifications: false,
}

export const SENSITIVITY_RANGE = { min: 1, max: 10 }

/** Long enough to average out fidgeting, short enough to sit still for. */
export const CALIBRATION_SECONDS = 5

const LAST_ERROR_KEY = 'lastError'

/**
 * Maps the 1-10 dial onto the watcher's threshold scale. Doubling every five steps puts
 * the midpoint at 1.0 — the neutral setting — and keeps both ends usable: 1 is about
 * 0.57 (forgiving) and 10 is 2.0 (twitchy).
 */
export function sensitivityMultiplier(sensitivity: number) {
  const clamped = Math.min(SENSITIVITY_RANGE.max, Math.max(SENSITIVITY_RANGE.min, sensitivity))
  return 2 ** ((clamped - 5) / 5)
}

export async function loadState(): Promise<StoredState> {
  const stored = await readStorage(['settings', 'baseline'])
  return {
    settings: { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings> | undefined) },
    baseline: (stored.baseline as PostureMetrics | null) ?? null,
  }
}

export async function saveSettings(settings: Partial<Settings>) {
  const current = await loadState()
  const next = { ...current.settings, ...settings }
  await writeStorage({ settings: next })
  return next
}

export async function saveBaseline(baseline: PostureMetrics | null) {
  await writeStorage({ baseline })
}

export async function loadLastError(): Promise<string> {
  const stored = await readStorage([LAST_ERROR_KEY])
  return (stored[LAST_ERROR_KEY] as string | null) ?? ''
}

export async function saveLastError(message: string | null) {
  await writeStorage({ [LAST_ERROR_KEY]: message })
}

/** How the settings dialog follows the worker: storage is the only thing both can see. */
export function onLastErrorChanged(handler: (message: string) => void) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[LAST_ERROR_KEY]) return
    handler((changes[LAST_ERROR_KEY].newValue as string | null) ?? '')
  })
}

/**
 * Reloading an unpacked extension invalidates the contexts the old build left open, and
 * their in-flight storage calls throw. Those pages are about to be replaced, so a failed
 * read falls back to defaults rather than surfacing as an uncaught error.
 */
async function readStorage(keys: string[]): Promise<Record<string, unknown>> {
  try {
    return await chrome.storage.local.get(keys)
  } catch {
    return {}
  }
}

async function writeStorage(values: Record<string, unknown>) {
  try {
    await chrome.storage.local.set(values)
  } catch {
    // The context is gone; nothing left to persist to.
  }
}
