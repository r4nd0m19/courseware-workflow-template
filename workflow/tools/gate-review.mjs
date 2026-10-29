#!/usr/bin/env node
// Hash-bound human review gate helper.
//
// At a `gui-gate` pause the workflow writes
// `review/gui-gates/pending/<gateKey>.json` and returns exit code 3. The agent
// shows the review file/link to the teacher, asks for an explicit
// approve/reject, records that answer with `decide`, and then resumes with
// `node workflow/tools/run-workflow.mjs resume <runId>`.
//
// This tool deliberately has no UI and no MCP dependency. The human answer is
// captured by the harness (native question UI or chat), and the verdict stays
// bound to the pending run/step/digest/nonce and is consumed once by the
// gui-gate step. The agent must never call `decide` before the teacher's
// explicit answer.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_VERSION = '1.0'

function usage() {
  console.error(`Usage:
  node workflow/tools/gate-review.mjs show <runId> [--step <stepId>] [--json]
  node workflow/tools/gate-review.mjs decide <runId> --choice <approve|reject> [--step <stepId>] [--by teacher] [--json]
  node workflow/tools/gate-review.mjs status <runId> [--json]

Options:
  --project <path>     Project root (default: auto-detect from cwd)
  --state-dir <path>   Override review/gui-gates (tests / isolated runs)
  --gate <gateKey>     Select a gate explicitly instead of by run/step
  --json               Machine-readable output
`)
  process.exit(2)
}

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const body = arg.slice(2)
    const eq = body.indexOf('=')
    if (eq >= 0) {
      flags[body.slice(0, eq)] = body.slice(eq + 1)
      continue
    }
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[body] = next
      i += 1
    } else {
      flags[body] = true
    }
  }
  return { positional, flags }
}

function findProjectRoot(explicit) {
  if (explicit) return path.resolve(explicit)
  if (process.env.COURSEWARE_PROJECT_ROOT) {
    return path.resolve(process.env.COURSEWARE_PROJECT_ROOT)
  }
  let dir = process.cwd()
  while (true) {
    if (
      fs.existsSync(path.join(dir, '.specify')) &&
      fs.existsSync(path.join(dir, 'workflow', 'tools', 'run-workflow.mjs'))
    ) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

function stateDirFromRun(projectRoot, runId) {
  if (!runId) return ''
  const state = readJson(runPath(projectRoot, runId), null)
  if (!state) return ''
  for (const result of Object.values(state.step_results || {})) {
    const raw = result?.output?.guiGate?.stateDir
    if (typeof raw === 'string' && raw.trim()) {
      return resolveProjectPath(projectRoot, raw)
    }
  }
  return ''
}

function stateDirFor(projectRoot, flags, runId = '') {
  if (typeof flags['state-dir'] === 'string') {
    return path.resolve(projectRoot, flags['state-dir'])
  }
  if (process.env.COURSEWARE_GATE_STATE_DIR) {
    return path.resolve(projectRoot, process.env.COURSEWARE_GATE_STATE_DIR)
  }
  const fromRun = stateDirFromRun(projectRoot, runId)
  if (fromRun) return fromRun
  return path.join(projectRoot, 'review', 'gui-gates')
}

function now() {
  return new Date().toISOString()
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

function fail(message, code = 1) {
  console.error(`FAIL ${message}`)
  process.exit(code)
}

// Pending requests may carry Windows separators even when the tool runs under
// WSL (and vice versa). Normalize before resolving against the project root.
function normalizeRelative(raw) {
  return String(raw).replace(/[\\/]+/g, path.sep)
}

function resolveProjectPath(projectRoot, raw) {
  const text = String(raw)
  if (path.isAbsolute(text)) return path.normalize(text)
  return path.resolve(projectRoot, normalizeRelative(text))
}

function stepMatches(a, b) {
  if (!a || !b) return false
  return a === b || a.endsWith(`:${b}`) || b.endsWith(`:${a}`)
}

function listPending(stateDir) {
  let names = []
  try {
    names = fs.readdirSync(path.join(stateDir, 'pending'))
  } catch {
    return []
  }
  const records = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const record = readJson(path.join(stateDir, 'pending', name), null)
    if (record && typeof record === 'object' && record.gateKey) records.push(record)
  }
  records.sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
  )
  return records
}

function chooseRequest(records, { runId, stepId, gateKey }) {
  let candidates = records.filter((record) => record.status === 'pending')
  if (gateKey) candidates = candidates.filter((record) => record.gateKey === gateKey)
  if (runId) candidates = candidates.filter((record) => record.runId === runId)
  if (stepId) candidates = candidates.filter((record) => stepMatches(record.stepId, stepId))
  if (!candidates.length) return null
  if (candidates.length > 1) {
    fail(
      `multiple pending gates match; pass --step or --gate. ` +
        candidates
          .map((record) => `${record.gateKey} (${record.stepId})`)
          .join(', '),
    )
  }
  return candidates[0]
}

function runPath(projectRoot, runId) {
  return path.join(
    projectRoot,
    '.specify',
    'workflows',
    'runs',
    runId,
    'state.json',
  )
}

function readRun(projectRoot, runId) {
  if (
    typeof runId !== 'string' ||
    !/^[A-Za-z0-9._-]+$/.test(runId) ||
    runId === '.' ||
    runId === '..' ||
    runId.includes('..')
  ) {
    return null
  }
  const state = readJson(runPath(projectRoot, runId), null)
  if (!state || typeof state !== 'object') return null
  const stepResults =
    state.step_results && typeof state.step_results === 'object' ? state.step_results : {}
  const currentStepId = state.current_step_id || null
  const current = currentStepId ? stepResults[currentStepId] || null : null
  let status = state.status || 'unknown'
  if (status === 'running' && current && current.status === 'paused') status = 'paused'
  return {
    runId,
    workflowId: state.workflow_id || null,
    status,
    rawStatus: state.status || 'unknown',
    currentStepId,
    currentStepStatus: current ? current.status || null : null,
    currentStepType: current ? current.type || null : null,
    error: current ? current.error || null : null,
    updatedAt: state.updated_at || state.updatedAt || null,
  }
}

function runView(run) {
  if (!run) return null
  return {
    runId: run.runId,
    workflowId: run.workflowId,
    status: run.status,
    currentStepId: run.currentStepId,
    currentStepStatus: run.currentStepStatus,
    currentStepType: run.currentStepType,
    error: run.error,
    updatedAt: run.updatedAt,
  }
}

function gateProblem(projectRoot, request) {
  const run = readRun(projectRoot, request.runId)
  if (!run) return 'run-state-missing'
  if (run.rawStatus !== 'running' && run.rawStatus !== 'paused') {
    return `run-${run.rawStatus}`
  }
  if (!run.currentStepId) return 'run-no-current-step'
  if (!stepMatches(run.currentStepId, request.stepId)) return 'run-not-at-gate'
  const state = readJson(runPath(projectRoot, request.runId), null)
  const result =
    state && state.step_results
      ? state.step_results[run.currentStepId] || state.step_results[request.stepId]
      : null
  if (!result || result.status !== 'paused') return 'gate-not-paused'
  return null
}

function gateSummary(projectRoot, request) {
  const reviewRaw = request.reviewFile || request.showFile || ''
  const reviewFile = reviewRaw ? resolveProjectPath(projectRoot, reviewRaw) : null
  return {
    schemaVersion: SCHEMA_VERSION,
    status: request.status,
    gateKey: request.gateKey,
    runId: request.runId,
    stepId: request.stepId,
    message: request.message || '',
    reviewFile,
    reviewFileUrl: reviewFile ? pathToFileURL(reviewFile).href : null,
    showFile: request.showFile || null,
    links: Array.isArray(request.links) ? request.links : [],
    options: Array.isArray(request.options) ? request.options : [],
    onReject: request.onReject || null,
    files: Array.isArray(request.files) ? request.files : [],
    createdAt: request.createdAt || null,
  }
}

function printGate(summary) {
  console.log(`Gate: ${summary.stepId} (run ${summary.runId})`)
  if (summary.message) console.log(`Message: ${summary.message}`)
  if (summary.reviewFile) {
    console.log(`Review file: ${summary.reviewFile}`)
    console.log(`Review file URL: ${summary.reviewFileUrl}`)
  }
  if (summary.links.length) {
    console.log('Links:')
    for (const link of summary.links) {
      console.log(`  - ${link.label || 'link'}: ${link.url}`)
    }
  }
  console.log(`Options: ${summary.options.join(' / ') || 'approve / reject'}`)
  if (summary.files.length) {
    console.log('Evidence:')
    for (const file of summary.files) {
      const sha = typeof file.sha256 === 'string' ? ` sha256:${file.sha256.slice(0, 12)}…` : ''
      console.log(`  - ${file.role || 'file'}: ${file.path}${sha}`)
    }
  }
  console.log('')
  console.log('Show the review file/link to the teacher and wait for an explicit choice.')
  console.log('Then record it (never before the teacher answers):')
  console.log(
    `  node workflow/tools/gate-review.mjs decide ${summary.runId} ` +
      `--step ${summary.stepId} --choice <${summary.options.join('|') || 'approve|reject'}>`,
  )
  console.log(`  node workflow/tools/run-workflow.mjs resume ${summary.runId}`)
}

function lockIsStale(lockPath, maxAgeMs) {
  let stat
  try {
    stat = fs.statSync(lockPath)
  } catch {
    return true
  }
  const record = readJson(lockPath, null)
  if (record && Number.isInteger(record.pid) && record.pid > 0) {
    try {
      process.kill(record.pid, 0)
      return false
    } catch (error) {
      if (error.code === 'ESRCH') return true
    }
  }
  return Date.now() - stat.mtimeMs > maxAgeMs
}

function showCommand(projectRoot, stateDir, flags, positional) {
  const runId = positional[1] || flags.run || flags.runId || ''
  const stepId = flags.step || flags.stepId || ''
  const gateKey = flags.gate || flags.gateKey || ''
  const request = chooseRequest(listPending(stateDir), { runId, stepId, gateKey })
  if (!request) {
    fail(
      `no pending gate${runId ? ` for run ${runId}` : ''}` +
        `${stepId ? ` step ${stepId}` : ''}`,
    )
  }
  const summary = gateSummary(projectRoot, request)
  if (flags.json) {
    console.log(JSON.stringify({ ...summary, run: runView(readRun(projectRoot, request.runId)) }, null, 2))
    return
  }
  printGate(summary)
}

function decideCommand(projectRoot, stateDir, flags, positional) {
  const runId = positional[1] || flags.run || flags.runId || ''
  const stepId = flags.step || flags.stepId || ''
  const gateKey = flags.gate || flags.gateKey || ''
  const rawChoice = typeof flags.choice === 'string' ? flags.choice : ''
  const by = typeof flags.by === 'string' && flags.by ? flags.by : 'teacher'
  if (!runId && !gateKey) usage()
  if (!rawChoice) fail('missing --choice (approve or reject)')

  const request = chooseRequest(listPending(stateDir), { runId, stepId, gateKey })
  if (!request) {
    fail(
      `no pending gate${runId ? ` for run ${runId}` : ''}` +
        `${stepId ? ` step ${stepId}` : ''}`,
    )
  }
  const choice = (request.options || []).find(
    (option) => String(option).toLowerCase() === rawChoice.toLowerCase(),
  )
  if (!choice) {
    fail(`invalid choice ${rawChoice}; expected ${(request.options || []).join(' / ')}`)
  }
  const problem = gateProblem(projectRoot, request)
  if (problem) {
    fail(`${problem} (run ${request.runId}, step ${request.stepId})`)
  }

  const verdictPath = path.join(stateDir, 'verdicts', `${request.gateKey}.json`)
  const existing = readJson(verdictPath, null)
  if (existing) {
    if (existing.consumedAt) {
      fail(`gate verdict already consumed (${request.gateKey})`)
    }
    if (String(existing.choice).toLowerCase() === choice.toLowerCase()) {
      console.log(`OK gate verdict already recorded: ${existing.choice}`)
      console.log(`Next: node workflow/tools/run-workflow.mjs resume ${request.runId}`)
      return
    }
    fail(`a different verdict is already recorded: ${existing.choice}`)
  }

  const lockPath = path.join(stateDir, 'verdicts', `${request.gateKey}.lock`)
  let lockFd
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
    lockFd = fs.openSync(lockPath, 'wx')
  } catch (error) {
    if (error.code === 'EEXIST' && lockIsStale(lockPath, 120_000)) {
      try {
        fs.unlinkSync(lockPath)
      } catch {
        // Another process may have released it.
      }
      try {
        lockFd = fs.openSync(lockPath, 'wx')
      } catch (retryError) {
        if (retryError.code === 'EEXIST') fail(`verdict-busy (${request.gateKey})`)
        throw retryError
      }
    } else if (error.code === 'EEXIST') {
      fail(`verdict-busy (${request.gateKey})`)
    } else {
      throw error
    }
  }

  const releaseLock = () => {
    try {
      fs.closeSync(lockFd)
    } catch {
      // Already closed.
    }
    try {
      fs.unlinkSync(lockPath)
    } catch {
      // Another process may have cleaned it.
    }
  }

  try {
    fs.writeSync(lockFd, JSON.stringify({ pid: process.pid, at: now() }))
    const current = chooseRequest(listPending(stateDir), {
      runId: request.runId,
      stepId: request.stepId,
      gateKey: request.gateKey,
    })
    if (!current || current.status !== 'pending') {
      releaseLock()
      fail(`gate is no longer pending (${request.gateKey})`)
    }
    const verdict = {
      schemaVersion: SCHEMA_VERSION,
      accepted: true,
      gateKey: current.gateKey,
      digest: current.digest,
      runId: current.runId,
      stepId: current.stepId,
      nonce: current.nonce,
      choice,
      recordedAt: now(),
      source: 'chat',
      decidedBy: by,
    }
    writeJson(verdictPath, verdict)
    writeJson(path.join(stateDir, 'pending', `${current.gateKey}.json`), {
      ...current,
      status: 'decided',
      choice,
      decidedAt: verdict.recordedAt,
      decidedBy: by,
    })
    console.log(`OK gate verdict recorded: ${choice}`)
    console.log(`  run:  ${current.runId}`)
    console.log(`  step: ${current.stepId}`)
    console.log(`  gate: ${current.gateKey}`)
    if (current.reviewFile || current.showFile) {
      console.log(
        `  file: ${resolveProjectPath(projectRoot, current.reviewFile || current.showFile)}`,
      )
    }
    console.log(`Next: node workflow/tools/run-workflow.mjs resume ${current.runId}`)
  } finally {
    try {
      fs.closeSync(lockFd)
    } catch {
      // Already closed.
    }
    try {
      fs.unlinkSync(lockPath)
    } catch {
      // Another process may have cleaned it.
    }
  }
}

function statusCommand(projectRoot, stateDir, flags, positional) {
  const runId = positional[1] || flags.run || flags.runId || ''
  if (!runId) usage()
  const run = readRun(projectRoot, runId)
  const records = listPending(stateDir).filter((record) => record.runId === runId)
  const request = records.find((record) => record.status === 'pending') || null
  const last = records[0] || null
  const output = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    run: runView(run),
    gate: request ? gateSummary(projectRoot, request) : null,
    lastGate: last ? gateSummary(projectRoot, last) : null,
  }
  if (flags.json) {
    console.log(JSON.stringify(output, null, 2))
    return
  }
  if (!run) {
    console.log(`Run ${runId}: state not found`)
  } else {
    console.log(`Run ${runId} (${run.workflowId || 'workflow'})`)
    console.log(`Status: ${run.status}`)
    if (run.currentStepId) console.log(`Step: ${run.currentStepId}`)
    if (run.error) console.log(`Error: ${run.error}`)
  }
  if (request) {
    const summary = gateSummary(projectRoot, request)
    console.log(`Pending gate: ${summary.stepId} (${summary.gateKey})`)
    if (summary.reviewFile) console.log(`Review file: ${summary.reviewFile}`)
  } else {
    console.log('Pending gate: none')
    if (last) console.log(`Last gate: ${last.stepId} (${last.status})`)
  }
}

const { positional, flags } = parseArgs(process.argv.slice(2))
const command = positional[0]
if (!command) usage()
const projectRoot = findProjectRoot(typeof flags.project === 'string' ? flags.project : undefined)
const runIdHint = positional[1] || flags.run || flags.runId || ''
const stateDir = stateDirFor(projectRoot, flags, runIdHint)
switch (command) {
  case 'show':
    showCommand(projectRoot, stateDir, flags, positional)
    break
  case 'decide':
    decideCommand(projectRoot, stateDir, flags, positional)
    break
  case 'status':
    statusCommand(projectRoot, stateDir, flags, positional)
    break
  default:
    usage()
}
