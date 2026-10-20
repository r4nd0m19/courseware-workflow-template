#!/usr/bin/env node
// Make the white photo-studio background of a generated illustration
// transparent. The reference shell applies `filter: drop-shadow(...)` to the
// mascot, so a non-transparent PNG would get a rectangular shadow. Flood fill
// from the border keeps white areas inside the character (shirt highlights)
// opaque.
import { PNG } from 'pngjs'

export function countTransparent(buffer) {
  const png = PNG.sync.read(buffer)
  let count = 0
  for (let i = 3; i < png.data.length; i += 4) if (png.data[i] < 255) count += 1
  return count
}

export function removeNearWhiteBackground(buffer, options = {}) {
  const tolerance = options.tolerance ?? 26
  const minLuma = options.minLuma ?? 230
  const png = PNG.sync.read(buffer)
  const { width, height, data } = png
  const pixels = width * height

  let opaque = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) opaque += 1
  if (opaque > 0) return { buffer, changed: false, removed: 0, transparent: opaque }

  const cornerIndexes = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + width - 1) * 4,
  ]
  let bgR = 0
  let bgG = 0
  let bgB = 0
  for (const i of cornerIndexes) {
    bgR += data[i]
    bgG += data[i + 1]
    bgB += data[i + 2]
  }
  bgR /= cornerIndexes.length
  bgG /= cornerIndexes.length
  bgB /= cornerIndexes.length

  const nearBackground = (index) => {
    const i = index * 4
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const luma = (r + g + b) / 3
    return luma >= minLuma
      && Math.abs(r - bgR) <= tolerance
      && Math.abs(g - bgG) <= tolerance
      && Math.abs(b - bgB) <= tolerance
  }

  const visited = new Uint8Array(pixels)
  const queue = new Int32Array(pixels)
  let head = 0
  let tail = 0
  const push = (index) => {
    if (visited[index]) return
    visited[index] = 1
    if (!nearBackground(index)) return
    queue[tail++] = index
  }
  for (let x = 0; x < width; x += 1) {
    push(x)
    push((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width)
    push(y * width + width - 1)
  }

  let removed = 0
  while (head < tail) {
    const index = queue[head++]
    data[index * 4 + 3] = 0
    removed += 1
    const x = index % width
    const y = (index - x) / width
    if (x > 0) push(index - 1)
    if (x + 1 < width) push(index + 1)
    if (y > 0) push(index - width)
    if (y + 1 < height) push(index + width)
  }

  return { buffer: PNG.sync.write(png), changed: removed > 0, removed, transparent: removed }
}

// The model leaves a wide white margin around the character. Crop to the
// visible alpha bounds and keep the natural aspect ratio; the shell renders
// generated art with object-fit: contain, so a portrait crop fills the fixed
// mascot box without distortion.
export function trimTransparentPadding(buffer, options = {}) {
  const padding = options.padding ?? 0.04
  const alphaThreshold = options.alphaThreshold ?? 8
  const png = PNG.sync.read(buffer)
  const { width, height, data } = png
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= alphaThreshold) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return { buffer, changed: false, width, height }

  const contentWidth = maxX - minX + 1
  const contentHeight = maxY - minY + 1
  if (contentWidth >= width && contentHeight >= height) return { buffer, changed: false, width, height }

  const pad = Math.max(1, Math.round(Math.max(contentWidth, contentHeight) * padding))
  const outWidth = contentWidth + pad * 2
  const outHeight = contentHeight + pad * 2
  const out = new PNG({ width: outWidth, height: outHeight })
  out.data.fill(0)
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const src = (y * width + x) * 4
      if (data[src + 3] <= alphaThreshold) continue
      const destX = x - minX + pad
      const destY = y - minY + pad
      const dest = (destY * outWidth + destX) * 4
      out.data[dest] = data[src]
      out.data[dest + 1] = data[src + 1]
      out.data[dest + 2] = data[src + 2]
      out.data[dest + 3] = data[src + 3]
    }
  }
  return { buffer: PNG.sync.write(out), changed: true, width: outWidth, height: outHeight }
}

// Force the chunky pixel grid of the reference courseware. Sampling down to a
// small logical sprite and nearest-neighbor upscaling keeps the palette and
// silhouette while removing the model's smooth anti-aliased edges.
export function pixelateArt(buffer, options = {}) {
  const targetHeight = options.targetHeight ?? 64
  const scale = options.scale ?? 8
  const src = PNG.sync.read(buffer)
  const targetWidth = Math.max(1, Math.round((src.width * targetHeight) / src.height))
  const small = new PNG({ width: targetWidth, height: targetHeight })
  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.min(src.width - 1, Math.floor(((x + 0.5) * src.width) / targetWidth))
      const sy = Math.min(src.height - 1, Math.floor(((y + 0.5) * src.height) / targetHeight))
      const s = (sy * src.width + sx) * 4
      const d = (y * targetWidth + x) * 4
      small.data[d] = src.data[s]
      small.data[d + 1] = src.data[s + 1]
      small.data[d + 2] = src.data[s + 2]
      small.data[d + 3] = src.data[s + 3]
    }
  }
  const out = new PNG({ width: targetWidth * scale, height: targetHeight * scale })
  for (let y = 0; y < out.height; y += 1) {
    for (let x = 0; x < out.width; x += 1) {
      const sx = Math.floor(x / scale)
      const sy = Math.floor(y / scale)
      const s = (sy * targetWidth + sx) * 4
      const d = (y * out.width + x) * 4
      out.data[d] = small.data[s]
      out.data[d + 1] = small.data[s + 1]
      out.data[d + 2] = small.data[s + 2]
      out.data[d + 3] = small.data[s + 3]
    }
  }
  return { buffer: PNG.sync.write(out), changed: true, width: out.width, height: out.height }
}
