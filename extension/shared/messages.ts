import type { PostureIssue, PostureStatus } from '../../src/index'
import type { Settings, StoredState } from './settings'

/** Sent by the settings page to the background worker. */
export type Command =
  | { kind: 'get-state' }
  | { kind: 'set-settings'; settings: Partial<Settings> }
  | { kind: 'set-enabled'; enabled: boolean }
  | { kind: 'recalibrate' }
  | { kind: 'test-alert' }
  | { kind: 'verify-notifications' }

/** Sent by whichever page is running the camera. */
export type MonitorReport =
  | { kind: 'monitor-attached' }
  | { kind: 'monitor-status'; status: PostureStatus }
  | { kind: 'monitor-calibrating'; progress: number; remainingMs: number }
  | { kind: 'monitor-calibrated'; baseline: StoredState['baseline'] }
  | { kind: 'monitor-posture'; good: boolean; issues: PostureIssue[] }
  | { kind: 'monitor-absent' }
  | { kind: 'monitor-alert'; issues: PostureIssue[] }
  | { kind: 'monitor-error'; message: string }
  | { kind: 'permission-granted' }

/** Sent by the background worker to the monitor pages. */
export type MonitorCommand =
  | { kind: 'monitor-settings'; settings: Settings }
  | { kind: 'monitor-calibrate'; seconds: number }
  | { kind: 'monitor-test-alert' }
  | { kind: 'monitor-speak'; phrase: string }

export type Message = Command | MonitorReport | MonitorCommand

export interface BackgroundState extends StoredState {
  /** Whether the browser itself will show notifications; the OS may still block them. */
  notificationPermission: 'granted' | 'denied'
  status: PostureStatus
  good: boolean | null
  issues: PostureIssue[]
  monitoring: boolean
}

export function send(message: Message) {
  return chrome.runtime.sendMessage(message).catch(() => undefined)
}
