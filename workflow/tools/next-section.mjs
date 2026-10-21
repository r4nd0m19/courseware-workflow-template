#!/usr/bin/env node
import { readData } from './lib.mjs'
import {
  readApprovals,
  readSectionManifest,
  sectionById,
  sectionPayload,
  validateSectionManifest,
} from './section-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}

const sectionsPath = opt('--sections')
const storyboardPath = opt('--storyboard')
const approvalsPath = opt(
  '--approvals',
  process.env.COURSEWARE_PAGE_APPROVALS || 'review/page-approvals.json',
)
const only = opt('--only')

if (!sectionsPath || !storyboardPath) {
  console.error(`usage: node next-section.mjs --sections <review-sections.yml> --storyboard <storyboard.yml> [options]

Options:
  --approvals <path>   approval ledger (default: $COURSEWARE_PAGE_APPROVALS or review/page-approvals.json)
  --only <id>          return only this section; error if already approved
`)
  process.exit(2)
}

const manifest = readSectionManifest(sectionsPath)
const storyboard = readData(storyboardPath)
const errors = validateSectionManifest(manifest, storyboard.slides || [], {
  requireAll: true,
})
if (errors.length) {
  console.error(`FAIL review sections\n${errors.map((e) => `  ${e}`).join('\n')}`)
  process.exit(1)
}

const approvals = readApprovals(approvalsPath)
const approved = new Set(Object.keys(approvals.sections || {}))

if (only) {
  const section = sectionById(manifest, only)
  if (!section) {
    console.error(`FAIL section ${only} is not declared in ${sectionsPath}`)
    process.exit(1)
  }
  if (approved.has(only)) {
    console.error(
      `FAIL section ${only} is already approved; run reopen-section.mjs first if it must be reworked`,
    )
    process.exit(1)
  }
  console.log(
    JSON.stringify({
      done: false,
      section: sectionPayload(section, storyboard.slides || []),
      approvedCount: approved.size,
      total: manifest.sections.length,
    }),
  )
  process.exit(0)
}

const next = manifest.sections.find((s) => !approved.has(s.id))
if (!next) {
  console.log(
    JSON.stringify({
      done: true,
      section: null,
      approvedCount: approved.size,
      total: manifest.sections.length,
    }),
  )
  process.exit(0)
}

console.log(
  JSON.stringify({
    done: false,
    section: sectionPayload(next, storyboard.slides || []),
    approvedCount: approved.size,
    total: manifest.sections.length,
  }),
)
