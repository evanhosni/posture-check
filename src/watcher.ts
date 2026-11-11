import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { playAlert, requestNotificationPermission } from './alerts'
import { Emitter } from './events'
import { average, evaluate, measure, smooth } from './metrics'
import { createPoseLandmarker } from './pose'
import type {
  AlertOptions,
  PostureEvents,
  PostureIssue,
  PostureMetrics,
  PostureStats,
  PostureStatus,
  PostureWatcherOptions,
} from './types'

/** Frames without a person before the bad-posture run is abandoned. */
const ABSENT_FRAMES = 3
/**
 * Frames of an unbroken sighting before posture is scored again. A single frame of a
 * hallucinated skeleton is enough to fire an alert at an empty chair, and that is what
 * this waits out.
 */
const PRESENT_FRAMES = 5
/** How long past its window a calibration waits for someone to appear before giving up. */
const CALIBRATION_GRACE_MS = 5000
/** Ticks of a frozen feed before the element is nudged back into playing. */
const STALL_TICKS = 20
/** A start that has not finished by now is stuck, and silence is worse than an error. */
const START_TIMEOUT_MS = 20000

const DEFAULTS = {
  sensitivity: 1,
  holdSeconds: 6,
  repeatAlertSeconds: 60,
  recoverySeconds: 3,
  calibrationMs: 2500,
  fps: 10,
  smoothing: 0.25,
  autoEnable: true,
  constraints: { video: { width: 1280, height: 720, facingMode: 'user' } } as MediaStreamConstraints,
}

export class PostureWatcher {
  private readonly emitter = new Emitter<PostureEvents>()
  private readonly options: PostureWatcherOptions
  private readonly video: HTMLVideoElement
  private readonly ownsVideo: boolean

  private landmarker: PoseLandmarker | null = null
  private stream: MediaStream | null = null
  private ownsStream = false
  private running = false
  private timer = 0

  private state: PostureStatus = 'idle'
  private enabled: boolean
  private current: PostureMetrics | null = null
  private baselineMetrics: PostureMetrics | null
  private lastVideoTime = -1
  private lastDetectAt = 0

  private calibration: {
    samples: PostureMetrics[]
    startedAt: number
    endsAt: number
    resolve: (metrics: PostureMetrics) => void
    reject: (error: Error) => void
  } | null = null

  private wasGood: boolean | null = null
  private absentStreak = 0
  private presentStreak = 0
  private stalledTicks = 0
  private badSince = 0
  private goodSince = 0
  private lastAlertAt = 0
  private stats: PostureStats = { goodMs: 0, badMs: 0, alerts: 0, startedAt: Date.now() }

  constructor(options: PostureWatcherOptions = {}) {
    this.options = { ...DEFAULTS, ...options }
    this.baselineMetrics = options.baseline ?? null
    this.enabled = this.options.autoEnable !== false
    this.ownsVideo = !options.video
    this.video = options.video ?? createHiddenVideo()
  }

  get status() {
    return this.state
  }

  get baseline() {
    return this.baselineMetrics
  }

  get isEnabled() {
    return this.enabled
  }

  get videoElement() {
    return this.video
  }

  on<K extends keyof PostureEvents>(event: K, handler: (payload: PostureEvents[K]) => void) {
    return this.emitter.on(event, handler)
  }

  off<K extends keyof PostureEvents>(event: K, handler: (payload: PostureEvents[K]) => void) {
    this.emitter.off(event, handler)
  }

  /** Loads the model, opens the camera and starts detecting. */
  async start() {
    if (this.running) return
    try {
      this.setStatus('loading')
      this.landmarker ??= await deadline(
        createPoseLandmarker({
          wasmPath: this.options.wasmPath,
          modelPath: this.options.modelPath,
          delegate: this.options.delegate,
        }),
        'Loading the pose model timed out',
      )

      if (!this.stream) {
        this.stream = this.options.stream ?? null
        if (!this.stream) {
          this.stream = await deadline(
            navigator.mediaDevices.getUserMedia(this.options.constraints!),
            'Opening the camera timed out',
          )
          this.ownsStream = true
        }
      }

      this.video.srcObject = this.stream
      await this.video.play()

      if (this.alertOptions?.notification) await requestNotificationPermission()

      this.running = true
      this.setStatus(this.monitoring ? 'watching' : 'ready')
      this.schedule()
    } catch (error) {
      this.setStatus('error')
      this.fail(error)
      throw error
    }
  }

  /** Stops detection and releases the camera. The baseline is kept. */
  stop() {
    this.running = false
    window.clearTimeout(this.timer)

    if (this.ownsStream) this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.ownsStream = false
    this.video.srcObject = null

    this.calibration?.reject(new Error('Posture watcher stopped during calibration'))
    this.calibration = null
    this.current = null
    this.lastVideoTime = -1
    this.resetRun()
    this.setStatus('idle')
  }

  /**
   * Captures the current pose as the reference for good posture. Resolves with the
   * baseline, which can be stored and passed back in as `baseline` later.
   */
  calibrate(durationMs = this.options.calibrationMs!) {
    if (!this.running) return Promise.reject(new Error('Call start() before calibrate()'))
    this.calibration?.reject(new Error('Calibration restarted'))

    return new Promise<PostureMetrics>((resolve, reject) => {
      const startedAt = performance.now()
      this.calibration = {
        samples: [],
        startedAt,
        endsAt: startedAt + durationMs,
        resolve,
        reject,
      }
      this.baselineMetrics = null
      this.resetRun()
      this.setStatus('calibrating')
    })
  }

  /** Resumes monitoring and alerting. */
  enable() {
    this.enabled = true
    this.resetRun()
    if (this.running && this.state !== 'calibrating') {
      this.setStatus(this.monitoring ? 'watching' : 'ready')
    }
  }

  /** Keeps the camera running but stops scoring and alerting. */
  disable() {
    this.enabled = false
    this.resetRun()
    if (this.running && this.state !== 'calibrating') this.setStatus('paused')
  }

  setEnabled(enabled: boolean) {
    if (enabled) this.enable()
    else this.disable()
  }

  setSensitivity(sensitivity: number) {
    this.options.sensitivity = sensitivity
  }

  setHoldSeconds(seconds: number) {
    this.options.holdSeconds = seconds
  }

  setRepeatAlertSeconds(seconds: number) {
    this.options.repeatAlertSeconds = seconds
  }

  setAlertOptions(alert: AlertOptions | false) {
    this.options.alert = alert === false ? false : { ...this.alertOptions, ...alert }
  }

  setBaseline(baseline: PostureMetrics | null) {
    this.baselineMetrics = baseline
    this.resetRun()
    if (this.running && this.state !== 'calibrating') {
      this.setStatus(this.monitoring ? 'watching' : 'ready')
    }
  }

  getStats(): PostureStats {
    return { ...this.stats }
  }

  resetStats() {
    this.stats = { goodMs: 0, badMs: 0, alerts: 0, startedAt: Date.now() }
  }

  /** Fires the configured alert immediately. Useful for letting people preview it. */
  testAlert() {
    if (this.alertOptions) playAlert('Posture alert test', this.alertOptions)
  }

  /** Stops everything and drops every listener. The watcher cannot be restarted. */
  dispose() {
    this.stop()
    this.landmarker?.close()
    this.landmarker = null
    this.emitter.clear()
    if (this.ownsVideo) this.video.remove()
  }

  private get monitoring() {
    return this.enabled && this.baselineMetrics !== null
  }

  private get alertOptions(): AlertOptions | null {
    return this.options.alert === false ? null : (this.options.alert ?? {})
  }

  /**
   * Timers only, never requestAnimationFrame: this loop has to keep running inside an
   * offscreen document and a hidden tab, neither of which ever paints a frame.
   */
  private schedule() {
    if (!this.running) return
    this.timer = window.setTimeout(this.tick, 1000 / this.options.fps!)
  }

  private tick = () => {
    if (!this.running) return
    try {
      this.detect()
    } catch (error) {
      this.fail(error)
    }
    this.schedule()
  }

  private detect() {
    if (!this.landmarker || this.video.readyState < 2) return

    // A frame the camera has not replaced yet would be scored twice, so wait for the next.
    // A feed that stays frozen has been paused by the browser, so nudge it back to life.
    if (this.video.currentTime === this.lastVideoTime) {
      this.stalledTicks += 1
      if (this.stalledTicks % STALL_TICKS === 0) void this.video.play().catch(() => undefined)
      return
    }
    this.stalledTicks = 0

    const now = performance.now()
    const elapsed = this.lastDetectAt === 0 ? 0 : now - this.lastDetectAt
    this.lastDetectAt = now
    this.lastVideoTime = this.video.currentTime

    const landmarks = this.landmarker.detectForVideo(this.video, now).landmarks[0] ?? null
    const metrics = landmarks ? measure(landmarks) : null
    this.current = metrics ? smooth(this.current, metrics, this.options.smoothing) : null

    if (this.calibration && this.current) {
      this.runCalibration(this.current, now)
      this.emitter.emit('frame', { metrics: this.current, landmarks, verdict: null, absent: false })
      return
    }

    if (!this.current) {
      this.absentStreak += 1
      if (this.calibration && now > this.calibration.endsAt + CALIBRATION_GRACE_MS) {
        this.abandonCalibration(new Error('Calibration needs you in view of the camera'))
      }
      // An empty chair is not bad posture: drop the run so nothing is pending on return.
      this.presentStreak = 0
      if (this.absentStreak === ABSENT_FRAMES) this.resetRun()
      this.emitter.emit('frame', { metrics: null, landmarks, verdict: null, absent: true })
      return
    }
    this.absentStreak = 0
    this.presentStreak += 1

    const settled = this.presentStreak >= PRESENT_FRAMES
    const verdict =
      settled && this.monitoring && this.baselineMetrics
        ? evaluate(this.baselineMetrics, this.current, this.options.sensitivity)
        : null

    if (verdict) this.score(verdict.good, verdict.issues, now, elapsed)
    this.emitter.emit('frame', { metrics: this.current, landmarks, verdict, absent: false })
  }

  private runCalibration(metrics: PostureMetrics, now: number) {
    const calibration = this.calibration!
    calibration.samples.push(metrics)

    if (now < calibration.endsAt) {
      const span = calibration.endsAt - calibration.startedAt
      this.emitter.emit('calibrating', {
        progress: (now - calibration.startedAt) / span,
        remainingMs: calibration.endsAt - now,
      })
      return
    }

    this.calibration = null
    this.baselineMetrics = average(calibration.samples)
    this.resetRun()
    this.goodSince = now
    this.setStatus(this.monitoring ? 'watching' : 'ready')
    this.emitter.emit('calibrated', this.baselineMetrics)
    calibration.resolve(this.baselineMetrics)
  }

  private score(good: boolean, issues: PostureIssue[], now: number, elapsed: number) {
    const holdMs = this.options.holdSeconds! * 1000
    const repeatMs = this.options.repeatAlertSeconds! * 1000
    const recoveryMs = this.options.recoverySeconds! * 1000

    if (good) {
      this.stats.goodMs += elapsed
      this.badSince = 0
      this.goodSince ||= now
      if (now - this.goodSince > recoveryMs) this.lastAlertAt = 0
    } else {
      this.stats.badMs += elapsed
      this.goodSince = 0
      this.badSince ||= now
      const sustained = now - this.badSince >= holdMs
      const cooledDown = this.lastAlertAt === 0 || now - this.lastAlertAt >= repeatMs
      if (sustained && cooledDown) this.raiseAlert(issues, now)
    }

    if (good !== this.wasGood) {
      this.wasGood = good
      this.emitter.emit('posture', { good, issues, metrics: this.current! })
    }
  }

  private raiseAlert(issues: PostureIssue[], now: number) {
    this.lastAlertAt = now
    this.stats.alerts += 1

    const alert = {
      issues,
      metrics: this.current!,
      badForMs: now - this.badSince,
      count: this.stats.alerts,
    }
    if (this.alertOptions) {
      playAlert(issues.map((issue) => issue.message).join('\n'), this.alertOptions)
    }
    this.emitter.emit('alert', alert)
  }

  private abandonCalibration(error: Error) {
    const calibration = this.calibration
    this.calibration = null
    this.setStatus(this.monitoring ? 'watching' : 'ready')
    calibration?.reject(error)
  }

  private resetRun() {
    this.wasGood = null
    this.absentStreak = 0
    this.presentStreak = 0
    this.badSince = 0
    this.goodSince = 0
    this.lastAlertAt = 0
  }

  private setStatus(status: PostureStatus) {
    if (status === this.state) return
    this.state = status
    this.emitter.emit('status', status)
  }

  private fail(error: unknown) {
    this.emitter.emit('error', error instanceof Error ? error : new Error(String(error)))
  }
}

export function createPostureWatcher(options?: PostureWatcherOptions) {
  return new PostureWatcher(options)
}

/** Turns a step that never settles into one that fails out loud. */
function deadline<T>(work: Promise<T>, message: string) {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), START_TIMEOUT_MS)
    }),
  ])
}

function createHiddenVideo() {
  const video = document.createElement('video')
  video.playsInline = true
  video.muted = true
  video.setAttribute('aria-hidden', 'true')
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;'
  document.body.append(video)
  return video
}
