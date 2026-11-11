import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { PostureIssue, PostureMetrics, PostureVerdict } from './types'

const NOSE = 0
const LEFT_EAR = 7
const RIGHT_EAR = 8
const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12

// Pose models still return a skeleton for an empty chair, just a poorly seen one.
const MIN_VISIBILITY = 0.5
const MIN_SHOULDER_WIDTH = 0.05

/** Deviation from baseline that counts as bad posture at sensitivity 1. */
export const LIMITS = {
  slouch: 0.09,
  lean: 0.13,
  shoulderSlope: 0.11,
  headOffset: 0.14,
}

export const MESSAGES = {
  slouch: 'Head dropping toward your shoulders. Lengthen your neck.',
  lean: 'Leaning in toward the screen. Sit back.',
  shoulderSlope: 'Shoulders uneven. Level them out.',
  headOffset: 'Head drifting off center. Square up to the screen.',
}

/**
 * Presence rests on the nose and the shoulders alone. The ears are a sharper reference for
 * neck length, but the model's confidence in them collapses exactly when posture goes bad
 * — head down, head turned — so they are measured when offered and never required.
 */
export function measure(landmarks: NormalizedLandmark[]): PostureMetrics | null {
  const points = [NOSE, LEFT_SHOULDER, RIGHT_SHOULDER].map((i) => landmarks[i])
  if (points.some((point) => !point || (point.visibility ?? 1) < MIN_VISIBILITY)) return null

  const [nose, leftShoulder, rightShoulder] = points
  const shoulderWidth = Math.hypot(
    leftShoulder.x - rightShoulder.x,
    leftShoulder.y - rightShoulder.y,
  )
  if (shoulderWidth < MIN_SHOULDER_WIDTH) return null

  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2
  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2
  const ears = earMidY(landmarks)

  return {
    neckRatio: (shoulderMidY - nose.y) / shoulderWidth,
    earNeckRatio: ears === null ? null : (shoulderMidY - ears) / shoulderWidth,
    shoulderWidth,
    shoulderSlope: (leftShoulder.y - rightShoulder.y) / shoulderWidth,
    headOffset: (nose.x - shoulderMidX) / shoulderWidth,
  }
}

/** The ears' midpoint, when the model is confident about both of them. */
function earMidY(landmarks: NormalizedLandmark[]) {
  const ears = [landmarks[LEFT_EAR], landmarks[RIGHT_EAR]]
  if (ears.some((ear) => !ear || (ear.visibility ?? 1) < MIN_VISIBILITY)) return null
  return (ears[0].y + ears[1].y) / 2
}

export function smooth(
  previous: PostureMetrics | null,
  next: PostureMetrics,
  weight = 0.25,
): PostureMetrics {
  if (!previous) return next
  return {
    neckRatio: blend(previous.neckRatio, next.neckRatio, weight),
    earNeckRatio: blendOptional(previous.earNeckRatio, next.earNeckRatio, weight),
    shoulderWidth: blend(previous.shoulderWidth, next.shoulderWidth, weight),
    shoulderSlope: blend(previous.shoulderSlope, next.shoulderSlope, weight),
    headOffset: blend(previous.headOffset, next.headOffset, weight),
  }
}

export function average(samples: PostureMetrics[]): PostureMetrics {
  const withEars = samples.filter((sample) => sample.earNeckRatio !== null)
  const total = samples.reduce(
    (sum, sample) => ({
      neckRatio: sum.neckRatio + sample.neckRatio,
      shoulderWidth: sum.shoulderWidth + sample.shoulderWidth,
      shoulderSlope: sum.shoulderSlope + sample.shoulderSlope,
      headOffset: sum.headOffset + sample.headOffset,
    }),
    { neckRatio: 0, shoulderWidth: 0, shoulderSlope: 0, headOffset: 0 },
  )
  return {
    neckRatio: total.neckRatio / samples.length,
    // A baseline built from a handful of glimpses of the ears is not worth comparing to.
    earNeckRatio:
      withEars.length >= samples.length / 2
        ? withEars.reduce((sum, sample) => sum + sample.earNeckRatio!, 0) / withEars.length
        : null,
    shoulderWidth: total.shoulderWidth / samples.length,
    shoulderSlope: total.shoulderSlope / samples.length,
    headOffset: total.headOffset / samples.length,
  }
}

export function evaluate(
  baseline: PostureMetrics,
  current: PostureMetrics,
  sensitivity = 1,
): PostureVerdict {
  const issues: PostureIssue[] = []
  let strain = 0

  const add = (kind: keyof typeof LIMITS, deviation: number) => {
    const limit = LIMITS[kind] / sensitivity
    const severity = deviation / limit
    strain = Math.max(strain, severity)
    if (severity > 1) issues.push({ kind, message: MESSAGES[kind], severity })
  }

  add('slouch', headDrop(baseline, current))
  add('lean', current.shoulderWidth / baseline.shoulderWidth - 1)
  add('shoulderSlope', Math.abs(current.shoulderSlope - baseline.shoulderSlope))
  add('headOffset', Math.abs(current.headOffset - baseline.headOffset))

  return { good: issues.length === 0, issues, strain }
}

/** Ears when both readings have them, nose otherwise: the two scales are not comparable. */
function headDrop(baseline: PostureMetrics, current: PostureMetrics) {
  if (baseline.earNeckRatio !== null && current.earNeckRatio !== null) {
    return baseline.earNeckRatio - current.earNeckRatio
  }
  return baseline.neckRatio - current.neckRatio
}

function blend(a: number, b: number, weight: number) {
  return a * (1 - weight) + b * weight
}

function blendOptional(a: number | null, b: number | null, weight: number) {
  if (b === null) return null
  return a === null ? b : blend(a, b, weight)
}
