#!/usr/bin/env node
import { readData, fail, ok } from './lib.mjs'
import { assertScriptApproved, DEFAULT_SCRIPT_APPROVAL } from './approval-lib.mjs'
import { readSectionManifest, validateSectionManifest } from './section-lib.mjs'

const args = process.argv.slice(2)
const options = { script: '', approval: DEFAULT_SCRIPT_APPROVAL, requireApproved: false }
const positionals = []
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--script') {
    options.script = args[i + 1] || ''
    i += 1
  } else if (arg === '--approval') {
    options.approval = args[i + 1] || ''
    i += 1
  } else if (arg === '--require-approved') {
    options.requireApproved = true
  } else if (arg.startsWith('--')) {
    console.error(`unknown option ${arg}`)
    process.exit(2)
  } else {
    positionals.push(arg)
  }
}
const [sectionsPath, storyboardPath] = positionals

if (!sectionsPath || !storyboardPath) {
  console.error(
    'usage: node check-review-sections.mjs <review-sections.yml> <storyboard.yml> [--require-approved] [--script <courseware.md>] [--approval review/script-approval.json]',
  )
  process.exit(2)
}

if (options.script) {
  try {
    assertScriptApproved(options.script, { approvalPath: options.approval })
  } catch (error) {
    fail('review sections', [error.message])
    process.exit(1)
  }
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
  requireApproved: options.requireApproved,
})
if (errors.length) {
  fail('review sections', errors)
  process.exit(1)
}

const active = (storyboard.slides || []).filter((s) => s.status !== 'SKIP')
ok(
  'review sections',
  `${manifest.sections.length} page(s) / ${active.length} slide(s), exactly one slide per section`,
)
