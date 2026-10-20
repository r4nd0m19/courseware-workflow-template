#!/usr/bin/env node
// Fail-closed gate for downstream stages: the current courseware.md must match
// the hash-bound ledger written only after the human review-script gate.
import path from 'node:path'
import { DEFAULT_SCRIPT_APPROVAL, describeScriptApproval, scriptApprovalProblems } from './approval-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const scriptPath = args.find((a) => !a.startsWith('--'))
const approvalPath = opt('--approval', DEFAULT_SCRIPT_APPROVAL)
const runStatePath = opt('--run-state')
const expectRun = opt('--expect-run')
const asJson = args.includes('--json')

if (!scriptPath) {
  console.error(`usage: node check-script-approval.mjs <courseware.md> [--approval review/script-approval.json] [--run-state path] [--expect-run id] [--json]

Exit 0 only when the current script matches the hash-bound approval ledger
written after the human review-script gate, and the recorded workflow run
proves that gate completed with "approve". Any missing ledger, missing gate
decision, missing/paused run, edited script, DRAFT slide or stale hash is a
blocking failure.`)
  process.exit(2)
}

const checkOptions = {
  approvalPath,
  ...(runStatePath ? { runStatePath } : {}),
  ...(expectRun ? { expectRunId: expectRun } : {}),
}

const problems = scriptApprovalProblems(scriptPath, checkOptions)
if (asJson) {
  const payload = {
    ok: problems.length === 0,
    script: path.resolve(scriptPath),
    approval: path.resolve(approvalPath),
    problems,
  }
  if (!problems.length) {
    Object.assign(payload, describeScriptApproval(scriptPath, checkOptions))
  }
  console.log(JSON.stringify(payload, null, 2))
} else if (problems.length) {
  console.error('FAIL script approval')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('  Downstream stages (component-plan, narration, storyboard, components, deck, screenshots) are blocked until the script passes review-script again.')
} else {
  const details = describeScriptApproval(scriptPath, checkOptions)
  console.log(
    `OK script approval — ${details.slideCount} slide(s), approved by ${details.approvedBy} at ${details.approvedAt} in run ${details.runId}; hashes match`,
  )
}
process.exit(problems.length ? 1 : 0)
