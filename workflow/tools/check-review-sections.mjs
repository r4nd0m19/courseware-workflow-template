#!/usr/bin/env node
import { readData, fail, ok } from './lib.mjs'
import { readSectionManifest, validateSectionManifest } from './section-lib.mjs'

const args = process.argv.slice(2)
const sectionsPath = args.find((a) => !a.startsWith('--'))
const storyboardPath = args[1] && !args[1].startsWith('--') ? args[1] : ''
const requireApproved = args.includes('--require-approved')

if (!sectionsPath || !storyboardPath) {
  console.error(
    'usage: node check-review-sections.mjs <review-sections.yml> <storyboard.yml> [--require-approved]',
  )
  process.exit(2)
}

let manifest
let storyboard
try {
  manifest = readSectionManifest(sectionsPath)
  storyboard = readData(storyboardPath)
} catch (err) {
  fail('review sections', [err.message])
  process.exit(1)
}

const errors = validateSectionManifest(manifest, storyboard.slides || [], {
  requireAll: true,
  requireApproved,
})
if (errors.length) {
  fail('review sections', errors)
  process.exit(1)
}

const active = (storyboard.slides || []).filter((s) => s.status !== 'SKIP')
ok(
  'review sections',
  `${manifest.sections.length} section(s), ${active.length} slide(s), rolling render review`,
)
