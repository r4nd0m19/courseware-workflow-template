// Fail-closed guards for page-level tools.
//
// The per-page review loop lives in the `courseware-production` workflow: each
// page is implemented, rendered, self-reviewed, and then paused at a
// `review-page` gui-gate. Rendering tools are also callable directly, which is
// useful for debugging but lets an agent batch-render pages and skip the gate.
//
// These helpers make the workflow the default path: page-level tools refuse to
// run unless they are inside a production run (the wrapper exports
// SPECKIT_WORKFLOW_RUN_ID for shell steps) or the caller explicitly passes
// `--manual` for a test/debug invocation. `freeze-section` additionally needs
// the approving `review-page` gate result in the same run.
import fs from 'node:fs'
import path from 'node:path'

export const PRODUCTION_WORKFLOW = 'courseware-production'

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function safeRunId(runId) {
  return (
    typeof runId === 'string' &&
    /^[A-Za-z0-9._-]+$/.test(runId) &&
    runId !== '.' &&
    runId !== '..' &&
    !runId.includes('..')
  )
}

export function readRunState(runId, projectRoot = process.cwd()) {
  if (!safeRunId(runId)) return null
  return readJson(
    path.join(projectRoot, '.specify', 'workflows', 'runs', runId, 'state.json'),
    null,
  )
}

export function productionRun(projectRoot = process.cwd()) {
  const runId = process.env.SPECKIT_WORKFLOW_RUN_ID || ''
  if (!runId) {
    return { ok: false, reason: 'SPECKIT_WORKFLOW_RUN_ID is not set (not inside a workflow shell step)' }
  }
  const state = readRunState(runId, projectRoot)
  if (!state) {
    return { ok: false, reason: `run state not found for ${runId}` }
  }
  if (state.workflow_id !== PRODUCTION_WORKFLOW) {
    return {
      ok: false,
      reason: `run ${runId} is ${state.workflow_id || 'unknown'}, not ${PRODUCTION_WORKFLOW}`,
    }
  }
  if (state.status !== 'running' && state.status !== 'paused') {
    return { ok: false, reason: `run ${runId} is ${state.status || 'unknown'}` }
  }
  return { ok: true, runId, state }
}

function fail(tool, reason) {
  console.error(`FAIL ${tool} — ${reason}`)
  console.error(
    `  Page-level tools only run inside the ${PRODUCTION_WORKFLOW} workflow.`,
  )
  console.error(
    '  Start it with: node workflow/tools/run-workflow.mjs courseware-production ...',
  )
  console.error('  For tests/debug only, pass --manual.')
  process.exit(1)
}

export function requireProductionRun({
  tool,
  manual = false,
  projectRoot = process.cwd(),
}) {
  if (manual) return { mode: 'manual' }
  const run = productionRun(projectRoot)
  if (!run.ok) fail(tool, run.reason)
  return { mode: 'workflow', runId: run.runId, state: run.state }
}

export function pageGateApproval({ sectionId, projectRoot = process.cwd() }) {
  const run = productionRun(projectRoot)
  if (!run.ok) return { ok: false, reason: run.reason }
  const results =
    run.state.step_results && typeof run.state.step_results === 'object'
      ? run.state.step_results
      : {}
  const entries = Object.entries(results).filter(
    ([key]) => key === 'review-page' || key.endsWith(':review-page'),
  )
  if (!entries.length) {
    return { ok: false, reason: `run ${run.runId} has no review-page gate result` }
  }
  const messageOf = (result) => {
    const output = result && result.output && typeof result.output === 'object'
      ? result.output
      : {}
    return String(output.message || (output.guiGate && output.guiGate.message) || '')
  }
  // Match by the section id in the gate message. This is robust when a nested
  // loop reuses one step key across pages: an older page's gate cannot approve
  // a different page's freeze.
  const named = entries.filter(([, result]) => {
    if (!sectionId) return true
    return messageOf(result).includes(sectionId)
  })
  if (!named.length) {
    return {
      ok: false,
      reason: `run ${run.runId} has no review-page gate naming section ${sectionId}`,
    }
  }
  // Step results preserve execution order; the last matching gate is the page
  // that was just approved and is about to be frozen.
  const [key, result] = named[named.length - 1]
  if (!result || result.status !== 'completed') {
    return {
      ok: false,
      reason: `review-page gate ${key} is ${result ? result.status : 'missing'}`,
    }
  }
  const output = result.output && typeof result.output === 'object' ? result.output : {}
  const choice = String(output.choice || '').toLowerCase()
  if (choice !== 'approve') {
    return {
      ok: false,
      reason: `review-page gate ${key} choice is ${choice || 'missing'}`,
    }
  }
  const message = messageOf(result)
  return {
    ok: true,
    runId: run.runId,
    gate: key,
    choice: output.choice,
    message,
  }
}

export function requirePageGateApproval({
  tool,
  sectionId,
  manual = false,
  projectRoot = process.cwd(),
}) {
  if (manual) return { mode: 'manual' }
  const approval = pageGateApproval({ sectionId, projectRoot })
  if (!approval.ok) fail(tool, approval.reason)
  return { mode: 'workflow', ...approval }
}
