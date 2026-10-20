#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { fail, ok, readData, validateWithSchema } from './lib.mjs'
import { assertScriptApproved, DEFAULT_SCRIPT_APPROVAL } from './approval-lib.mjs'
import {
  audioFilePath,
  normalizeNarration,
  parseOnly,
  readNarrationSlides,
  selectNarrationSlides,
} from './narration-lib.mjs'

const argv = process.argv.slice(2)
function option(name, fallback = '') {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const positional = []
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) {
    if (['--audio-root', '--only', '--approval'].includes(argv[i])) i += 1
    continue
  }
  positional.push(argv[i])
}
const [scriptPath, manifestPath] = positional
const audioRoot = option('--audio-root')
const only = parseOnly(option('--only'))
const approvalPath = option('--approval', DEFAULT_SCRIPT_APPROVAL)

if (!scriptPath || !manifestPath) {
  console.error(
    'usage: node check-narration.mjs <courseware.md> <narration.json> [--audio-root <dir>] [--only S01,S02] [--approval review/script-approval.json]',
  )
  process.exit(2)
}

try {
  assertScriptApproved(scriptPath, { approvalPath })
} catch (error) {
  console.error(`FAIL narration — ${error.message}`)
  process.exit(1)
}

const errors = []
let manifest
let parsed
try {
  manifest = readData(manifestPath)
  parsed = readNarrationSlides(scriptPath)
} catch (error) {
  console.error(`FAIL narration — ${error.message}`)
  process.exit(1)
}

const schemaCheck = validateWithSchema(
  fileURLToPath(new URL('../schemas/narration.schema.json', import.meta.url)),
  manifest,
)
for (const error of schemaCheck.errors) errors.push(`schema ${error}`)

if (manifest.sourceHash !== parsed.sourceHash) {
  errors.push(
    `sourceHash mismatch: manifest=${manifest.sourceHash} script=${parsed.sourceHash} (regenerate audio from the approved script)`,
  )
}

const expected = selectNarrationSlides(parsed.slides, only)
const expectedIds = new Set(expected.map((slide) => slide.id))
const knownIds = new Set(parsed.slides.map((slide) => slide.id))
const byId = new Map()
for (const entry of manifest.slides || []) {
  if (byId.has(entry.id)) errors.push(`duplicate slide ${entry.id} in manifest`)
  byId.set(entry.id, entry)
  if (!knownIds.has(entry.id)) errors.push(`manifest slide ${entry.id} is not in the script`)
}

const voiceIds = (manifest.voices || []).map((voice) => voice.id)
if (manifest.defaultVoice && !voiceIds.includes(manifest.defaultVoice)) {
  errors.push(`defaultVoice ${manifest.defaultVoice} is not in manifest voices`)
}

let audioCount = 0
for (const slide of expected) {
  const entry = byId.get(slide.id)
  if (!entry) {
    errors.push(`missing narration for slide ${slide.id}`)
    continue
  }
  if (entry.rawText.trim() !== slide.rawText.trim()) {
    errors.push(`slide ${slide.id}: rawText differs from the approved script`)
  }
  const expectedSpoken = normalizeNarration(slide.rawText)
  if (entry.spokenText !== expectedSpoken) {
    errors.push(`slide ${slide.id}: spokenText is not the normalized approved narration`)
  }
  if (/\[暂停\]|【暂停】|`|TODO|TBD|待补|待定/i.test(entry.spokenText)) {
    errors.push(`slide ${slide.id}: spokenText still contains a marker, backtick, or placeholder`)
  }
  for (const voiceId of voiceIds) {
    const url = entry.audio?.[voiceId]
    if (!url) {
      errors.push(`slide ${slide.id}: missing audio for voice ${voiceId}`)
      continue
    }
    audioCount += 1
    if (audioRoot) {
      const file = audioFilePath(audioRoot, slide.id, voiceId)
      if (!fs.existsSync(file)) {
        errors.push(`slide ${slide.id}/${voiceId}: audio file missing at ${file}`)
      } else if (fs.statSync(file).size <= 1024) {
        errors.push(`slide ${slide.id}/${voiceId}: audio file is too small (${fs.statSync(file).size} bytes)`)
      }
    }
  }
}

// A manifest generated from a wider slice may contain extra slides; that is fine.
// A manifest generated from a different script is not, and is caught by sourceHash.
for (const id of expectedIds) {
  if (!byId.has(id)) errors.push(`manifest does not cover expected slide ${id}`)
}

if (errors.length) {
  fail('narration', errors)
  process.exit(1)
}
ok(
  'narration',
  `${expected.length} slide(s), ${voiceIds.length} voice(s), ${audioCount} audio file(s)${audioRoot ? ' verified on disk' : ''}`,
)
