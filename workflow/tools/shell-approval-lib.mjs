// Hash-bound shell approval.
//
// The shell review is a separate, content-independent gate. This module
// records and verifies that the teacher approved one exact shell package:
// every file that can affect the rendered shell is hashed, and the ledger
// points at the completed `review-shell` gate in the courseware-shell run.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { reviewRunStatePath } from './approval-lib.mjs'
import { loadShell } from './shell-lib.mjs'

export const SHELL_WORKFLOW_ID = 'courseware-shell'
export const REVIEW_SHELL_STEP_ID = 'review-shell'
export const DEFAULT_SHELL_APPROVAL_DIR = 'review/shells'

export function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function walkFiles(dir, root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= 5000) break
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === '.cache' ||
      entry.name === 'review' ||
      entry.name === 'screenshots' ||
      entry.name === 'shell-shots'
    ) {
      continue
    }
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(absolute, root, out)
    } else if (entry.isFile() && !/\.log$/i.test(entry.name)) {
      out.push(absolute)
    }
  }
  return out
}

// Hash the shell package, not just shell.json: CSS/JS/assets/audio/style pack
// can all change what the teacher reviewed.
export function shellPackageHash(shellDir) {
  const { root } = loadShell(shellDir)
  const files = walkFiles(root, root).map((file) => path.resolve(file)).sort()
  const entries = files.map((file) => {
    const relative = path.relative(root, file).split(path.sep).join('/')
    return { path: relative, sha256: sha256File(file) }
  })
  return {
    root,
    sha256: sha256Text(JSON.stringify(entries)),
    files: entries.length,
  }
}

export function gateRunProblems(runId, options = {}) {
  const {
    runStatePath,
    workflowId = SHELL_WORKFLOW_ID,
    stepId = REVIEW_SHELL_STEP_ID,
  } = options
  if (typeof runId !== 'string' || !runId.trim() || /[/\\\0]/.test(runId)) {
    return [`approval gate run id is ${JSON.stringify(runId)}, expected a single run directory name`]
  }
  const statePath = reviewRunStatePath(runId, { runStatePath })
  let state
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  } catch (error) {
    return [
      `cannot read workflow run state for ${runId}: ${statePath} (${error.code || error.message})`,
    ]
  }
  const problems = []
  if (state.run_id && state.run_id !== runId) {
    problems.push(`workflow run state is for ${JSON.stringify(state.run_id)}, expected ${JSON.stringify(runId)}`)
  }
  if (state.workflow_id && state.workflow_id !== workflowId) {
    problems.push(
      `workflow run ${runId} is ${JSON.stringify(state.workflow_id)}, expected ${JSON.stringify(workflowId)}`,
    )
  }
  const results = state.step_results || state.steps || {}
  const step = results[stepId]
  if (!step) {
    problems.push(`workflow run ${runId} has no ${stepId} step result`)
    return problems
  }
  if (step.status !== 'completed') {
    problems.push(
      `${stepId} in run ${runId} is ${JSON.stringify(step.status)}, expected "completed" (a paused gate is not an approval)`,
    )
  }
  const choice = step.output && step.output.choice
  if (String(choice || '').toLowerCase() !== 'approve') {
    problems.push(`${stepId} in run ${runId} chose ${JSON.stringify(choice)}, expected "approve"`)
  }
  return problems
}

export function readShellApproval(approvalPath) {
  const absolute = path.resolve(approvalPath)
  if (!fs.existsSync(absolute)) throw new Error(`shell approval ledger not found: ${approvalPath}`)
  let ledger
  try {
    ledger = JSON.parse(fs.readFileSync(absolute, 'utf8'))
  } catch (error) {
    throw new Error(`shell approval ledger is not valid JSON: ${approvalPath}: ${error.message}`)
  }
  return { ledger, path: absolute }
}

export function shellApprovalProblems(shellDir, ledger, options = {}) {
  const problems = []
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    return ['shell approval ledger must be an object']
  }
  if (String(ledger.schemaVersion || '') !== '1.0') {
    problems.push(`shell approval schemaVersion is ${JSON.stringify(ledger.schemaVersion)}, expected "1.0"`)
  }
  const expectedShell = splitPath(path.relative(process.cwd(), path.resolve(shellDir)))
  const ledgerShell = splitPath(String(ledger.shell || ''))
  if (ledgerShell !== expectedShell) {
    problems.push(`shell approval is for ${JSON.stringify(ledger.shell)}, expected ${JSON.stringify(expectedShell)}`)
  }
  const current = shellPackageHash(shellDir)
  if (String(ledger.shellSha256 || '').toLowerCase() !== current.sha256.toLowerCase()) {
    problems.push(
      `stale shell approval: package changed (approved ${String(ledger.shellSha256 || '').slice(0, 12)}…, now ${current.sha256.slice(0, 12)}…)`,
    )
  }
  if (!options.manual) {
    const gate = ledger.gate || {}
    problems.push(
      ...gateRunProblems(gate.runId, {
        ...(options.runStatePath ? { runStatePath: options.runStatePath } : {}),
        stepId: gate.stepId || REVIEW_SHELL_STEP_ID,
      }),
    )
  }
  if (options.expectRun && ledger.gate?.runId !== options.expectRun) {
    problems.push(
      `shell approval gate run is ${JSON.stringify(ledger.gate?.runId)}, expected ${JSON.stringify(options.expectRun)}`,
    )
  }
  return problems
}

export function splitPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '')
}
