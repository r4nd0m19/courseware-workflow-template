#!/usr/bin/env node
// Compact evidence for the single-shot illustration-prompt writer.
import fs from 'node:fs'
import path from 'node:path'
import { readData } from './lib.mjs'
import { parseScript } from './script-lib.mjs'
import { parseFlagValue } from './self-review-lib.mjs'

const args = process.argv.slice(2)
const lessonSlug = parseFlagValue(args, '--lesson-slug')
const lesson = parseFlagValue(args, '--lesson', lessonSlug)
const scriptPath = parseFlagValue(args, '--script')
const shellPath = parseFlagValue(args, '--shell', 'shells/branch-choice')
const outPath = parseFlagValue(args, '--out', path.join('review', lessonSlug, 'art-brief-evidence.json'))
if (!lessonSlug || !scriptPath || !shellPath) {
  console.error(
    'usage: node build-art-brief-evidence.mjs --lesson-slug <slug> --lesson <title> --script <courseware.md> --shell <shells/id> [--out <evidence.json>]',
  )
  process.exit(2)
}
const shell = readData(path.join(shellPath, 'shell.json'))
const parsed = parseScript(scriptPath)
const evidence = {
  schemaVersion: '1.0',
  mode: 'art-brief',
  lessonSlug,
  lesson,
  shell: shell.id || path.basename(shellPath),
  slots: (shell.assets?.illustrations || []).map((art) => ({
    slot: art.slot,
    alt: art.alt || '',
    reference: art.reference || '',
    referenceBytes: art.referenceBytes || 0,
    ratio: art.ratio || '1:1',
    size: art.size || '1k',
    blend: art.blend || '',
    basePrompt: art.prompt || '',
  })),
  scriptSlides: parsed.slides
    .filter((slide) => slide.machine?.status !== 'SKIP')
    .map((slide) => ({
      id: slide.id,
      title: slide.headingTitle,
      screenContent: slide.screenContent,
      narration: slide.narration,
    })),
}
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(path.resolve(outPath), `${JSON.stringify(evidence, null, 2)}\n`)
console.log(`OK art brief evidence — ${outPath}`)
