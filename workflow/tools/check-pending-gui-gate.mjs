#!/usr/bin/env node
// Resume guard for a nested gui-gate.
//
// Spec Kit re-runs a paused step's enclosing parent body on resume (see
// WorkflowEngine.execute: nested steps use step_offset=-1 and "resume will
// re-run the parent step and its nested body"). In the page loop, that body
// starts with implement-section and the AI page self-review. Re-running it
// rewrites review/self-review-page-<id>.json with a fresh reviewedAt, which
// changes the gui-gate digest and discards the verdict the teacher just cast.
//
// This guard runs after the cheap, read-only pre-gate steps and reports
// whether this run already has a pending or decided gate for the given step.
// The workflow skips the build/self-review block when it does, so the gate
// re-enters against the exact evidence the teacher reviewed and can consume
// the verdict. A missing/consumed/stale record returns resume=false: the run
// has not reached this gate yet, or the approval was already used and the
// page must be rebuilt for its next review.
import fs from 'node:fs'
import path from 'node:path'

function usage() {
  console.error('usage: node workflow/tools/check-pending-gui-gate.mjs --step-id <id> [--state-dir <dir>]')
}

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

const stepId = argValue('--step-id')
if (!stepId) {
  usage()
  process.exit(2)
}

const projectRoot = process.cwd()
const configured = argValue('--state-dir') || process.env.COURSEWARE_GATE_STATE_DIR || 'review/gui-gates'
const stateDir = path.resolve(projectRoot, configured)
const pendingDir = path.join(stateDir, 'pending')
const runId = (process.env.SPECKIT_WORKFLOW_RUN_ID || '').trim()

function emit(result) {
  process.stdout.write(JSON.stringify({ schemaVersion: '1.0', ...result }) + '\n')
}

if (!runId) {
  // Direct `specify workflow run` (not through run-workflow.mjs) does not
  // expose the run id to shell steps. Without it this guard cannot tell this
  // run's pending gate from a stale run's, so it must not skip anything.
  emit({ resume: false, stepId, runId: null, reason: 'SPECKIT_WORKFLOW_RUN_ID is not set' })
  process.exit(0)
}

if (!fs.existsSync(pendingDir)) {
  emit({ resume: false, stepId, runId, reason: 'no pending directory' })
  process.exit(0)
}

let entries
try {
  entries = fs.readdirSync(pendingDir, { withFileTypes: true })
} catch (error) {
  console.error(`FAIL cannot read ${pendingDir}: ${error.message}`)
  process.exit(1)
}

const matches = []
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith('.json')) continue
  let record
  try {
    record = JSON.parse(fs.readFileSync(path.join(pendingDir, entry.name), 'utf8'))
  } catch {
    // A malformed request is never evidence of a ready gate. Ignore it; the
    // gate itself will fail closed if it is the current request.
    continue
  }
  if (!record || typeof record !== 'object') continue
  if (record.runId !== runId || record.stepId !== stepId) continue
  if (record.status !== 'pending' && record.status !== 'decided') continue
  if (typeof record.gateKey !== 'string' || !record.gateKey) continue
  matches.push(record)
}

if (matches.length === 0) {
  emit({ resume: false, stepId, runId, reason: 'no pending or decided gate for this run' })
  process.exit(0)
}

const when = (record) => {
  const value = record.decidedAt || record.createdAt
  return typeof value === 'string' ? Date.parse(value) || 0 : 0
}
matches.sort((a, b) => when(b) - when(a))
const latest = matches[0]
emit({
  resume: true,
  stepId,
  runId,
  gateKey: latest.gateKey,
  status: latest.status,
  choice: typeof latest.choice === 'string' ? latest.choice : null,
  requestFile: path.relative(projectRoot, path.join(pendingDir, `${latest.gateKey}.json`)).split(path.sep).join('/'),
})
