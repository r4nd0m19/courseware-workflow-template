#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { EdgeTTS } from 'node-edge-tts'
import { assertScriptApproved, DEFAULT_SCRIPT_APPROVAL } from './approval-lib.mjs'
import {
  audioFilePath,
  audioUrl,
  loadVoiceCatalog,
  parseOnly,
  readNarrationSlides,
  selectNarrationSlides,
} from './narration-lib.mjs'

function usage() {
  console.error(
    'usage: node build-narration.mjs <courseware.md> --voices <catalog.json> --out <narration.json> --audio-dir <dir> ' +
      '[--url-prefix /audio] [--only S01,S02] [--force] [--dry-run] [--retries 2] [--cache <file>] [--approval review/script-approval.json]',
  )
}

const argv = process.argv.slice(2)
function option(name, fallback = '') {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
function flag(name) {
  return argv.includes(name)
}
const positional = []
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (arg.startsWith('--')) {
    if (
      ['--voices', '--out', '--audio-dir', '--url-prefix', '--only', '--retries', '--delay-ms', '--cache', '--approval'].includes(
        arg,
      )
    ) {
      i += 1
    }
    continue
  }
  positional.push(arg)
}

const scriptPath = positional[0]
const voicesPath = option('--voices')
const outPath = option('--out')
const audioDir = option('--audio-dir')
const urlPrefix = option('--url-prefix', '/audio')
const only = parseOnly(option('--only'))
const force = flag('--force')
const dryRun = flag('--dry-run')
const retries = Number(option('--retries', '2'))
const delayMs = Number(option('--delay-ms', '150'))
const cachePath = option(
  '--cache',
  audioDir ? path.join(audioDir, '.narration-cache.json') : '',
)
const approvalPath = option('--approval', DEFAULT_SCRIPT_APPROVAL)

if (!scriptPath || !voicesPath || !outPath || (!audioDir && !dryRun)) {
  usage()
  process.exit(2)
}

try {
  assertScriptApproved(scriptPath, { approvalPath })
} catch (error) {
  console.error(`FAIL narration — ${error.message}`)
  process.exit(1)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let catalog
let parsed
try {
  catalog = loadVoiceCatalog(voicesPath)
  parsed = readNarrationSlides(scriptPath)
} catch (error) {
  console.error(`FAIL narration input — ${error.message}`)
  process.exit(1)
}

const slides = selectNarrationSlides(parsed.slides, only)
if (slides.length === 0) {
  console.error('FAIL narration input — no slides selected')
  process.exit(1)
}

const missing = slides.filter((slide) => !slide.rawText.trim())
if (missing.length) {
  console.error(`FAIL narration input — missing narration: ${missing.map((s) => s.id).join(', ')}`)
  process.exit(1)
}

function clipKey(slideId, voiceId) {
  return `${slideId}/${voiceId}`
}

function voiceSettings(voice) {
  return {
    providerVoice: voice.providerVoice,
    rate: catalog.defaults.rate,
    pitch: catalog.defaults.pitch,
    outputFormat: catalog.defaults.outputFormat,
    locale: catalog.defaults.locale,
    provider: catalog.provider,
    generator: catalog.generator,
  }
}

function narrationTextHash(text, voice) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        text,
        ...voiceSettings(voice),
      }),
    )
    .digest('hex')
}

function readCache() {
  if (!cachePath) return { schemaVersion: '1.0', clips: {} }
  try {
    const parsedCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    if (parsedCache && typeof parsedCache === 'object' && parsedCache.clips) {
      return { schemaVersion: '1.0', clips: { ...parsedCache.clips } }
    }
  } catch {
    // Missing or unreadable cache: regenerate what cannot be proven current.
  }
  return { schemaVersion: '1.0', clips: {} }
}

const cache = readCache()
// Migrate from the previous manifest: if an existing clip was generated from
// the same spoken text and voice settings, trust it without regenerating.
try {
  if (audioDir && outPath && fs.existsSync(outPath)) {
    const previous = JSON.parse(fs.readFileSync(outPath, 'utf8'))
    for (const slide of previous.slides || []) {
      if (typeof slide.spokenText !== 'string') continue
      for (const voice of catalog.voices) {
        const key = clipKey(slide.id, voice.id)
        if (cache.clips[key]) continue
        const file = audioFilePath(audioDir, slide.id, voice.id)
        if (!fs.existsSync(file) || fs.statSync(file).size <= 1024) continue
        cache.clips[key] = {
          textHash: narrationTextHash(slide.spokenText, voice),
          ...voiceSettings(voice),
          bytes: fs.statSync(file).size,
          mtimeMs: fs.statSync(file).mtimeMs,
        }
      }
    }
  }
} catch {
  // A malformed previous manifest is not fatal; clips will be regenerated.
}

const manifest = {
  schemaVersion: '1.0',
  source: path.relative(process.cwd(), path.resolve(scriptPath)),
  sourceHash: parsed.sourceHash,
  generatedAt: new Date().toISOString(),
  provider: catalog.provider,
  generator: catalog.generator,
  defaults: catalog.defaults,
  defaultVoice: catalog.defaultVoice || catalog.voices[0].id,
  clips: [],
  voices: catalog.voices.map(({ id, displayName, providerVoice, use }) => ({
    id,
    displayName,
    providerVoice,
    ...(use ? { use } : {}),
  })),
  slides: [],
}

async function generateOne(slide, voice) {
  const file = audioFilePath(audioDir, slide.id, voice.id)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const key = clipKey(slide.id, voice.id)
  const textHash = narrationTextHash(slide.spokenText, voice)
  const settings = voiceSettings(voice)
  const cached = cache.clips[key]

  if (
    !force &&
    fs.existsSync(file) &&
    fs.statSync(file).size > 1024 &&
    cached &&
    cached.textHash === textHash &&
    cached.providerVoice === settings.providerVoice &&
    cached.rate === settings.rate &&
    cached.pitch === settings.pitch &&
    cached.outputFormat === settings.outputFormat &&
    cached.locale === settings.locale &&
    cached.provider === settings.provider &&
    cached.generator === settings.generator &&
    cached.bytes === fs.statSync(file).size &&
    cached.mtimeMs === fs.statSync(file).mtimeMs
  ) {
    return { file, size: fs.statSync(file).size, reused: true }
  }

  if (dryRun) {
    return { file, dryRun: true }
  }

  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const tts = new EdgeTTS({
        voice: voice.providerVoice,
        lang: catalog.defaults.locale,
        outputFormat: catalog.defaults.outputFormat,
        rate: catalog.defaults.rate,
        pitch: catalog.defaults.pitch,
        timeout: 30000,
      })
      await tts.ttsPromise(slide.spokenText, file)
      const size = fs.statSync(file).size
      if (size < 1024) throw new Error(`output too small (${size} bytes)`)
      cache.clips[key] = {
        textHash,
        ...settings,
        bytes: size,
        mtimeMs: fs.statSync(file).mtimeMs,
      }
      return { file, size, reused: false }
    } catch (error) {
      lastError = error
      if (attempt < retries) await sleep(1000 * (attempt + 1))
    }
  }
  throw new Error(`${slide.id}/${voice.id}: ${lastError?.message || 'unknown error'}`)
}

for (const slide of slides) {
  const entry = {
    id: slide.id,
    title: slide.title,
    rawText: slide.rawText,
    spokenText: slide.spokenText,
    audio: {},
  }
  for (const voice of catalog.voices) {
    let result
    try {
      result = await generateOne(slide, voice)
    } catch (error) {
      console.error(`FAIL narration generate — ${error.message}`)
      process.exit(1)
    }
    entry.audio[voice.id] = audioUrl(urlPrefix, slide.id, voice.id)
    if (!result.dryRun) {
      const size = result.size || fs.statSync(result.file).size
      // 48 kbps mono MP3. Enough for progress/scheduling; the player itself
      // still follows the real audio element's currentTime/ended events.
      manifest.clips.push({
        id: slide.id,
        voice: voice.id,
        url: entry.audio[voice.id],
        bytes: size,
        durationSeconds: Math.round((size * 8) / 48000 * 10) / 10,
      })
    }
    if (result.dryRun) {
      console.log(`DRY ${slide.id}/${voice.id}`)
    } else if (result.reused) {
      console.log(`OK  ${slide.id}/${voice.id} — reused`)
    } else {
      console.log(`OK  ${slide.id}/${voice.id} — ${result.size} bytes`)
    }
    if (!result.reused && !result.dryRun && delayMs > 0) await sleep(delayMs)
  }
  manifest.slides.push(entry)
}

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`)
if (cachePath && !dryRun) {
  fs.mkdirSync(path.dirname(path.resolve(cachePath)), { recursive: true })
  fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`)
  console.log(`OK narration cache — ${cachePath}`)
}
console.log(
  `OK narration manifest — ${manifest.slides.length} slide(s), ${manifest.voices.length} voice(s), ${outPath}`,
)
