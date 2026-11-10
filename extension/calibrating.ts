import type { Message } from './shared/messages'
import { CALIBRATION_SECONDS } from './shared/settings'
import './styles.css'

/** Closes itself if calibration never reports back, so the window cannot be orphaned. */
const SAFETY_MARGIN_MS = 8000
/** Just enough easing to smooth the gaps between ticks without lagging behind them. */
const BAR_EASING_MS = 120

const bar = element<HTMLDivElement>('bar')
const seconds = Number(new URLSearchParams(location.search).get('seconds')) || CALIBRATION_SECONDS

bar.style.transition = `width ${BAR_EASING_MS}ms linear`
centerOnScreen()

// The bar tracks the monitor's own progress rather than a local animation, so it cannot
// run ahead of a calibration that started late or stalled.
chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.kind === 'monitor-calibrating') {
    bar.style.width = `${Math.round(Math.min(1, Math.max(0, message.progress)) * 100)}%`
  }
  if (message.kind === 'monitor-calibrated') {
    bar.style.width = '100%'
    window.close()
  }
})

setTimeout(() => window.close(), seconds * 1000 + SAFETY_MARGIN_MS)

function centerOnScreen() {
  const left = Math.round((screen.availWidth - window.outerWidth) / 2)
  const top = Math.round((screen.availHeight - window.outerHeight) / 3)
  void chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { left, top })
}

function element<T extends HTMLElement>(id: string) {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element #${id}`)
  return node as T
}
