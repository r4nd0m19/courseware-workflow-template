#!/usr/bin/env node
// Generate per-lesson illustration variants for a shell.
//
// The reference crop is sent to the relay as a style reference, but the
// prompt asks for a different character. The generator picks an image model
// available to the token (qwen-image-2.0 or gpt-image-2) unless --model is
// given. The seed is derived from lesson + slot for qwen; OpenAI-compatible
// image models do not accept a seed, so it is recorded as provenance only.
// Ingestion copies reference art; generation must never reuse it byte-for-byte.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { readJson, resolveShellDir, validateShellPackage } from './shell-lib.mjs'
import { removeNearWhiteBackground, trimTransparentPadding, pixelateArt } from './image-alpha.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
function flag(name) { return args.includes(name) }

let shellDir
try {
  shellDir = resolveShellDir(opt('--shell', 'branch-choice'))
} catch (error) {
  console.error(`FAIL ${error.message}`)
  process.exit(2)
}
const lesson = opt('--lesson')
const lessonTitle = opt('--lesson-title', lesson)
const outDir = path.resolve(opt('--out', path.join('generated', lesson || 'lesson')))
const manifestPath = path.resolve(opt('--manifest', path.join(outDir, 'art-manifest.json')))
const keyFile = path.resolve(opt('--api-key-file', path.join(os.homedir(), '.config', 'courseware', 'aliyun-image.key')))
const only = opt('--only').split(',').map((s) => s.trim()).filter(Boolean)
const count = Number(opt('--n', '1'))
const baseSeed = opt('--seed')
const requestedModel = opt('--model')
const dryRun = flag('--dry-run')
const jsonOut = flag('--json')
const timeoutMs = Number(opt('--timeout-ms', '600000'))
const promptFile = opt('--prompt-file')
// Workflow builds are idempotent: an entry whose prompt, reference and output
// file still match is reused instead of calling the image API again. `--force`
// opts out when a teacher explicitly wants a fresh character.
const reuse = flag('--reuse')
const force = flag('--force')

const BASE_URL = 'https://newai.istudy.xin/v1'
const SIZE = '1024*1024'
const PROVIDER = 'newai.istudy.xin'

if (!lesson) {
  console.error('usage: node generate-shell-art.mjs --shell shells/<id> --lesson <slug> [--lesson-title <title>] [--out <dir>] [--only cover,end] [--prompt-file <json>] [--n 1] [--seed <base>] [--model <id>] [--reuse] [--force] [--dry-run] [--json]')
  process.exit(2)
}
if (!Number.isInteger(count) || count < 1 || count > 6) {
  console.error('FAIL --n must be an integer between 1 and 6')
  process.exit(2)
}

const packageCheck = validateShellPackage(shellDir)
if (!packageCheck.ok) {
  console.error(`FAIL shell package\n${packageCheck.errors.map((e) => `  - ${e}`).join('\n')}`)
  process.exit(1)
}
const { shell, root } = packageCheck
const illustrations = (shell.assets.illustrations || []).filter((art) => !only.length || only.includes(art.slot))
if (!illustrations.length) {
  console.error(`FAIL no illustration slots selected (available: ${(shell.assets.illustrations || []).map((a) => a.slot).join(', ') || 'none'})`)
  process.exit(2)
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}
function seedFor(slot, index = 0) {
  if (baseSeed) return (Number(baseSeed) + index) >>> 0
  const digest = crypto.createHash('sha256').update(`${lesson}\u0000${slot}\u0000${index}`).digest()
  return digest.readUInt32BE(0) % 2147483647
}
let promptOverrides = {}
if (promptFile) {
  const brief = readJson(path.resolve(promptFile), 'art prompt file')
  promptOverrides = brief.prompts || brief
  if (!promptOverrides || typeof promptOverrides !== 'object' || Array.isArray(promptOverrides)) {
    console.error(`FAIL ${promptFile}: expected an object of slot -> prompt`)
    process.exit(2)
  }
  for (const slot of Object.keys(promptOverrides)) {
    if (typeof promptOverrides[slot] !== 'string' || !promptOverrides[slot].trim()) {
      console.error(`FAIL ${promptFile}: prompt for "${slot}" must be a non-empty string`)
      process.exit(2)
    }
  }
}
function promptFor(illustration) {
  const base = promptOverrides[illustration.slot] || illustration.prompt
  return `${base}\n\nLesson theme: ${lessonTitle}. Make this character clearly distinct from the reference image and from characters used in other lessons. Keep the same blocky pixel-art style and palette family, but change the face, hairstyle, outfit and accessory. Style guard: low-resolution pixel art with visible square pixels, hard edges, no anti-aliasing, no smooth gradients, no 3D rendering, no painterly texture. Do not copy the reference image exactly. No text, no watermark.`
}
function readApiKey() {
  if (process.env.newai_default_key) return process.env.newai_default_key.trim()
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf8').trim()
  return ''
}
function imageSize(buffer) {
  if (buffer.length > 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let off = 2
    while (off + 9 < buffer.length) {
      if (buffer[off] !== 0xff) { off += 1; continue }
      const marker = buffer[off + 1]
      const length = buffer.readUInt16BE(off + 2)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { format: 'jpeg', height: buffer.readUInt16BE(off + 5), width: buffer.readUInt16BE(off + 7) }
      }
      off += 2 + length
    }
  }
  if (buffer.length > 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16)
    if (chunk === 'VP8X') return { format: 'webp', width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) }
    if (chunk === 'VP8 ') return { format: 'webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
  }
  return null
}
function mimeFor(buffer) {
  const size = imageSize(buffer)
  if (size?.format === 'png') return { mime: 'image/png', ext: '.png' }
  if (size?.format === 'jpeg') return { mime: 'image/jpeg', ext: '.jpg' }
  if (size?.format === 'webp') return { mime: 'image/webp', ext: '.webp' }
  return { mime: 'application/octet-stream', ext: '.bin' }
}
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
function isOpenAIImageModel(model) {
  return /^(gpt-image|dall-e)/i.test(String(model || ''))
}
async function chooseModel(apiKey) {
  if (requestedModel) return requestedModel
  const response = await fetchWithTimeout(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'User-Agent': 'courseware-shell-art/1.0' },
  })
  if (!response.ok) throw new Error(`model list failed with HTTP ${response.status}`)
  const result = await response.json()
  const models = Array.isArray(result.data) ? result.data : []
  const ids = models.map((item) => item.id).filter(Boolean)
  for (const preferred of ['qwen-image-2.0', 'gpt-image-2']) {
    if (ids.includes(preferred)) return preferred
  }
  const imageModel = models.find((item) => (item.supported_endpoint_types || []).some((type) => String(type).includes('image')))
  if (imageModel?.id) return imageModel.id
  throw new Error(`no image model is available for this token; models: ${ids.join(', ') || 'none'}`)
}
async function requestImage(prompt, referenceFile, seed, n, apiKey, model) {
  const reference = fs.readFileSync(referenceFile)
  const { mime } = mimeFor(reference)
  let response
  if (isOpenAIImageModel(model)) {
    // OpenAI-compatible image edits use multipart/form-data. `seed` is not
    // part of that contract, so callers record it as provenance only.
    const form = new FormData()
    form.set('model', model)
    form.set('prompt', prompt)
    form.set('n', String(n))
    form.set('size', '1024x1024')
    form.append('image', new Blob([reference], { type: mime }), path.basename(referenceFile))
    response = await fetchWithTimeout(`${BASE_URL}/images/edits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'User-Agent': 'courseware-shell-art/1.0',
      },
      body: form,
    })
  } else {
    const content = [
      { image: `data:${mime};base64,${reference.toString('base64')}` },
      { text: prompt },
    ]
    const payload = {
      model,
      prompt,
      input: { messages: [{ role: 'user', content }] },
      parameters: { n, watermark: false, size: SIZE, seed },
    }
    response = await fetchWithTimeout(`${BASE_URL}/images/edits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'courseware-shell-art/1.0',
      },
      body: JSON.stringify(payload),
    })
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`image request failed with HTTP ${response.status}: ${body.slice(0, 1200)}`)
  }
  const result = await response.json()
  const list = result.data
  if (!Array.isArray(list) || !list.length) throw new Error(`image response has no data: ${JSON.stringify(result).slice(0, 800)}`)
  const images = []
  for (const item of list) {
    if (item.b64_json) images.push(Buffer.from(item.b64_json, 'base64'))
    else if (item.url) {
      const download = await fetchWithTimeout(item.url, { headers: { Accept: 'image/png,image/jpeg,image/webp,*/*', 'User-Agent': 'courseware-shell-art/1.0' } })
      if (!download.ok) throw new Error(`image download failed with HTTP ${download.status}`)
      images.push(Buffer.from(await download.arrayBuffer()))
    } else throw new Error('image result has neither b64_json nor url')
  }
  return images
}

// Plan every slot before reading the API key: with --reuse an unchanged
// manifest needs no network access at all. A slot is reusable only when the
// prompt, reference hash, output file and recorded provenance all still match.
const previousManifest = !dryRun && (reuse || only.length) && fs.existsSync(manifestPath)
  ? readJson(manifestPath, 'art manifest')
  : null
const previousImages = previousManifest?.shell === shell.id && previousManifest.images
  ? previousManifest.images
  : {}
const plans = illustrations.map((illustration) => {
  const referenceFile = path.join(root, illustration.reference)
  const referenceSha = sha256(fs.readFileSync(referenceFile))
  const prompt = promptFor(illustration)
  const previous = previousImages[illustration.slot]
  let reusable = false
  if (reuse && !force && !dryRun && previous && !previous.dryRun) {
    const src = previous.src || previous.file
    const file = src ? path.resolve(outDir, src) : ''
    reusable = Boolean(
      file &&
        fs.existsSync(file) &&
        previous.sha256 === sha256(fs.readFileSync(file)) &&
        previous.referenceSha256 === referenceSha &&
        previous.prompt === prompt &&
        previous.model &&
        previous.seed !== undefined &&
        previous.seed !== null,
    )
  }
  return { illustration, referenceFile, referenceSha, prompt, previous, reusable }
})
const pending = plans.filter((plan) => !plan.reusable)

const apiKey = dryRun || !pending.length ? '' : readApiKey()
if (!dryRun && pending.length && !apiKey) {
  console.error(`FAIL missing Aliyun image API key.
  Ask the user for the default-group token at https://newai.istudy.xin, then save it:
    install -d -m 700 ${path.dirname(keyFile)}
    printf '%s' '<token>' > ${keyFile}
    chmod 600 ${keyFile}
  Or set newai_default_key in the environment. The token is never printed by this tool.`)
  process.exit(2)
}
let modelName = requestedModel || (dryRun ? 'qwen-image-2.0' : '')
if (!dryRun && pending.length && !modelName) {
  try {
    modelName = await chooseModel(apiKey)
  } catch (error) {
    console.error(`FAIL ${error.message}`)
    process.exit(2)
  }
}
if (!dryRun && !pending.length) modelName = previousManifest?.model || ''

fs.mkdirSync(outDir, { recursive: true })
// `--reuse` and `--only` keep untouched slots' provenance instead of dropping
// them from the manifest. A dry run must never overwrite a real manifest, since
// the placeholder entries have no files.
const knownSlots = new Set((shell.assets.illustrations || []).map((art) => art.slot))
const manifestImages = {}
if (reuse || only.length) {
  for (const [slot, entry] of Object.entries(previousImages)) {
    if (knownSlots.has(slot)) manifestImages[slot] = entry
  }
}
const manifest = {
  schemaVersion: '1.0',
  shell: shell.id,
  shellVersion: shell.version,
  lesson,
  lessonTitle,
  provider: PROVIDER,
  model: modelName,
  size: SIZE,
  generatedAt: previousManifest && !pending.length ? previousManifest.generatedAt : new Date().toISOString(),
  ...(promptFile ? { promptFile: path.resolve(promptFile) } : {}),
  images: manifestImages,
}
const errors = []
const reusedSlots = []
for (const plan of plans) {
  const { illustration, referenceFile, referenceSha, prompt, previous } = plan
  if (plan.reusable) {
    manifest.images[illustration.slot] = previous
    reusedSlots.push(illustration.slot)
    continue
  }
  const variants = []
  for (let i = 0; i < count; i += 1) {
    const seed = seedFor(illustration.slot, i)
    if (dryRun) {
      variants.push({ seed, dryRun: true, prompt })
      continue
    }
    try {
      const images = await requestImage(prompt, referenceFile, seed, 1, apiKey, modelName)
      const rawBuffer = images[0]
      let buffer = rawBuffer
      let backgroundRemoved = 0
      let trimmed = false
      let pixelated = false
      try {
        const processed = removeNearWhiteBackground(rawBuffer)
        buffer = processed.buffer
        backgroundRemoved = processed.removed
        const cropped = trimTransparentPadding(buffer)
        buffer = cropped.buffer
        trimmed = cropped.changed
        const pixelate = shell.assets?.postprocess?.pixelate
        if (pixelate) {
          const snapped = pixelateArt(buffer, pixelate)
          buffer = snapped.buffer
          pixelated = snapped.changed
        }
      } catch {
        // Non-PNG output: keep it as-is and let the checker report the missing alpha.
      }
      const generatedSha = sha256(buffer)
      if (generatedSha === referenceSha) errors.push(`${illustration.slot}: generated image is byte-identical to the reference (seed ${seed})`)
      const size = imageSize(buffer)
      if (!size || size.width < 256 || size.height < 256) errors.push(`${illustration.slot}: generated image size is invalid: ${JSON.stringify(size)}`)
      const { ext } = mimeFor(buffer)
      const name = count > 1 ? `${illustration.slot}-${i + 1}${ext}` : `${illustration.slot}${ext}`
      fs.writeFileSync(path.join(outDir, name), buffer)
      variants.push({
        file: name,
        src: name,
        sha256: generatedSha,
        rawSha256: sha256(rawBuffer),
        bytes: buffer.length,
        width: size?.width || 0,
        height: size?.height || 0,
        format: size?.format || '',
        backgroundRemoved,
        trimmed,
        pixelated,
        ...(pixelated ? {
          pixelHeight: shell.assets.postprocess.pixelate.targetHeight,
          pixelScale: shell.assets.postprocess.pixelate.scale,
        } : {}),
        seed,
        seedSent: !isOpenAIImageModel(modelName),
        prompt,
        model: modelName,
        provider: PROVIDER,
        reference: illustration.reference,
        referenceSha256: referenceSha,
      })
    } catch (error) {
      errors.push(`${illustration.slot} variant ${i + 1}: ${error.message}`)
    }
  }
  const usable = variants.filter((variant) => !variant.dryRun)
  const selected = usable[0] || variants[0]
  if (selected) {
    manifest.images[illustration.slot] = selected
    if (count > 1 && usable.length) manifest.images[illustration.slot].variants = usable
  }
}
const outputManifestPath = dryRun && fs.existsSync(manifestPath)
  ? (manifestPath.endsWith('.dry-run.json') ? manifestPath : manifestPath.replace(/\.json$/i, '.dry-run.json'))
  : manifestPath
fs.writeFileSync(outputManifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
const report = {
  ok: errors.length === 0,
  dryRun,
  shell: shell.id,
  lesson,
  outDir,
  manifest: outputManifestPath,
  reused: reusedSlots,
  images: manifest.images,
  errors,
}
if (jsonOut) console.log(JSON.stringify(report, null, 2))
else {
  console.log(`${report.ok ? 'OK' : 'FAIL'} shell art ${shell.id} / ${lesson}`)
  for (const illustration of illustrations) {
    const slot = illustration.slot
    const entry = manifest.images[slot]
    if (!entry) {
      console.log(`   ${slot}: FAILED (no image generated; see errors)`)
    } else if (entry.dryRun) console.log(`   ${slot}: dry-run seed=${entry.seed}`)
    else console.log(`   ${slot}: ${entry.file} ${entry.width}x${entry.height} seed=${entry.seed} sha=${entry.sha256.slice(0, 12)}${reusedSlots.includes(slot) ? ' (reused)' : ''}`)
  }
  console.log(`   manifest: ${path.relative(process.cwd(), outputManifestPath) || outputManifestPath}`)
  for (const error of errors) console.error(`  - ${error}`)
}
process.exit(report.ok ? 0 : 1)
