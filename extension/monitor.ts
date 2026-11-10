import type { PostureStatus } from '../src/index'
import { attachMonitor } from './shared/attach'
import { send } from './shared/messages'
import './styles.css'

const title = element<HTMLHeadingElement>('title')
const status = element<HTMLParagraphElement>('status')
const grantButton = element<HTMLButtonElement>('grant')

const STATUS_TEXT: Record<PostureStatus, string> = {
  idle: 'Camera off',
  loading: 'Starting the camera…',
  ready: 'Ready.',
  calibrating: 'Calibrating posture. Sit up straight.',
  watching: 'Watching your posture.',
  paused: 'Monitoring paused.',
  error: 'Something went wrong.',
}

const mode = new URLSearchParams(location.search).get('mode') ?? 'permission'

if (mode === 'permission') await runPermissionFlow()
else await runMonitor()

/**
 * An offscreen document cannot show a permission prompt, so this window asks once and
 * closes. Chrome remembers the grant for the extension origin from then on.
 */
async function runPermissionFlow() {
  title.textContent = 'Camera access'
  status.textContent = 'Posture Check needs the webcam to watch your posture.'
  grantButton.classList.remove('hidden')

  grantButton.addEventListener('click', async () => {
    grantButton.disabled = true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach((track) => track.stop())
      status.textContent = 'Thanks — starting up.'
      await send({ kind: 'permission-granted' })
    } catch (error) {
      grantButton.disabled = false
      status.textContent = (error as Error).message
    }
  })
}

/** Firefox has no offscreen document, so the camera lives in this window instead. */
async function runMonitor() {
  const { watcher } = await attachMonitor()
  watcher.on('status', (next) => {
    status.textContent = STATUS_TEXT[next]
  })
  watcher.on('calibrating', ({ remainingMs }) => {
    status.textContent = `Calibrating posture. Sit up straight. ${Math.ceil(remainingMs / 1000)}`
  })
  watcher.on('error', (error) => {
    status.textContent = error.message
  })

  status.textContent = 'Keep this window open — Firefox cannot run the camera in the background.'
  try {
    await watcher.start()
    await send({ kind: 'monitor-attached' })
  } catch (error) {
    await send({ kind: 'monitor-error', message: (error as Error).message })
  }
}

function element<T extends HTMLElement>(id: string) {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element #${id}`)
  return node as T
}
