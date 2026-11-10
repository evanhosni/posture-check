import type { AlertOptions } from './types'

export const SIREN_MS = 1200

/** Gap between the siren ending and the voice starting, so the two never overlap. */
export const VOICE_DELAY_MS = SIREN_MS + 150

/**
 * Voice availability varies by machine, so this is a preference order rather than a name:
 * Chrome's neural Google voices first, then Apple's premium/Siri voices, then the newer
 * macOS system voices, with the older Samantha generation last.
 */
export const DEFAULT_VOICE_PREFERENCES = [
  /google (us|uk) english(?!.*male)/i,
  /\b(ava|zoe|allison|nicky|siri)\b/i,
  /premium|enhanced|neural|natural/i,
  /\b(sandy|flo|shelley|kathy)\b/i,
  /samantha|victoria|karen|moira|tessa|fiona|zira|female/i,
]

export const DEFAULT_ALERT_OPTIONS: Required<AlertOptions> = {
  notification: true,
  siren: true,
  speech: true,
  phrase: 'Bad posture alert',
  title: 'Fix your posture',
  voicePreferences: DEFAULT_VOICE_PREFERENCES,
  pitch: 0.75,
  rate: 0.9,
  volume: 1,
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported' as const
  if (Notification.permission === 'default') return Notification.requestPermission()
  return Notification.permission
}

export function sendNotification(title: string, body: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  new Notification(title, { body, tag: 'posture-check', renotify: true } as NotificationOptions)
}

const SIREN_SAMPLE_RATE = 22050
const WAIL_MS = 600

let sirenUri: string | null = null

/**
 * The siren is synthesized to a WAV data URI and played through an <audio> element rather
 * than the Web Audio API: an AudioContext in a document that has never had user activation
 * — an extension's offscreen document, for instance — stays suspended and never sounds.
 */
export function playSiren(durationMs = SIREN_MS) {
  sirenUri ??= renderSiren(durationMs)
  const element = new Audio(sirenUri)
  element.volume = 0.6
  void element.play().catch(() => undefined)
}

function renderSiren(durationMs: number) {
  const total = Math.floor((durationMs / 1000) * SIREN_SAMPLE_RATE)
  const samples = new Int16Array(total)
  const seconds = durationMs / 1000
  let phase = 0

  for (let i = 0; i < total; i += 1) {
    const t = i / SIREN_SAMPLE_RATE
    const wail = ((t * 1000) % WAIL_MS) / WAIL_MS
    const frequency = 520 + 460 * Math.sin(Math.PI * wail)
    phase += (2 * Math.PI * frequency) / SIREN_SAMPLE_RATE

    const tone = Math.sin(phase) * 0.7 + Math.sign(Math.sin(phase)) * 0.3
    const envelope = Math.min(1, t / 0.03, (seconds - t) / 0.12)
    samples[i] = clamp(tone * envelope) * 0.5 * 32767
  }
  return `data:audio/wav;base64,${encodeWav(samples)}`
}

function clamp(value: number) {
  return Math.max(-1, Math.min(1, value))
}

function encodeWav(samples: Int16Array) {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SIREN_SAMPLE_RATE, true)
  view.setUint32(28, SIREN_SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)

  for (let i = 0; i < samples.length; i += 1) view.setInt16(44 + i * 2, samples[i], true)
  return toBase64(bytes)
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
}

function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

let voice: SpeechSynthesisVoice | null = null
let voicePreferences = DEFAULT_VOICE_PREFERENCES

export function speak(phrase: string, options: Pick<AlertOptions, 'pitch' | 'rate' | 'volume'> = {}) {
  if (!('speechSynthesis' in window)) return

  voice ??= pickVoice()
  const utterance = new SpeechSynthesisUtterance(phrase)
  if (voice) utterance.voice = voice
  utterance.pitch = options.pitch ?? DEFAULT_ALERT_OPTIONS.pitch
  utterance.rate = options.rate ?? DEFAULT_ALERT_OPTIONS.rate
  utterance.volume = options.volume ?? DEFAULT_ALERT_OPTIONS.volume

  speechSynthesis.cancel()
  speechSynthesis.speak(utterance)
}

/** Replaces the voice preference order and re-picks. Pass nothing to restore the default. */
export function setVoicePreferences(preferences = DEFAULT_VOICE_PREFERENCES) {
  voicePreferences = preferences
  voice = pickVoice()
}

export function listVoices() {
  return 'speechSynthesis' in window ? speechSynthesis.getVoices() : []
}

function pickVoice() {
  const all = listVoices()
  const voices = all.filter((candidate) => candidate.lang.startsWith('en'))
  if (voices.length === 0) return all[0] ?? null

  for (const preference of voicePreferences) {
    const match = voices.find((candidate) => preference.test(candidate.name))
    if (match) return match
  }
  return voices[0]
}

// Chrome populates the voice list asynchronously after the first call returns empty.
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  speechSynthesis.addEventListener('voiceschanged', () => {
    voice = pickVoice()
  })
}

/** Fires the siren, the voice and the desktop notification that the options ask for. */
export function playAlert(body: string, options: AlertOptions = {}) {
  const settings = { ...DEFAULT_ALERT_OPTIONS, ...options }
  if (settings.voicePreferences !== voicePreferences) setVoicePreferences(settings.voicePreferences)

  if (settings.notification) sendNotification(settings.title, body)
  if (settings.siren) playSiren()
  if (settings.speech) {
    const delay = settings.siren ? VOICE_DELAY_MS : 0
    window.setTimeout(() => speak(settings.phrase, settings), delay)
  }
}
