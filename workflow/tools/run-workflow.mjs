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
//
// `gui-gate` steps pause the same way, but their verdict comes from the
// teacher's explicit answer recorded with `workflow/tools/gate-review.mjs`.
// For those we print the review file, the decide command, and the resume
// command. The agent must not use `specify workflow resume` or `-i`, because a
// single approve passed there would persist in the run inputs and pre-answer
// later gates (including every page in the review loop).
import { randomBytes } from 'node:crypto'
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

// Spec Kit exposes the run id to Python steps but not to shell-step
// environments. The page loop's resume guard needs it to distinguish this
// run's pending gate from a stale one. Generate it here and let Spec Kit use
// it via SPECKIT_WORKFLOW_RUN_ID; on resume, take the explicit run-id
// positional so a guard never sees a stale value inherited from the caller.
function resumeRunId(values) {
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (value === '-i' || value === '--input') {
      i += 1
      continue
    }
    if (value.startsWith('-')) continue
    return value
  }
  return ''
}
const effectiveRunId = command === 'resume'
  ? resumeRunId(args)
  : (process.env.SPECKIT_WORKFLOW_RUN_ID || randomBytes(4).toString('hex'))
const childEnv = { ...process.env }
if (effectiveRunId) childEnv.SPECKIT_WORKFLOW_RUN_ID = effectiveRunId
else delete childEnv.SPECKIT_WORKFLOW_RUN_ID

// One project may hold multiple lessons. The runtime state (review ledgers,
// screenshots, gui-gate state) is scoped by lesson_slug so two runs cannot
// overwrite each other. Tool defaults read these variables; explicit
// --approval/--approvals/--screenshots/--state-dir flags still win.
function inputValue(values, key) {
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (value !== '-i' && value !== '--input') continue
    const assignment = values[i + 1]
    if (typeof assignment !== 'string') continue
    const eq = assignment.indexOf('=')
    if (eq < 0) continue
    if (assignment.slice(0, eq) === key) return assignment.slice(eq + 1)
    i += 1
  }
  return ''
}

function lessonFromRunInputs(runId) {
  if (!runId || !/^[A-Za-z0-9._-]+$/.test(runId) || runId.includes('..')) return ''
  try {
    const state = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), '.specify', 'workflows', 'runs', runId, 'inputs.json'),
        'utf8',
      ),
    )
    const inputs = state.inputs && typeof state.inputs === 'object' ? state.inputs : state
    return String(inputs.lesson_slug || '').trim()
  } catch {
    return ''
  }
}

const rawLesson = command === 'resume'
  ? lessonFromRunInputs(effectiveRunId)
  : inputValue(args, 'lesson_slug')
const lessonSlug =
  rawLesson &&
  /^[A-Za-z0-9._-]+$/.test(rawLesson) &&
  !rawLesson.includes('..')
    ? rawLesson
    : ''
if (lessonSlug) {
  const reviewDir = `review/${lessonSlug}`
  childEnv.COURSEWARE_LESSON_SLUG = lessonSlug
  childEnv.COURSEWARE_REVIEW_DIR = reviewDir
  childEnv.COURSEWARE_SCREENSHOTS_DIR = `screenshots/${lessonSlug}`
  childEnv.COURSEWARE_SCRIPT_APPROVAL = `${reviewDir}/script-approval.json`
  childEnv.COURSEWARE_PAGE_APPROVALS = `${reviewDir}/page-approvals.json`
  childEnv.COURSEWARE_GATE_STATE_DIR = `${reviewDir}/gui-gates`
}
// No lesson_slug: leave any caller-provided COURSEWARE_* state-dir overrides
// intact (tests and explicit manual runs set them deliberately).

// Interactive runs must see the gate prompt on the terminal. The wrapper's
// fail-closed guarantee is for non-interactive (agent/CI) runs, where Spec Kit
// would otherwise return exit 0 with status "paused".
if (process.stdin.isTTY && process.stdout.isTTY) {
  const result = spawnSync(specifyBin, specifyArgs, {
    stdio: 'inherit',
    // A parent process may have exported the non-interactive marker; an
    // interactive run must clear it or the gate would skip its prompt.
    env: { ...childEnv, COURSEWARE_GATE_NONINTERACTIVE: '' },
  })
  if (result.error) {
    console.error(`FAIL cannot start ${specifyBin}: ${result.error.message}`)
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

const result = spawnSync(specifyBin, specifyArgs, {
  // A pipe (closed immediately via input) is not a TTY, on Windows too. An
  // ignored stdin becomes NUL there, where Python's isatty() can still report
  // True and a built-in gate would block on a prompt nobody can answer.
  stdio: ['pipe', 'pipe', 'inherit'],
  input: '',
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  // The wrapper knows this run is non-interactive; tell gui-gate explicitly
  // instead of trusting isatty alone.
  env: { ...childEnv, COURSEWARE_GATE_NONINTERACTIVE: '1' },
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
  const safeRunId = path.basename(runId)
  let state = null
  try {
    state = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), '.specify/workflows/runs', safeRunId, 'state.json'),
        'utf8',
      ),
    )
  } catch {
    // The review material is optional; a missing/inaccessible run state must
    // not hide the pause itself.
  }

  // A nested gate lives at a namespaced key (`parent:step:iteration`), so try
  // the exact id first and fall back to a suffix match.
  let guiGate = null
  for (const [key, result] of Object.entries((state && state.step_results) || {})) {
    const candidate = result && result.output && result.output.guiGate
    if (!candidate || typeof candidate !== 'object') continue
    if (candidate.runId && candidate.runId !== runId) continue
    if (key === step || key.endsWith(`:${step}`)) {
      guiGate = candidate
      break
    }
    if (!guiGate) guiGate = candidate
  }

  if (guiGate) {
    const message = typeof guiGate.message === 'string' ? guiGate.message.trim() : ''
    const reviewFile =
      typeof guiGate.reviewFile === 'string' && guiGate.reviewFile
        ? guiGate.reviewFile
        : typeof guiGate.showFile === 'string'
          ? guiGate.showFile
          : ''
    const absoluteReviewFile = reviewFile
      ? path.resolve(process.cwd(), reviewFile.replace(/[\\/]+/g, path.sep))
      : ''
    const gateStep =
      typeof guiGate.stepId === 'string' && guiGate.stepId ? guiGate.stepId : step
    const stateDir =
      typeof guiGate.stateDir === 'string' && guiGate.stateDir
        ? ` --state-dir ${guiGate.stateDir}`
        : ''
    const lines = [
      `PAUSED workflow ${outcome.workflow_id || ''} at step ${step} (run ${runId})`,
      'This is a human review gate. Show the review file/link to the teacher and wait for their explicit choice; the agent must not answer it.',
      `Get the gate details: node workflow/tools/gate-review.mjs show ${runId}${stateDir}`,
      `Record the teacher's answer: node workflow/tools/gate-review.mjs decide ${runId} --step ${gateStep} --choice <approve|reject>${stateDir}`,
      `Then resume the workflow: node workflow/tools/run-workflow.mjs resume ${runId}`,
      'Do not call `specify workflow resume` directly, do not pass -i, and do not edit pending/verdict files by hand.',
      Array.isArray(guiGate.options) ? `Gate options: ${guiGate.options.join(' / ')}` : '',
    ]
    if (message) lines.push('', 'Review request:', message)
    if (absoluteReviewFile) {
      lines.push('', `Review file: ${absoluteReviewFile}`)
    }
    if (Array.isArray(guiGate.links) && guiGate.links.length) {
      lines.push('', 'Review links:')
      for (const link of guiGate.links) {
        if (!link || typeof link.url !== 'string' || !link.url) continue
        lines.push(`  - ${link.label || 'link'}: ${link.url}`)
      }
    }
    if (Array.isArray(guiGate.files) && guiGate.files.length) {
      lines.push('', 'Hash-bound evidence:')
      for (const file of guiGate.files) {
        if (!file || typeof file.path !== 'string') continue
        const sha = typeof file.sha256 === 'string' ? ` sha256:${file.sha256.slice(0, 12)}…` : ''
        lines.push(`  - ${file.role || 'file'}: ${file.path}${sha}`)
      }
    }
    console.error(lines.filter((line) => line !== undefined).join('\n'))
    process.exit(3)
  }

  const gateMessage =
    outcome.gate && typeof outcome.gate.message === 'string' ? outcome.gate.message.trim() : ''
  let showFile = ''
  try {
    const result = (state && state.step_results && state.step_results[step]) || null
    const candidate = result && result.output && result.output.show_file
    if (typeof candidate === 'string' && candidate.trim()) showFile = candidate.trim()
  } catch {
    // Keep the pause visible even if the state shape is unexpected.
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
