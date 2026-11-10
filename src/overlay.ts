import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

/** Head, shoulders and torso — the landmarks posture is scored from. */
export const POSTURE_CONNECTIONS: Array<[number, number]> = [
  [7, 0],
  [8, 0],
  [11, 12],
  [11, 7],
  [12, 8],
  [11, 23],
  [12, 24],
  [23, 24],
]

export const POSTURE_POINTS = [0, 7, 8, 11, 12]

export interface DrawPoseOptions {
  color?: string
  lineWidth?: number
  pointRadius?: number
  clear?: boolean
}

/** Draws the posture skeleton onto a canvas sized to the video frame. */
export function drawPose(
  context: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[] | null,
  { color = '#60e6b4', lineWidth = 4, pointRadius = 5, clear = true }: DrawPoseOptions = {},
) {
  const { width, height } = context.canvas
  if (clear) context.clearRect(0, 0, width, height)
  if (!landmarks) return

  context.strokeStyle = color
  context.fillStyle = color
  context.lineWidth = lineWidth

  for (const [from, to] of POSTURE_CONNECTIONS) {
    const a = landmarks[from]
    const b = landmarks[to]
    if (!a || !b) continue
    context.beginPath()
    context.moveTo(a.x * width, a.y * height)
    context.lineTo(b.x * width, b.y * height)
    context.stroke()
  }

  for (const index of POSTURE_POINTS) {
    const point = landmarks[index]
    if (!point) continue
    context.beginPath()
    context.arc(point.x * width, point.y * height, pointRadius, 0, Math.PI * 2)
    context.fill()
  }
}
