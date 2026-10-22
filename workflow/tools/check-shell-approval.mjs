#!/usr/bin/env node
// Verify the hash-bound shell approval before content production starts.
import path from 'node:path'
import { resolveShellDir } from './shell-lib.mjs'
import {
  readShellApproval,
  shellApprovalProblems,
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
const approval = opt(
  '--approval',
  shellSlug ? `review/shells/${shellSlug}/shell-approval.json` : '',
)
const expectRun = opt('--expect-run')
const runStatePath = opt('--run-state')
const manual = args.includes('--manual')

if (!shell || !approval) {
  console.error(
    'usage: node check-shell-approval.mjs --shell <shell-dir> [--shell-slug <slug>] [--approval <ledger>] [--expect-run <run-id>] [--manual]',
  )
  process.exit(2)
}

let dir
try {
  dir = resolveShellDir(shell)
} catch (error) {
  console.error(`FAIL shell approval — ${error.message}`)
  process.exit(1)
}

let ledger
try {
  ;({ ledger } = readShellApproval(approval))
} catch (error) {
  console.error(`FAIL shell approval — ${error.message}`)
  process.exit(1)
}

const problems = shellApprovalProblems(dir, ledger, {
  manual,
  ...(runStatePath ? { runStatePath } : {}),
  ...(expectRun ? { expectRun } : {}),
})
if (problems.length) {
  console.error(`FAIL shell approval — ${approval}`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}

console.log(
  `OK shell approval — ${ledger.shell} sha256 ${String(ledger.shellSha256).slice(0, 12)}… ` +
    `approved by ${ledger.approvedBy} (run ${ledger.gate?.runId || 'manual'})`,
)
