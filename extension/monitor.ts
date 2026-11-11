import { drawPose } from '../src/index'
import { element } from './shared/dom'
import { createWatcher, runCameraHost } from './shared/host'
import { send, type Message } from './shared/messages'
import { CALIBRATION_SECONDS, loadState } from './shared/settings'
import './styles.css'

/** Just enough easing to smooth the gaps between detections without lagging behind them. */
const BAR_EASING_MS = 120
const CAPTURE_SIZE = { width: 380, height: 440 }
const WATCHING_SIZE = { width: 320, height: 104 }
/** Clear of the toolbar, so it sits under the icon rather than over the page. */
const WATCHING_MARGIN = 16

const title = element<HTMLHeadingElement>('title')
const status = element<HTMLParagraphElement>('status')
const posture = element<HTMLParagraphElement>('posture')
const capture = element<HTMLDivElement>('capture')
const strip = element<HTMLDivElement>('strip')
const preview = element<HTMLVideoElement>('preview')
const overlay = element<HTMLCanvasElement>('overlay')
const bar = element<HTMLDivElement>('bar')
const allowButton = element<HTMLButtonElement>('allow')
const settingsButton = element<HTMLButtonElement>('settings')
const powerButton = element<HTMLButtonElement>('power')
const context = overlay.getContext('2d')!

/**
 * Firefox refuses a camera to every background context, so this window is the camera, and
 * everything the extension needs to show lives in it: the calibration, then a compact strip
 * that says it is watching and lets it be turned off.
 */
const watcher = createWatcher({ video: preview })

watcher.on('calibrating', ({ progress }) => {
  bar.style.width = `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`
})

watcher.on('frame', ({ landmarks }) => {
  if (preview.videoWidth && overlay.width !== preview.videoWidth) {
    overlay.width = preview.videoWidth
    overlay.height = preview.videoHeight
  }
  drawPose(context, landmarks, { color: '#f2794b' })
})

watcher.on('posture', ({ good }) => {
  posture.textContent = good ? 'Watching your posture.' : 'Sit up straight.'
})

bar.style.transition = `width ${BAR_EASING_MS}ms linear`
settingsButton.addEventListener('click', () => chrome.runtime.openOptionsPage())
allowButton.addEventListener('click', () => void begin())
powerButton.addEventListener('click', () => void send({ kind: 'set-enabled', enabled: false }))

chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.kind === 'host-recalibrate') void calibrate()
})

void begin()

async function begin() {
  allowButton.disabled = true
  allowButton.classList.add('hidden')
  showCapture('Waiting for camera access…')

  const stored = await loadState()
  await runCameraHost(watcher)

  if (watcher.status === 'idle' || watcher.status === 'error') {
    status.textContent = 'The camera did not start.'
    allowButton.classList.remove('hidden')
    allowButton.disabled = false
    return
  }

  if (stored.baseline && !new URLSearchParams(location.search).has('recalibrate')) {
    watch()
    return
  }
  await calibrate()
}

async function calibrate() {
  showCapture('Sit up straight.')
  bar.style.width = '0%'

  try {
    const baseline = await watcher.calibrate(CALIBRATION_SECONDS * 1000)
    bar.style.width = '100%'
    await send({ kind: 'calibrated', baseline })
    watch()
  } catch (error) {
    const message = (error as Error).message
    status.textContent = message
    await send({ kind: 'calibration-failed', message })
  }
}

function showCapture(message: string) {
  status.textContent = message
  title.classList.remove('hidden')
  status.classList.remove('hidden')
  capture.classList.remove('hidden')
  strip.classList.add('hidden')
  document.body.classList.remove('watching')
  // A recalibration asks the user to sit still for the camera, so it has to be in front
  // of whatever they were doing rather than behind it.
  resize(CAPTURE_SIZE, { raise: true })
}

/** Shrinks to a strip that reports and can be switched off, and nothing more. */
function watch() {
  posture.textContent = 'Watching your posture.'
  title.classList.add('hidden')
  status.classList.add('hidden')
  capture.classList.add('hidden')
  strip.classList.remove('hidden')
  document.body.classList.add('watching')
  resize(WATCHING_SIZE, { corner: true })
}

function resize(
  { width, height }: { width: number; height: number },
  { corner = false, raise = false } = {},
) {
  const left = corner
    ? screen.availWidth - width - WATCHING_MARGIN
    : (screen.availWidth - width) / 2
  const top = corner ? WATCHING_MARGIN : (screen.availHeight - height) / 3

  void chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, {
    width,
    height,
    left: Math.round(left),
    top: Math.round(top),
    focused: raise || undefined,
    drawAttention: raise || undefined,
  })
}
