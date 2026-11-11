import type { PostureStatus } from '../src/index'
import { element } from './shared/dom'
import { createWatcher, runCameraHost } from './shared/host'
import './styles.css'

const STATUS_TEXT: Record<PostureStatus, string> = {
  idle: 'Camera off',
  loading: 'Starting the camera…',
  ready: 'Ready.',
  calibrating: 'Calibrating posture. Sit up straight.',
  watching: 'Watching your posture.',
  paused: 'Monitoring paused.',
  error: 'Something went wrong.',
}

const status = element<HTMLParagraphElement>('status')

/** Firefox has no offscreen document, so on that browser the camera lives in this window. */
const watcher = createWatcher()

watcher.on('status', (next) => {
  status.textContent = STATUS_TEXT[next]
})
watcher.on('error', (error) => {
  status.textContent = error.message
})

status.textContent = 'Keep this window open — Firefox cannot run the camera in the background.'

await runCameraHost(watcher)
