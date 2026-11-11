import { playSiren } from '../src/index'
import { createWatcher, runCameraHost } from './shared/host'

/** Sound-only hosts close themselves once the alert they were created for has played. */
const AUDIO_HOST_LIFETIME_MS = 8000

if (new URLSearchParams(location.search).get('mode') === 'audio') {
  // This document exists to play one test alert, so it does not wait to be asked: a
  // message sent before this script finished loading would have been dropped.
  playSiren()
  setTimeout(() => window.close(), AUDIO_HOST_LIFETIME_MS)
} else {
  // An offscreen document is never painted, so it has no reliable GPU surface to infer on.
  await runCameraHost(createWatcher({ delegate: 'CPU' }))
}
