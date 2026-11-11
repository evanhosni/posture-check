import { drawPose } from '../src/index'
import { element } from './shared/dom'
import { createWatcher } from './shared/host'
import { send } from './shared/messages'
import { CALIBRATION_SECONDS } from './shared/settings'
import './styles.css'

/** Just enough easing to smooth the gaps between detections without lagging behind them. */
const BAR_EASING_MS = 120

const preview = element<HTMLVideoElement>('preview')
const overlay = element<HTMLCanvasElement>('overlay')
const status = element<HTMLParagraphElement>('status')
const allowButton = element<HTMLButtonElement>('allow')
const bar = element<HTMLDivElement>('bar')
const context = overlay.getContext('2d')!

bar.style.transition = `width ${BAR_EASING_MS}ms linear`
centerOnScreen()

/**
 * This window owns the camera for the length of a calibration. It is the only context
 * that can raise the permission prompt, and running the capture here means the picture
 * on screen is the one being measured.
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

allowButton.addEventListener('click', () => void calibrate())
void calibrate()

async function calibrate() {
  allowButton.disabled = true
  status.textContent = 'Waiting for camera access…'

  try {
    await watcher.start()
    allowButton.classList.add('hidden')
    status.textContent = 'Sit up straight.'

    const baseline = await watcher.calibrate(CALIBRATION_SECONDS * 1000)
    bar.style.width = '100%'

    // Release the camera and wait for the baseline to be acknowledged: closing this window
    // with that message still in flight would throw the calibration away. The worker
    // normally closes this window itself once it has stored it.
    watcher.stop()
    await send({ kind: 'calibrated', baseline })
    window.close()
  } catch (error) {
    const message = (error as Error).message
    status.textContent = message
    watcher.stop()
    allowButton.classList.remove('hidden')
    allowButton.disabled = false
    await send({ kind: 'calibration-failed', message })
  }
}

function centerOnScreen() {
  const left = Math.round((screen.availWidth - window.outerWidth) / 2)
  const top = Math.round((screen.availHeight - window.outerHeight) / 3)
  void chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { left, top })
}
