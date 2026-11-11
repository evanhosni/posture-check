import type { PostureIssue, PostureMetrics } from '../../src/index'
import type { Settings } from './settings'

/** Sent by the settings dialog to the background worker. Answered with BackgroundState. */
export type Command =
  | { kind: 'get-state' }
  | { kind: 'set-settings'; settings: Partial<Settings> }
  | { kind: 'set-enabled'; enabled: boolean }
  | { kind: 'recalibrate' }
  | { kind: 'test-alert' }
  | { kind: 'verify-notifications' }

/** Sent to the background worker by the camera host and the calibration window. */
export type Report =
  | { kind: 'host-attached' }
  | { kind: 'host-posture'; good: boolean | null }
  | { kind: 'host-alert'; issues: PostureIssue[] }
  | { kind: 'host-error'; message: string }
  | { kind: 'calibrated'; baseline: PostureMetrics }
  | { kind: 'calibration-failed'; message: string }

/** Sent by the background worker to the camera host. */
export type HostCommand =
  | { kind: 'host-settings'; settings: Settings; baseline: PostureMetrics | null }
  | { kind: 'host-siren' }
  | { kind: 'host-speak'; phrase: string }
  | { kind: 'host-ping' }
  | { kind: 'host-recalibrate' }

export type Message = Command | Report | HostCommand

/** The settings dialog's view of the worker. */
export interface BackgroundState {
  settings: Settings
  /** Whether the browser itself will show notifications; the OS may still block them. */
  notificationPermission: 'granted' | 'denied'
}

/** What a camera host needs to score posture, since it cannot read storage itself. */
export interface HostSettings {
  settings: Settings
  baseline: PostureMetrics | null
}

export async function send(message: Message): Promise<unknown> {
  try {
    return await chrome.runtime.sendMessage(message)
  } catch {
    // Nothing is listening: the worker is the only context guaranteed to be there.
    return undefined
  }
}
