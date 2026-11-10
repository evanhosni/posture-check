import { attachMonitor } from './shared/attach'
import { send } from './shared/messages'

/** Sound-only hosts close themselves once the alert they were created for has played. */
const AUDIO_HOST_LIFETIME_MS = 8000

const audioOnly = new URLSearchParams(location.search).get('mode') === 'audio'
const { watcher } = await attachMonitor()

if (audioOnly) {
  // This document exists only to play one test alert, so it does not wait to be asked:
  // a message sent before this script finished loading would have been dropped.
  watcher.testAlert()
  setTimeout(() => window.close(), AUDIO_HOST_LIFETIME_MS)
} else {
  try {
    await watcher.start()
    void send({ kind: 'monitor-attached' })
  } catch (error) {
    void send({ kind: 'monitor-error', message: (error as Error).message })
  }
}
