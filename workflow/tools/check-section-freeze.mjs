#!/usr/bin/env node
import { readData, fail, ok } from './lib.mjs'
import { assertScriptApproved, DEFAULT_SCRIPT_APPROVAL } from './approval-lib.mjs'
import { parseScript } from './script-lib.mjs'
import {
  approvalProblems,
  readApprovals,
  readSectionManifest,
  validateSectionManifest,
} from './section-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}

const sectionsPath = opt('--sections')
const storyboardPath = opt('--storyboard')
const scriptPath = opt('--script')
const approvalsPath = opt('--approvals', 'review/page-approvals.json')
const approvalPath = opt('--approval', DEFAULT_SCRIPT_APPROVAL)
const screenshots = opt('--screenshots', '')
const requireAll = args.includes('--require-all')

if (!sectionsPath || !storyboardPath || !scriptPath) {
  console.error(`usage: node check-section-freeze.mjs --sections <file> --storyboard <file> --script <courseware.md> [options]

Options:
  --approvals <path>   approval ledger (default: review/page-approvals.json)
  --approval <path>    whole-script approval ledger (default: review/script-approval.json)
  --screenshots <dir>  also require approved screenshots to exist
  --require-all        every section must have an approval
`)
  process.exit(2)
}

try {
  assertScriptApproved(scriptPath, { approvalPath })
} catch (error) {
  fail('script approval', error.problems || [error.message])
  process.exit(1)
}

const manifest = readSectionManifest(sectionsPath)
const storyboard = readData(storyboardPath)
const parsed = parseScript(scriptPath)
const errors = validateSectionManifest(manifest, storyboard.slides || [], {
  requireAll: true,
})
if (errors.length) {
  fail('review sections', errors)
  process.exit(1)
}

const approvals = readApprovals(approvalsPath)
const problems = approvalProblems(approvals, manifest, parsed.slides, {
  screenshots: screenshots || undefined,
  requireAll,
})
if (problems.length) {
  fail('approved sections frozen', problems)
  process.exit(1)
}

const approved = Object.keys(approvals.sections || {}).length
const frozenSlides = Object.values(approvals.sections || {}).reduce(
  (n, s) => n + Object.keys(s.slides || {}).length,
  0,
)
ok(
  'approved sections frozen',
  `${approved}/${manifest.sections.length} section(s), ${frozenSlides} slide(s) unchanged`,
)
