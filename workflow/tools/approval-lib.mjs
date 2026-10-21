// Hash-bound whole-script approval.
//
// The review-script gate is only a human decision; it is not proof that the
// text the reviewer saw is the text a later step is about to use. Every
// downstream step therefore re-hashes the current courseware.md and compares
// it with the ledger written by approve-script.mjs. This follows the same
// pattern as protected CI environments and hash-bound agent approvals:
// approval is minted for one exact artifact, and any later edit voids it.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseScript } from './script-lib.mjs'
import { slideScriptHash } from './section-lib.mjs'

export const DEFAULT_REVIEW_DIR = process.env.COURSEWARE_REVIEW_DIR || 'review'
export const DEFAULT_SCRIPT_APPROVAL =
  process.env.COURSEWARE_SCRIPT_APPROVAL || 'review/script-approval.json'
export const DEFAULT_PAGE_APPROVALS =
  process.env.COURSEWARE_PAGE_APPROVALS || 'review/page-approvals.json'
export const DEFAULT_SCREENSHOTS_DIR =
  process.env.COURSEWARE_SCREENSHOTS_DIR || 'screenshots'
export const REVIEW_SCRIPT_STEP_ID = 'review-script'
export const WORKFLOW_RUNS_DIR = '.specify/workflows/runs'

export function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function realpathOrResolve(file) {
  const absolute = path.resolve(file)
  try {
    return fs.realpathSync(absolute)
  } catch {
    return absolute
  }
}

function sameFile(a, b) {
  return realpathOrResolve(a) === realpathOrResolve(b)
}

export function workflowRunsDir(options = {}) {
  const configured = options.runsDir || process.env.COURSEWARE_WORKFLOW_RUNS_DIR
  return configured ? path.resolve(configured) : path.resolve(WORKFLOW_RUNS_DIR)
}

export function reviewRunStatePath(runId, options = {}) {
  return options.runStatePath
    ? path.resolve(options.runStatePath)
    : path.join(workflowRunsDir(options), runId, 'state.json')
}

// Spec Kit records every step result in
// .specify/workflows/runs/<run-id>/state.json. An approval is only valid when
// the run really contains a completed review-script step that chose "approve";
// a paused gate (or a run that never reached the gate) cannot mint a ledger.
export function reviewRunProblems(runId, options = {}) {
  if (typeof runId !== 'string' || !runId.trim() || /[/\\\0]/.test(runId)) {
    return [`approval gate run id is ${JSON.stringify(runId)}, expected a single run directory name`]
  }
  const statePath = reviewRunStatePath(runId, options)
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
  const results = state.step_results || state.steps || {}
  const step = results[REVIEW_SCRIPT_STEP_ID]
  if (!step) {
    problems.push(`workflow run ${runId} has no ${REVIEW_SCRIPT_STEP_ID} step result`)
    return problems
  }
  if (step.status !== 'completed') {
    problems.push(
      `${REVIEW_SCRIPT_STEP_ID} in run ${runId} is ${JSON.stringify(step.status)}, expected "completed" (a paused gate is not an approval)`,
    )
  }
  const choice = step.output && step.output.choice
  if (String(choice || '').toLowerCase() !== 'approve') {
    problems.push(
      `${REVIEW_SCRIPT_STEP_ID} in run ${runId} chose ${JSON.stringify(choice)}, expected "approve"`,
    )
  }
  return problems
}

// A script approval minted by a minimal gate-only workflow is not enough: the
// production workflow runs self-review-script and check-self-review-script
// before review-script. Require those step results in the same run and a
// passing self-review bound to the exact pre-approval courseware.md text.
export const SELF_REVIEW_SCRIPT_PATH = path.join(
  DEFAULT_REVIEW_DIR,
  'self-review-script.json',
)

export function scriptSelfReviewProblems(options = {}) {
  const {
    runId,
    runStatePath,
    scriptPath,
    scriptText,
    selfReviewPath = SELF_REVIEW_SCRIPT_PATH,
    requireProductionWorkflow = true,
  } = options
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
  if (requireProductionWorkflow && state.workflow_id !== 'courseware-production') {
    problems.push(
      `workflow run ${runId} is ${JSON.stringify(state.workflow_id)}, expected "courseware-production"; a minimal gate-only workflow cannot approve a script`,
    )
  }
  const results = state.step_results || state.steps || {}
  for (const stepId of ['self-review-script', 'check-self-review-script']) {
    const step = results[stepId]
    if (!step) {
      problems.push(`workflow run ${runId} has no ${stepId} step result`)
    } else if (step.status !== 'completed') {
      problems.push(
        `${stepId} in run ${runId} is ${JSON.stringify(step.status)}, expected "completed"`,
      )
    }
  }

  const reviewFile = path.resolve(selfReviewPath)
  let review
  try {
    review = JSON.parse(fs.readFileSync(reviewFile, 'utf8'))
  } catch (error) {
    problems.push(`cannot read ${selfReviewPath}: ${error.code || error.message}`)
    return problems
  }
  if (review.stage !== 'script') {
    problems.push(`${selfReviewPath} stage is ${JSON.stringify(review.stage)}, expected "script"`)
  }
  if (String(review.verdict || '').toLowerCase() !== 'pass') {
    problems.push(
      `${selfReviewPath} verdict is ${JSON.stringify(review.verdict)}, expected "pass"`,
    )
  }

  const expected =
    scriptText !== undefined
      ? sha256Text(scriptText)
      : scriptPath
        ? sha256File(scriptPath)
        : null
  if (!expected) {
    problems.push('cannot verify the self-review without the script text or path')
    return problems
  }
  const normalize = (value) =>
    path.resolve(String(value).replace(/[\\/]+/g, path.sep))
  const scriptAbs = path.resolve(scriptPath)
  const reviewed = Array.isArray(review.reviewedArtifacts)
    ? review.reviewedArtifacts
    : []
  const match = reviewed.find(
    (item) =>
      item &&
      typeof item.path === 'string' &&
      normalize(item.path) === scriptAbs &&
      String(item.sha256 || '').toLowerCase() === expected.toLowerCase(),
  )
  if (!match) {
    problems.push(
      `${selfReviewPath} does not bind the current ${scriptPath} (sha256 ${expected})`,
    )
  }
  return problems
}

function resolveLedgerScript(ledger, approvalPath) {
  if (!ledger || typeof ledger.script !== 'string' || !ledger.script.trim()) return []
  const raw = ledger.script.trim()
  const candidates = [path.resolve(process.cwd(), raw)]
  // The default ledger lives in review/, and approve-script stores the path
  // relative to the project root. Also accept a ledger read from a different
  // cwd by resolving against the ledger's project-root-shaped parent.
  const ledgerDir = path.dirname(path.resolve(approvalPath))
  if (path.basename(ledgerDir) === 'review') {
    candidates.push(path.resolve(ledgerDir, '..', raw))
  }
  return [...new Set(candidates)]
}

export function readScriptApproval(approvalPath = DEFAULT_SCRIPT_APPROVAL) {
  const absolute = path.resolve(approvalPath)
  if (!fs.existsSync(absolute)) {
    throw new Error(`approval ledger not found: ${approvalPath}`)
  }
  let ledger
  try {
    ledger = JSON.parse(fs.readFileSync(absolute, 'utf8'))
  } catch (error) {
    throw new Error(`approval ledger is not valid JSON: ${approvalPath}: ${error.message}`)
  }
  return { ledger, path: absolute }
}

// Returns a list of human-readable problems. An empty list means the ledger
// matches the current script exactly and was produced by an approved gate.
export function scriptApprovalProblems(scriptPath, options = {}) {
  const approvalPath = options.approvalPath || DEFAULT_SCRIPT_APPROVAL
  const problems = []
  let parsed
  try {
    parsed = parseScript(scriptPath)
  } catch (error) {
    return [`cannot parse script ${scriptPath}: ${error.message}`]
  }

  let ledger
  try {
    ledger = readScriptApproval(approvalPath).ledger
  } catch (error) {
    return [error.message]
  }

  if (ledger.schemaVersion !== '1.2') {
    problems.push(
      `unsupported approval schemaVersion ${JSON.stringify(ledger.schemaVersion)}; expected "1.2" (re-run the review-script gate)`,
    )
  }
  if (typeof ledger.approvedBy !== 'string' || !ledger.approvedBy.trim()) {
    problems.push('approval ledger has no approvedBy')
  }
  if (typeof ledger.approvedAt !== 'string' || !Number.isFinite(Date.parse(ledger.approvedAt))) {
    problems.push('approval ledger has no valid approvedAt timestamp')
  }
  const gate = ledger.gate
  if (!gate || typeof gate !== 'object') {
    problems.push('approval ledger has no gate decision; only the review-script gate may approve a script')
  } else {
    if (gate.stepId !== 'review-script') {
      problems.push(`approval gate is ${JSON.stringify(gate.stepId)}, expected "review-script"`)
    }
    if (String(gate.choice || '').toLowerCase() !== 'approve') {
      problems.push(`approval gate choice is ${JSON.stringify(gate.choice)}, expected "approve"`)
    }
    if (typeof gate.runId !== 'string' || !gate.runId.trim()) {
      problems.push('approval ledger has no gate runId; only a real workflow run may approve a script')
    } else {
      if (options.expectRunId && gate.runId !== options.expectRunId) {
        problems.push(
          `approval ledger was minted in run ${JSON.stringify(gate.runId)}, expected the current run ${JSON.stringify(options.expectRunId)}`,
        )
      }
      problems.push(...reviewRunProblems(gate.runId, options))
    }
  }

  const candidates = resolveLedgerScript(ledger, approvalPath)
  if (!candidates.length) {
    problems.push('approval ledger has no script path')
  } else if (!candidates.some((candidate) => sameFile(candidate, parsed.path))) {
    problems.push(
      `approval ledger is for ${ledger.script}, not ${path.resolve(scriptPath)}`,
    )
  }

  const currentHash = sha256File(parsed.path)
  if (typeof ledger.scriptSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ledger.scriptSha256)) {
    problems.push('approval ledger has no whole-script sha256; re-run the review-script gate')
  } else if (ledger.scriptSha256 !== currentHash) {
    problems.push(
      `courseware.md changed after approval (approved ${ledger.scriptSha256.slice(0, 12)}…, now ${currentHash.slice(0, 12)}…); re-run review-script`,
    )
  }

  if (parsed.frontmatter.status !== 'APPROVED') {
    problems.push(
      `frontmatter status is ${parsed.frontmatter.status || 'missing'}, expected APPROVED`,
    )
  }

  const active = parsed.slides.filter((slide) => slide.machine && slide.machine.status !== 'SKIP')
  for (const slide of active) {
    if (slide.machine.status !== 'APPROVED') {
      problems.push(`${slide.id}: machine status is ${slide.machine.status || 'missing'}, expected APPROVED`)
    }
  }
  const currentIds = new Set(active.map((slide) => slide.id))
  const hashes = ledger.slideHashes && typeof ledger.slideHashes === 'object'
    ? ledger.slideHashes
    : null
  if (!hashes) {
    problems.push('approval ledger has no slideHashes')
  } else {
    if (ledger.slideCount !== active.length) {
      problems.push(`approval slideCount is ${ledger.slideCount}, current non-SKIP slide count is ${active.length}`)
    }
    for (const slide of active) {
      const recorded = hashes[slide.id]
      if (!recorded) {
        problems.push(`${slide.id}: approval ledger has no slide hash`)
        continue
      }
      const current = slideScriptHash(slide)
      if (recorded !== current) {
        problems.push(`${slide.id}: slide changed after approval (hash mismatch)`)
      }
    }
    for (const id of Object.keys(hashes)) {
      if (!currentIds.has(id)) problems.push(`${id}: approval ledger has a hash for a slide that is missing or SKIP`)
    }
  }

  return problems
}

export function describeScriptApproval(scriptPath, options = {}) {
  const { ledger, path: approvalPath } = readScriptApproval(
    options.approvalPath || DEFAULT_SCRIPT_APPROVAL,
  )
  return {
    script: path.resolve(scriptPath),
    approval: approvalPath,
    approvedBy: ledger.approvedBy,
    approvedAt: ledger.approvedAt,
    gate: ledger.gate,
    runId: ledger.gate && ledger.gate.runId,
    slideCount: ledger.slideCount,
  }
}

// Throwing variant for tools that must not produce downstream artifacts from
// an unapproved or stale script.
export function assertScriptApproved(scriptPath, options = {}) {
  const problems = scriptApprovalProblems(scriptPath, options)
  if (problems.length) {
    const error = new Error(
      `script is not approved for downstream work:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
        'Run the review-script gate and approve it before component-plan, narration, storyboard, components, deck or screenshots.',
    )
    error.problems = problems
    throw error
  }
  return describeScriptApproval(scriptPath, options)
}
