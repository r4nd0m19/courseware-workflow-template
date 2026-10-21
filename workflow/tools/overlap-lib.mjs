// Pure geometry helpers for the visual overlap gate. Kept browser-free so the
// smoke test can check them without launching Chromium.
export function overlapSize(a, b) {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return { width: Math.max(0, width), height: Math.max(0, height) }
}

export function rectsOverlap(a, b, tolerance = 4) {
  const { width, height } = overlapSize(a, b)
  return width > tolerance && height > tolerance
}
