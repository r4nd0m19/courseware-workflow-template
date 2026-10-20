#!/usr/bin/env node
// Fail-closed wrapper around `specify workflow run` / `resume`.
//
// Spec Kit treats a paused gate as a successful CLI outcome (exit 0), because
// an interactive user can resume it later. An agent cannot: it sees exit 0 and
// keeps going, possibly running downstream tools by hand. This wrapper makes
// "paused" a distinct non-zero result for non-interactive runs and prints the
// resume command, while leaving interactive runs untouched so a human can
// answer the gate.
//
// This mirrors how CI runners treat a job that is waiting for approval: the
// pipeline is not green until the protected environment actually authorizes it.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const rawArgs = process.argv.slice(2)

function usage() {
  console.error(`usage:
  node workflow/tools/run-workflow.mjs [run] <workflow-id-or-yaml> [specify options]
  node workflow/tools/run-workflow.mjs resume <run-id> [specify options]

Examples:
  node workflow/tools/run-workflow.mjs courseware-production -i lesson=001-2d-arrays ...
  node workflow/tools/run-workflow.mjs resume 1a2b3c4d

Exit codes:
  0  workflow completed
  1  workflow failed, or the CLI failed
  2  the CLI output was not the expected JSON
  3  workflow paused at a gate; a human must resume it interactively`)
  process.exit(2)
}

if (rawArgs.includes('--help') || rawArgs.includes('-h') || rawArgs.length === 0) usage()

const command = rawArgs[0] === 'resume' ? 'resume' : 'run'
const args = rawArgs[0] === 'resume' || rawArgs[0] === 'run' ? rawArgs.slice(1) : rawArgs
if (command === 'resume' && args.length === 0) usage()

// Always ask for machine-readable output. Remove a caller-supplied --json so
// the flag appears exactly once.
const specifyArgs = ['workflow', command, ...args.filter((a) => a !== '--json'), '--json']
const specifyBin = process.env.SPECIFY_BIN || 'specify'

// Interactive runs must see the gate prompt on the terminal. The wrapper's
// fail-closed guarantee is for non-interactive (agent/CI) runs, where Spec Kit
// would otherwise return exit 0 with status "paused".
if (process.stdin.isTTY && process.stdout.isTTY) {
  const result = spawnSync(specifyBin, specifyArgs, { stdio: 'inherit' })
  if (result.error) {
    console.error(`FAIL cannot start ${specifyBin}: ${result.error.message}`)
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

const result = spawnSync(specifyBin, specifyArgs, {
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
if (result.error) {
  console.error(`FAIL cannot start ${specifyBin}: ${result.error.message}`)
  process.exit(1)
}

const stdout = (result.stdout || '').trim()
let outcome = null
if (stdout) {
  try {
    outcome = JSON.parse(stdout)
  } catch {
    // Some CLI failures print human text instead of JSON. Preserve it.
  }
}
if (outcome && typeof outcome === 'object') process.stdout.write(`${stdout}\n`)
else if (stdout) process.stderr.write(`${stdout}\n`)

if (result.status !== 0) {
  console.error(`FAIL specify workflow ${command} exited ${result.status}`)
  process.exit(result.status || 1)
}
if (!outcome) {
  console.error('FAIL specify workflow returned no parseable JSON outcome')
  process.exit(2)
}

const status = outcome.status
const runId = outcome.run_id || '<unknown>'
const step = outcome.current_step_id || '<unknown>'

if (status === 'completed' || status === 'succeeded' || status === 'success') {
  console.log(`OK workflow ${outcome.workflow_id || ''} completed (run ${runId})`.replace('  ', ' '))
  process.exit(0)
}

if (status === 'paused') {
  const gateMessage =
    outcome.gate && typeof outcome.gate.message === 'string' ? outcome.gate.message.trim() : ''
  let showFile = ''
  try {
    const safeRunId = path.basename(runId)
    const state = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), '.specify/workflows/runs', safeRunId, 'state.json'),
        'utf8',
      ),
    )
    const result = (state.step_results || {})[step]
    const candidate = result && result.output && result.output.show_file
    if (typeof candidate === 'string' && candidate.trim()) showFile = candidate.trim()
  } catch {
    // The review material is optional; a missing/inaccessible run state must
    // not hide the pause itself.
  }
  const lines = [
    `PAUSED workflow ${outcome.workflow_id || ''} at step ${step} (run ${runId})`,
    'A human must decide this gate. An agent must stop here and must not run downstream tools by hand.',
    `Resume interactively: specify workflow resume ${runId}`,
    outcome.gate && Array.isArray(outcome.gate.options)
      ? `Gate options: ${outcome.gate.options.join(' / ')}`
      : '',
  ]
  if (gateMessage) lines.push('', 'Review request:', gateMessage)
  if (showFile) lines.push('', `Review file: ${showFile}`)
  console.error(lines.filter((line) => line !== undefined).join('\n'))
  process.exit(3)
}

console.error(`FAIL workflow ${outcome.workflow_id || ''} ended with status ${JSON.stringify(status)} (run ${runId})`)
process.exit(1)
