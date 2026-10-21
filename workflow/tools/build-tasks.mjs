#!/usr/bin/env node
// Deterministic tasks.md projection. tasks.md is an internal implementation
// breakdown derived from the approved storyboard; it does not need an AI
// command or a human gate. One section is one page.
import fs from 'node:fs'
import path from 'node:path'
import { readData } from './lib.mjs'
import { readSectionManifest } from './section-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const lesson = opt('--lesson')
const sectionsPath = opt('--sections')
const storyboardPath = opt('--storyboard')
const outPath = opt('--out')

if (!lesson || !sectionsPath || !storyboardPath || !outPath) {
  console.error(
    'usage: node build-tasks.mjs --lesson <id> --sections <review-sections.yml> --storyboard <storyboard.yml> --out <tasks.md>',
  )
  process.exit(2)
}

const manifest = readSectionManifest(sectionsPath)
const storyboard = readData(storyboardPath)
const slides = new Map((storyboard.slides || []).map((slide) => [slide.id, slide]))
const lines = [
  `# Tasks: ${lesson}`,
  '',
  'Generated deterministically from `review-sections.yml` and `storyboard.yml`.',
  'This is an internal implementation breakdown; the teacher reviews the script and rendered pages, not this file.',
  '',
  '## Page tasks',
  '',
  '| Section | Slide | Title | Components | Deps | DoD |',
  '|---|---|---|---|---|---|',
]
for (const section of manifest.sections) {
  const slide = section.slides[0] ? slides.get(section.slides[0]) : null
  const title = slide && slide.title ? slide.title : section.title
  const components = slide && Array.isArray(slide.components) ? slide.components.join(', ') : ''
  const deps = 'previous page approved; script approved; components registered or staged'
  const dod =
    'script fidelity; schema; vocabulary; coverage; no overflow; overlap; screenshot bound to deck; self-review; human review'
  lines.push(
    `| ${section.id} | ${section.slides.join(', ')} | ${title} | ${components || '—'} | ${deps} | ${dod} |`,
  )
}
lines.push(
  '',
  '## Gates',
  '',
  '- script approval ledger matches the current `courseware.md`',
  '- storyboard is a projection of the approved script (`script-to-storyboard --check`)',
  '- schema / coverage / vocabulary / teaching checks',
  '- per page: deck data, rendered screenshot, overflow, overlap, baseline, narration, quiz keys, concepts',
  '- per page: self-review (with reference adaptation) before the human page gate',
  '- all pages frozen before Alpha',
  '',
  '## Component tasks',
  '',
  'New/extend components are built on the first page that uses them, reviewed with that page, and registered only after the page gate approves.',
  '',
)
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(outPath, lines.join('\n'))
console.log(`OK tasks — ${outPath}`)
