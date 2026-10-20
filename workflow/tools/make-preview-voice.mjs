#!/usr/bin/env node
// Generate the dummy voice fixture used by a shell's preview deck.
//
// The shell ships with no lesson narration. To make its audio timeline and
// voice switcher testable during shell review, this tool synthesizes a small
// set of placeholder phrases with the same Edge TTS voices the shell exposes.
// The MP3s are checked in next to the profile and carry a hash/duration ledger.
//
// Usage:
//   node workflow/tools/make-preview-voice.mjs --profile branch-v1 [--force]
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { EdgeTTS } from 'node-edge-tts'
import { chromium } from 'playwright-core'
import { resolveChrome } from './chrome.mjs'
import { serveDir } from './shell-lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const profileArg = opt('--profile', 'branch-v1')
const force = args.includes('--force')
const outputFormat = 'audio-24khz-48kbitrate-mono-mp3'
const locale = 'zh-CN'
const delayMs = 150

const profileFile = path.join(here, 'shell-profiles', `${profileArg}.mjs`)
if (!fs.existsSync(profileFile)) {
  console.error(`FAIL profile not found: ${profileFile}`)
  process.exit(2)
}
const { default: profile } = await import(`${new URL(`file://${profileFile}`).href}?v=${Date.now()}`)
const narration = profile.previewNarration
if (!narration?.voices?.length || !narration?.phrases?.length) {
  console.error(`FAIL profile ${profileArg} has no previewNarration (voices + phrases)`)
  process.exit(2)
}
const outDir = path.join(here, 'shell-profiles', profile.id, 'preview-audio')
const manifestFile = path.join(outDir, 'manifest.json')
fs.mkdirSync(outDir, { recursive: true })

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  } catch {
    return null
  }
}
const previous = readManifest()
const previousHashes = new Map()
for (const phrase of previous?.phrases || []) {
  for (const voice of narration.voices) {
    const entry = phrase.files?.[voice.id]
    if (entry?.file) previousHashes.set(entry.file, entry.sha256)
  }
}
if (force) {
  for (const file of fs.readdirSync(outDir)) {
    if (file.endsWith('.mp3')) fs.rmSync(path.join(outDir, file))
  }
}

const chrome = resolveChrome()
if (!chrome) {
  console.error('FAIL Chromium not found. Set CHROME_PATH or install Playwright Chromium.')
  process.exit(1)
}

const generated = []
for (const phrase of narration.phrases) {
  for (const voice of narration.voices) {
    const file = `${phrase.id}-${voice.id}.mp3`
    const absolute = path.join(outDir, file)
    const expected = previousHashes.get(file)
    if (!force && fs.existsSync(absolute) && fs.statSync(absolute).size > 1024 && expected && sha256(absolute) === expected) {
      console.log(`OK  ${file} — reused`)
      continue
    }
    let lastError = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const tts = new EdgeTTS({
          voice: voice.providerVoice,
          lang: locale,
          outputFormat,
          rate: '+0%',
          pitch: '+0%',
          timeout: 30000,
        })
        await tts.ttsPromise(phrase.text, absolute)
        if (!fs.existsSync(absolute) || fs.statSync(absolute).size < 1024) {
          throw new Error('output too small')
        }
        console.log(`OK  ${file} — ${fs.statSync(absolute).size} bytes`)
        lastError = null
        break
      } catch (error) {
        lastError = error
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
      }
    }
    if (lastError) {
      console.error(`FAIL ${file}: ${lastError.message}`)
      process.exit(1)
    }
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
}

// Measure durations with the browser's own media stack. This keeps the
// manifest honest even if a provider changes MP3 framing between runs.
const server = await serveDir(outDir)
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
})
const page = await browser.newPage()
await page.goto(server.url, { waitUntil: 'domcontentloaded' }).catch(() => {})
const measured = await page.evaluate(async (files) => {
  const results = {}
  for (const file of files) {
    const response = await fetch(`/${encodeURIComponent(file)}`)
    if (!response.ok) {
      results[file] = { error: `HTTP ${response.status}` }
      continue
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio()
    const duration = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(0), 8000)
      audio.onloadedmetadata = () => { clearTimeout(timer); resolve(audio.duration) }
      audio.onerror = () => { clearTimeout(timer); resolve(0) }
      audio.src = url
    })
    URL.revokeObjectURL(url)
    results[file] = {
      bytes: blob.size,
      contentType: response.headers.get('content-type') || '',
      duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 100) / 100 : 0,
    }
  }
  return results
}, narration.phrases.flatMap((phrase) => narration.voices.map((voice) => `${phrase.id}-${voice.id}.mp3`)))
await browser.close()
await server.close()

const phrases = []
for (const phrase of narration.phrases) {
  const files = {}
  for (const voice of narration.voices) {
    const file = `${phrase.id}-${voice.id}.mp3`
    const info = measured[file]
    if (!info || info.error || !info.duration) {
      console.error(`FAIL ${file}: could not decode MP3 (${info?.error || 'no duration'})`)
      process.exit(1)
    }
    files[voice.id] = {
      file,
      bytes: info.bytes,
      duration: info.duration,
      sha256: sha256(path.join(outDir, file)),
    }
  }
  phrases.push({ id: phrase.id, text: phrase.text, files })
}
const manifest = {
  schemaVersion: '1.0',
  description: 'Dummy narration fixtures for the shell preview. Not lesson audio.',
  generator: 'workflow/tools/make-preview-voice.mjs',
  provider: 'Microsoft Edge TTS',
  locale,
  outputFormat,
  voices: narration.voices,
  phrases,
}
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`OK preview voice — ${phrases.length} phrase(s) x ${narration.voices.length} voice(s), ${manifestFile}`)
