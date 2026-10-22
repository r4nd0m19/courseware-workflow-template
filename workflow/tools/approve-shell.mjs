#!/usr/bin/env node
// Record a hash-bound shell approval after the review-shell gate.
import fs from 'node:fs'
import path from 'node:path'
import { resolveShellDir } from './shell-lib.mjs'
import {
  REVIEW_SHELL_STEP_ID,
  gateRunProblems,
  shellPackageHash,
} from './shell-approval-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
const shell = opt('--shell')
const shellSlug = opt('--shell-slug')
const approvedBy = opt('--approved-by').trim()
const gateChoice = opt('--gate-choice').trim()
const gateStep = opt('--gate-step', REVIEW_SHELL_STEP_ID)
const runId = opt('--run-id').trim()
const runStatePath = opt('--run-state')
const out = opt('--out', shellSlug ? `review/shells/${shellSlug}/shell-approval.json` : '')
const previewPath = opt(
  '--preview',
  shellSlug ? `review/shells/${shellSlug}/shell-preview.json` : '',
)
const manual = args.includes('--manual')

if (!shell || !shellSlug || !approvedBy || !runId) {
  console.error(`usage: node approve-shell.mjs --shell <shell-dir> --shell-slug <slug> --approved-by <name> --gate-choice approve --run-id <workflow-run-id> [options]

Options:
  --gate-step <id>   gate step id (default: review-shell)
  --run-state <path> run state.json (default: .specify/workflows/runs/<id>/state.json)
  --out <path>       approval ledger (default: review/shells/<slug>/shell-approval.json)
  --preview <path>   shell preview JSON (default: review/shells/<slug>/shell-preview.json)
  --manual           test/debug only: skip the gate-run proof
`)
  process.exit(2)
}
if (gateStep !== REVIEW_SHELL_STEP_ID) {
  console.error(`FAIL shell approval — gate step must be "${REVIEW_SHELL_STEP_ID}", got ${JSON.stringify(gateStep)}`)
  process.exit(1)
}
if (gateChoice.toLowerCase() !== 'approve') {
  console.error(
    `FAIL shell approval — the review-shell gate choice is ${JSON.stringify(gateChoice)}, not "approve". ` +
      'Do not run approve-shell manually; resume the workflow and let the teacher decide the gate.',
  )
  process.exit(1)
}
if (!manual) {
  const problems = gateRunProblems(runId, { ...(runStatePath ? { runStatePath } : {}) })
  if (problems.length) {
    console.error(
      `FAIL shell approval — the workflow run cannot prove an approving review-shell gate:\n${problems
        .map((problem) => `  ${problem}`)
        .join('\n')}\n` +
        'Do not run approve-shell manually; resume the workflow and let the teacher decide the gate.',
    )
    process.exit(1)
  }
}

let shellInfo
try {
  const dir = resolveShellDir(shell)
  shellInfo = shellPackageHash(dir)
} catch (error) {
  console.error(`FAIL shell approval — ${error.message}`)
  process.exit(1)
}

let preview = {}
if (previewPath && fs.existsSync(previewPath)) {
  try {
    const data = JSON.parse(fs.readFileSync(previewPath, 'utf8'))
    preview = {
      playerUrl: data.playerUrl || data.previewUrl || '',
      reviewFile: data.reviewFile || '',
      slideCount: data.slideCount || data.slides?.length || 0,
      typeCount: data.typeCount || data.types?.length || 0,
      voiceCount: data.narration?.voiceCount || 0,
      pageCount: data.narration?.pageCount || 0,
    }
  } catch {
    preview = {}
  }
}

const approvedAt = new Date().toISOString()
const ledger = {
  schemaVersion: '1.0',
  shell: path.relative(process.cwd(), shellInfo.root).split(path.sep).join('/'),
  shellSlug,
  shellSha256: shellInfo.sha256,
  fileCount: shellInfo.files,
  approvedBy,
  approvedAt,
  gate: {
    stepId: REVIEW_SHELL_STEP_ID,
    choice: 'approve',
    runId,
    approvedAt,
  },
  preview,
  note: 'Whole-shell human approval, hash-bound to the exact shell package. Any shell file change voids this ledger; re-run the courseware-shell workflow.',
}
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
fs.writeFileSync(path.resolve(out), `${JSON.stringify(ledger, null, 2)}\n`)
console.log(
  `OK shell approval — ${ledger.shell} sha256 ${ledger.shellSha256.slice(0, 12)}… (${ledger.fileCount} files) -> ${out}`,
)
