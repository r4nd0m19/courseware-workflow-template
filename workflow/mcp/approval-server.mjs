#!/usr/bin/env node
// MCP stdio server for courseware approval gates.
//
// The workflow's gui-gate step writes a hash-bound pending request under
// review/gui-gates/ and pauses. This server renders that request as an MCP App
// panel inside ZCode. The human clicks Approve/Reject; the panel calls
// courseware_gate_verdict with the per-request nonce and the panel token that
// only the rendered panel receives. The server writes the verdict and resumes
// the workflow with `workflow/tools/run-workflow.mjs resume <runId>`.
//
// Protocol: newline-delimited JSON-RPC 2.0 over stdio, no Content-Length
// framing. The server is deliberately dependency-free so it runs with the
// stock Node ZCode already uses.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_VERSION = '1.0'
const PANEL_URI = 'ui://courseware-approval/gate.html'
const PANEL_MIME = 'text/html;profile=mcp-app'
const PANEL_TOKEN_PLACEHOLDER = '__PANEL_TOKEN__'
const PANEL_PATH = path.join(here, 'panel.html')
const WRAPPER_PATH = path.join(here, '..', 'tools', 'run-workflow.mjs')

function findProjectRoot() {
  const configured = process.env.COURSEWARE_PROJECT_ROOT
  if (configured) return path.resolve(process.env.COURSEWARE_PROJECT_ROOT)
  let dir = here
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

const projectRoot = findProjectRoot()
const stateDir = process.env.COURSEWARE_GATE_STATE_DIR
  ? path.resolve(projectRoot, process.env.COURSEWARE_GATE_STATE_DIR)
  : path.join(projectRoot, 'review', 'gui-gates')
const pendingDir = path.join(stateDir, 'pending')
const verdictDir = path.join(stateDir, 'verdicts')
const resumeDir = path.join(stateDir, 'resume')
const logPath = path.join(stateDir, 'server.log')
const tokenPath = path.join(stateDir, 'panel-token.txt')

// ---------------------------------------------------------------- utilities
function now() {
  return new Date().toISOString()
}

function safeRunId(runId) {
  return typeof runId === 'string' &&
    /^[A-Za-z0-9._-]+$/.test(runId) &&
    runId !== '.' &&
    runId !== '..' &&
    !runId.includes('..')
    ? runId
    : null
}

function log(level, message, extra) {
  const record = { at: now(), level, message, ...(extra || {}) }
  try {
    fs.mkdirSync(stateDir, { recursive: true })
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n')
  } catch {
    // Logging must never break the protocol loop.
  }
  process.stderr.write(`[courseware-gate] ${level}: ${message}\n`)
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
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

function sleepSync(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    // The token handshake is one-time; a short synchronous wait is simpler and
    // safer than racing two server processes for the file.
  }
}

function loadPanelToken() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const token = fs.readFileSync(tokenPath, 'utf8').trim()
      if (/^[0-9a-f]{32}$/.test(token)) return token
    } catch {
      // Not created yet.
    }
    const token = crypto.randomBytes(16).toString('hex')
    try {
      fs.mkdirSync(stateDir, { recursive: true })
      fs.writeFileSync(tokenPath, token + '\n', { flag: 'wx', mode: 0o600 })
      return token
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      sleepSync(25)
    }
  }
  throw new Error(`cannot establish panel token at ${tokenPath}`)
}
const PANEL_TOKEN = loadPanelToken()

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function replyError(id, code, message, data) {
  send({
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  })
}

function toolError(error, extra) {
  return {
    isError: true,
    content: [{ type: 'text', text: `Approval not recorded: ${error}` }],
    structuredContent: { accepted: false, error, ...(extra || {}) },
  }
}

// ------------------------------------------------------------------- state
function readRequest(gateKey) {
  if (typeof gateKey !== 'string' || !/^[0-9a-f]{24}$/.test(gateKey)) return null
  return readJson(path.join(pendingDir, `${gateKey}.json`), null)
}

function listRequests() {
  let names = []
  try {
    names = fs.readdirSync(pendingDir)
  } catch {
    return []
  }
  const records = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const record = readJson(path.join(pendingDir, name), null)
    if (record && typeof record === 'object' && record.gateKey) records.push(record)
  }
  records.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  return records
}

function pickPending({ runId, gateKey }) {
  const records = listRequests().filter((record) => record.status === 'pending')
  if (gateKey) return records.find((record) => record.gateKey === gateKey) || null
  if (runId) return records.find((record) => record.runId === runId) || null
  return records[0] || null
}

function readRun(runId) {
  const safe = safeRunId(runId)
  if (!safe) return null
  const statePath = path.join(
    projectRoot,
    '.specify',
    'workflows',
    'runs',
    safe,
    'state.json',
  )
  const state = readJson(statePath, null)
  if (!state || typeof state !== 'object') return null
  const currentStepId = state.current_step_id || null
  const stepResults = state.step_results && typeof state.step_results === 'object'
    ? state.step_results
    : {}
  const current = currentStepId ? stepResults[currentStepId] || null : null
  let status = state.status || 'unknown'
  if (status === 'running' && current && current.status === 'paused') status = 'paused'
  return {
    runId: safe,
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

function publicGate(request) {
  return {
    schemaVersion: request.schemaVersion,
    gateKey: request.gateKey,
    nonce: request.nonce,
    digest: request.digest,
    runId: request.runId,
    stepId: request.stepId,
    message: request.message,
    options: request.options,
    onReject: request.onReject,
    showFile: request.showFile,
    reviewFile: request.reviewFile,
    reviewExcerpt: request.reviewExcerpt,
    links: request.links,
    files: request.files,
    status: request.status,
    choice: request.choice || null,
    createdAt: request.createdAt,
    decidedAt: request.decidedAt || null,
    consumedAt: request.consumedAt || null,
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

// ------------------------------------------------------------------- tools
const TOOLS = [
  {
    name: 'courseware_gate_open',
    title: 'Open courseware approval panel',
    description:
      'Render the pending human-approval gate for a courseware workflow in ZCode chat. ' +
      'The human clicks Approve or Reject in the panel; the agent must not answer the gate, ' +
      'must not call courseware_gate_verdict, and must not continue downstream steps by hand.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: {
          type: 'string',
          description: 'Workflow run id printed by run-workflow.mjs (for example fee8a4c5).',
        },
        gateKey: {
          type: 'string',
          description: 'Optional gate key from the pause output; normally omitted.',
        },
      },
      additionalProperties: false,
    },
    _meta: {
      'ui/resourceUri': PANEL_URI,
      ui: {
        resourceUri: PANEL_URI,
        showInline: true,
        visibility: ['model', 'app'],
      },
    },
  },
  {
    name: 'courseware_gate_next',
    title: 'Poll courseware approval state',
    description:
      'Poll the pending gate and workflow status. Called by the approval panel. App-only.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        gateKey: { type: 'string' },
      },
      additionalProperties: false,
    },
    _meta: {
      'ui/resourceUri': PANEL_URI,
      ui: { resourceUri: PANEL_URI, visibility: ['app'] },
    },
  },
  {
    name: 'courseware_gate_verdict',
    title: 'Record courseware approval verdict',
    description:
      'Record the human verdict from the rendered approval panel. Requires the per-request ' +
      'nonce and the panel token. App-only; an agent must never call this tool.',
    inputSchema: {
      type: 'object',
      properties: {
        choice: { type: 'string', minLength: 1 },
        nonce: { type: 'string', minLength: 1 },
        gateKey: { type: 'string', minLength: 1 },
        panelToken: { type: 'string', minLength: 1 },
        runId: { type: 'string' },
      },
      required: ['choice', 'nonce', 'gateKey', 'panelToken'],
      additionalProperties: false,
    },
    _meta: {
      'ui/resourceUri': PANEL_URI,
      ui: { resourceUri: PANEL_URI, visibility: ['app'] },
    },
  },
]

function openGate(args) {
  if (!fs.existsSync(PANEL_PATH)) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text:
            'Approval panel unavailable: workflow/mcp/panel.html is missing. ' +
            'Run `node workflow/mcp/build-panel.mjs` (or re-run the workflow installer) ' +
            'to build it, then reload the MCP server.',
        },
      ],
      structuredContent: {
        accepted: false,
        error: 'panel-missing',
        panelPath: PANEL_PATH,
      },
    }
  }
  const runId = safeRunId(args?.runId)
  const gateKey = typeof args?.gateKey === 'string' ? args.gateKey : undefined
  const gate = pickPending({ runId, gateKey })
  const run = readRun(gate ? gate.runId : runId)
  if (!gate) {
    return {
      content: [
        {
          type: 'text',
          text:
            'Approval panel opened, but there is no pending gate yet. The panel will poll ' +
            'and show the gate when the workflow reaches it.',
        },
      ],
      structuredContent: {
        schemaVersion: SCHEMA_VERSION,
        status: 'no-pending',
        runId: runId || (run ? run.runId : null),
        gate: null,
        run: runView(run),
      },
    }
  }
  log('info', 'gate opened', { runId: gate.runId, stepId: gate.stepId, gateKey: gate.gateKey })
  return {
    content: [
      {
        type: 'text',
        text:
          `Approval panel opened for step ${gate.stepId} (run ${gate.runId}). ` +
          'The human must click Approve or Reject in the panel. The agent must not answer ' +
          'the gate and must not run downstream workflow steps by hand.',
      },
    ],
    structuredContent: {
      schemaVersion: SCHEMA_VERSION,
      status: 'pending',
      runId: gate.runId,
      gate: publicGate(gate),
      run: runView(run),
    },
  }
}

function nextGate(args) {
  const runId = safeRunId(args?.runId)
  const gateKey = typeof args?.gateKey === 'string' ? args.gateKey : undefined
  const records = listRequests()

  let gate = null
  if (gateKey) {
    gate = records.find((record) => record.gateKey === gateKey) || null
  } else {
    const pending = records.find(
      (record) =>
        record.status === 'pending' && (!runId || record.runId === runId),
    )
    const decided = records.find(
      (record) =>
        record.status === 'decided' && (!runId || record.runId === runId),
    )
    gate = pending || decided || null
  }

  const effectiveRunId = runId || (gate ? gate.runId : null)
  const run = readRun(effectiveRunId)

  if (gate && gate.status === 'pending') {
    return {
      content: [{ type: 'text', text: `Pending gate: ${gate.stepId} (run ${gate.runId}).` }],
      structuredContent: {
        schemaVersion: SCHEMA_VERSION,
        status: 'pending',
        runId: gate.runId,
        gate: publicGate(gate),
        run: runView(run),
      },
    }
  }
  if (gate && gate.status === 'decided') {
    maybeResume(gate.runId, 'poll')
    return {
      content: [{ type: 'text', text: 'Verdict recorded; the workflow is resuming.' }],
      structuredContent: {
        schemaVersion: SCHEMA_VERSION,
        status: 'deciding',
        runId: gate.runId,
        gate: publicGate(gate),
        run: runView(run),
      },
    }
  }

  if (run) {
    const status = run.status === 'running' ? 'running' : run.status
    return {
      content: [
        {
          type: 'text',
          text:
            status === 'running'
              ? 'The workflow is running; waiting for the next gate.'
              : `Workflow status: ${status}${run.error ? ` (${run.error})` : ''}.`,
        },
      ],
      structuredContent: {
        schemaVersion: SCHEMA_VERSION,
        status,
        runId: run.runId,
        gate: null,
        run: runView(run),
      },
    }
  }

  return {
    content: [{ type: 'text', text: 'No pending gate and no readable run state.' }],
    structuredContent: {
      schemaVersion: SCHEMA_VERSION,
      status: 'idle',
      runId: effectiveRunId,
      gate: null,
      run: null,
    },
  }
}

function runAtGate(run, request) {
  if (!run) return 'run-state-missing'
  if (run.rawStatus !== 'running' && run.rawStatus !== 'paused') {
    return `run-${run.rawStatus}`
  }
  if (!run.currentStepId) return 'run-no-current-step'
  const current = run.currentStepId
  const matches =
    current === request.stepId ||
    current.endsWith(`:${request.stepId}`) ||
    request.stepId.endsWith(`:${current}`)
  if (!matches) return 'run-not-at-gate'
  const safe = safeRunId(request.runId)
  if (!safe) return 'invalid-run-id'
  const state = readJson(
    path.join(projectRoot, '.specify', 'workflows', 'runs', safe, 'state.json'),
    null,
  )
  const result = state && state.step_results
    ? state.step_results[current] || state.step_results[request.stepId]
    : null
  if (!result || result.status !== 'paused') return 'gate-not-paused'
  return null
}

function recordVerdict(args) {
  const panelToken = typeof args?.panelToken === 'string' ? args.panelToken : ''
  const given = Buffer.from(panelToken, 'utf8')
  const expectedToken = Buffer.from(PANEL_TOKEN, 'utf8')
  if (given.length !== expectedToken.length || !crypto.timingSafeEqual(given, expectedToken)) {
    log('warn', 'verdict rejected: panel token mismatch')
    return toolError('panel-token-mismatch')
  }

  const gateKey = typeof args?.gateKey === 'string' ? args.gateKey : ''
  const request = readRequest(gateKey)
  if (!request) return toolError('unknown-gate', { gateKey })

  const existing = readJson(path.join(verdictDir, `${gateKey}.json`), null)
  if (request.status === 'decided') {
    if (
      existing &&
      existing.nonce === args?.nonce &&
      String(existing.choice).toLowerCase() === String(args?.choice).toLowerCase()
    ) {
      return {
        content: [{ type: 'text', text: 'Verdict already recorded for this gate.' }],
        structuredContent: {
          accepted: true,
          duplicate: true,
          gateKey,
          choice: existing.choice,
          recordedAt: existing.recordedAt,
        },
      }
    }
    return toolError('already-decided', { gateKey })
  }
  if (request.status !== 'pending') {
    return toolError(`gate-${request.status || 'unknown'}`, { gateKey })
  }
  if (args?.nonce !== request.nonce) {
    return toolError('stale-nonce', { gateKey })
  }
  if (args?.runId && args.runId !== request.runId) {
    return toolError('run-mismatch', { gateKey, runId: request.runId })
  }
  const rawChoice = typeof args?.choice === 'string' ? args.choice : ''
  const choice = (request.options || []).find(
    (option) => String(option).toLowerCase() === rawChoice.toLowerCase(),
  )
  if (!choice) {
    return toolError('invalid-choice', { gateKey, options: request.options })
  }
  const gateProblem = runAtGate(readRun(request.runId), request)
  if (gateProblem) {
    log('warn', 'verdict rejected: run is not at this gate', {
      runId: request.runId,
      stepId: request.stepId,
      gateProblem,
    })
    return toolError(gateProblem, { gateKey, runId: request.runId })
  }

  const lockPath = path.join(verdictDir, `${gateKey}.lock`)
  let lockFd
  try {
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
        if (retryError.code === 'EEXIST') return toolError('verdict-busy', { gateKey })
        throw retryError
      }
    } else if (error.code === 'EEXIST') {
      return toolError('verdict-busy', { gateKey })
    } else {
      throw error
    }
  }

  if (lockFd !== undefined) {
    try {
      fs.writeSync(lockFd, JSON.stringify({ pid: process.pid, at: now() }))
    } catch {
      // The lock is only for serialization; content is diagnostic.
    }
  }

  try {
    const lockedRequest = readRequest(gateKey)
    if (!lockedRequest || lockedRequest.status !== 'pending') {
      return toolError(
        lockedRequest ? `gate-${lockedRequest.status}` : 'unknown-gate',
        { gateKey },
      )
    }
    if (lockedRequest.nonce !== args?.nonce) return toolError('stale-nonce', { gateKey })
    const verdict = {
      schemaVersion: SCHEMA_VERSION,
      accepted: true,
      gateKey,
      digest: lockedRequest.digest,
      runId: lockedRequest.runId,
      stepId: lockedRequest.stepId,
      nonce: lockedRequest.nonce,
      choice,
      recordedAt: now(),
      source: 'zcode-mcp-app',
    }
    writeJson(path.join(verdictDir, `${gateKey}.json`), verdict)

    const decidedRequest = {
      ...lockedRequest,
      status: 'decided',
      choice,
      decidedAt: verdict.recordedAt,
      decidedBy: 'panel',
    }
    writeJson(path.join(pendingDir, `${gateKey}.json`), decidedRequest)
    log('info', 'verdict recorded', {
      runId: lockedRequest.runId,
      stepId: lockedRequest.stepId,
      gateKey,
      choice,
    })
    setImmediate(() => maybeResume(lockedRequest.runId, 'verdict'))
    return {
      content: [{ type: 'text', text: `Verdict recorded: ${choice}.` }],
      structuredContent: {
        accepted: true,
        gateKey,
        runId: lockedRequest.runId,
        stepId: lockedRequest.stepId,
        choice,
        recordedAt: verdict.recordedAt,
      },
    }
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

// ------------------------------------------------------------------ resume
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
      // EPERM means the process exists but belongs to someone else.
    }
  }
  return Date.now() - stat.mtimeMs > maxAgeMs
}

function resolveSpecifyBin() {
  if (process.env.SPECIFY_BIN) return process.env.SPECIFY_BIN
  const candidates = []
  if (process.platform === 'win32') {
    const home = process.env.USERPROFILE || ''
    const appData = process.env.APPDATA || ''
    const localAppData = process.env.LOCALAPPDATA || ''
    const where = spawnSync('where.exe', ['specify'], { encoding: 'utf8' })
    if (where.status === 0) {
      const first = where.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
      if (first) candidates.push(first)
    }
    if (home) {
      candidates.push(path.join(home, '.local', 'bin', 'specify.exe'))
      candidates.push(path.join(home, 'AppData', 'Roaming', 'Python', 'Scripts', 'specify.exe'))
    }
    if (appData) candidates.push(path.join(appData, 'Python', 'Scripts', 'specify.exe'))
    if (localAppData) {
      candidates.push(path.join(localAppData, 'Programs', 'Python', 'Python312', 'Scripts', 'specify.exe'))
      candidates.push(path.join(localAppData, 'Programs', 'Python', 'Python311', 'Scripts', 'specify.exe'))
    }
  } else {
    const which = spawnSync('which', ['specify'], { encoding: 'utf8' })
    if (which.status === 0) {
      const first = which.stdout.trim().split(/\r?\n/)[0]
      if (first) candidates.push(first)
    }
    if (process.env.HOME) {
      candidates.push(path.join(process.env.HOME, '.local', 'bin', 'specify'))
    }
  }
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate
    } catch {
      // Ignore malformed candidate.
    }
  }
  return 'specify'
}

const lastResumeAttempt = new Map()

function maybeResume(runId, reason) {
  if (process.env.COURSEWARE_GATE_NO_RESUME === '1') return
  const safe = safeRunId(runId)
  if (!safe) {
    log('warn', 'resume skipped: invalid run id', { runId })
    return
  }
  // Poll-driven recovery is throttled: a resume that fails immediately must
  // not spawn a fresh process on every panel poll.
  if (reason === 'poll') {
    const last = lastResumeAttempt.get(safe) || 0
    if (Date.now() - last < 60_000) return
  }
  lastResumeAttempt.set(safe, Date.now())

  fs.mkdirSync(resumeDir, { recursive: true })
  const lockPath = path.join(resumeDir, `${safe}.lock`)
  if (fs.existsSync(lockPath)) {
    if (!lockIsStale(lockPath, 30 * 60_000)) {
      log('info', 'resume skipped: already running', { runId: safe, reason })
      return
    }
    try {
      fs.unlinkSync(lockPath)
    } catch {
      // Another process cleaned it.
    }
  }
  const resumeId = crypto.randomBytes(8).toString('hex')
  let lockFd
  try {
    lockFd = fs.openSync(lockPath, 'wx')
    fs.writeSync(
      lockFd,
      JSON.stringify({ pid: process.pid, resumeId, at: now(), runId: safe }),
    )
    fs.closeSync(lockFd)
    lockFd = null
  } catch (error) {
    log('info', 'resume skipped: lock race', { runId: safe, error: error.code })
    return
  }

  const specifyBin = resolveSpecifyBin()
  const logFile = path.join(resumeDir, `${safe}.log`)
  let out = 'ignore'
  try {
    out = fs.openSync(logFile, 'a')
    fs.writeSync(out, `\n=== resume ${now()} (${reason}) ===\n`)
  } catch {
    out = 'ignore'
  }
  let child
  try {
    child = spawn(process.execPath, [WRAPPER_PATH, 'resume', safe], {
      cwd: projectRoot,
      env: { ...process.env, SPECIFY_BIN: specifyBin },
      stdio: ['ignore', out, out],
      detached: true,
      windowsHide: true,
    })
  } catch (error) {
    log('error', 'resume spawn failed', { runId: safe, error: String(error) })
    try {
      fs.unlinkSync(lockPath)
    } catch {
      // Ignore.
    }
    if (typeof out === 'number') {
      try {
        fs.closeSync(out)
      } catch {
        // Ignore.
      }
    }
    return
  }
  try {
    writeJson(lockPath, {
      pid: child.pid,
      serverPid: process.pid,
      resumeId,
      at: now(),
      runId: safe,
    })
  } catch {
    // The lock still carries resumeId, so the exit handler can release it.
  }
  if (typeof out === 'number') {
    try {
      fs.closeSync(out)
    } catch {
      // Ignore.
    }
  }
  log('info', 'resume spawned', {
    runId: safe,
    pid: child.pid,
    reason,
    specifyBin,
  })
  child.on('error', (error) => {
    log('error', 'resume child error', { runId: safe, error: String(error) })
  })
  child.on('exit', (code, signal) => {
    log('info', 'resume exited', { runId: safe, code, signal })
    try {
      const record = readJson(lockPath, null)
      if (record && record.resumeId === resumeId) fs.unlinkSync(lockPath)
    } catch {
      // Ignore.
    }
  })
  child.unref()
}

// ------------------------------------------------------------------- panel
function readPanel() {
  const html = fs.readFileSync(PANEL_PATH, 'utf8')
  if (!html.includes(PANEL_TOKEN_PLACEHOLDER)) {
    throw new Error('panel.html is missing the token placeholder; rebuild the panel')
  }
  const injected = html.replaceAll(PANEL_TOKEN_PLACEHOLDER, PANEL_TOKEN)
  if (injected.includes(PANEL_TOKEN_PLACEHOLDER)) {
    throw new Error('panel token placeholder remained after injection')
  }
  return injected
}

// ------------------------------------------------------------------ protocol
function handleRequest(method, params, id) {
  switch (method) {
    case 'initialize': {
      const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : ''
      const protocolVersion = requested || '2025-06-18'
      log('info', 'initialize', {
        requested,
        negotiated: protocolVersion,
        projectRoot,
        stateDir,
      })
      reply(id, {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: { name: 'courseware-approval', version: '1.0.0' },
      })
      return
    }
    case 'ping':
      reply(id, {})
      return
    case 'tools/list':
      reply(id, { tools: TOOLS })
      return
    case 'tools/call': {
      const name = params?.name
      const args = params?.arguments || {}
      try {
        if (name === 'courseware_gate_open') {
          reply(id, openGate(args))
          return
        }
        if (name === 'courseware_gate_next') {
          reply(id, nextGate(args))
          return
        }
        if (name === 'courseware_gate_verdict') {
          reply(id, recordVerdict(args))
          return
        }
        replyError(id, -32602, `Unknown tool: ${String(name)}`)
      } catch (error) {
        log('error', 'tool crashed', { name, error: String(error?.stack || error) })
        reply(id, toolError('internal-error', { detail: String(error?.message || error) }))
      }
      return
    }
    case 'resources/list':
      reply(id, {
        resources: [
          {
            uri: PANEL_URI,
            name: 'courseware-approval-panel',
            title: 'Courseware approval panel',
            mimeType: PANEL_MIME,
          },
        ],
      })
      return
    case 'resources/read': {
      if (params?.uri !== PANEL_URI) {
        replyError(id, -32602, `Unknown resource: ${String(params?.uri)}`)
        return
      }
      try {
        reply(id, {
          contents: [{ uri: PANEL_URI, mimeType: PANEL_MIME, text: readPanel() }],
        })
      } catch (error) {
        log('error', 'panel read failed', { error: String(error) })
        replyError(id, -32603, `Approval panel unavailable: ${String(error?.message || error)}`)
      }
      return
    }
    case 'resources/templates/list':
      reply(id, { resourceTemplates: [] })
      return
    case 'prompts/list':
      reply(id, { prompts: [] })
      return
    case 'logging/setLevel':
      reply(id, {})
      return
    case 'completion/complete':
      reply(id, { completion: { values: [], total: 0, hasMore: false } })
      return
    case 'roots/list':
      reply(id, { roots: [] })
      return
    default:
      replyError(id, -32601, `Method not found: ${String(method)}`)
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let message
    try {
      message = JSON.parse(line)
    } catch (error) {
      log('error', 'invalid JSON from host', { error: String(error) })
      continue
    }
    if (Array.isArray(message)) {
      log('warn', 'ignored JSON-RPC batch')
      continue
    }
    if (message?.jsonrpc !== '2.0' || typeof message?.method !== 'string') {
      log('debug', 'ignored non-request frame', { keys: Object.keys(message || {}) })
      continue
    }
    if (message.id === undefined || message.id === null) {
      log('debug', 'notification', { method: message.method })
      continue
    }
    try {
      handleRequest(message.method, message.params, message.id)
    } catch (error) {
      log('error', 'handler crashed', {
        method: message.method,
        error: String(error?.stack || error),
      })
      replyError(message.id, -32603, 'Internal error')
    }
  }
})
process.stdin.on('end', () => log('info', 'stdin closed'))

fs.mkdirSync(stateDir, { recursive: true })
fs.mkdirSync(pendingDir, { recursive: true })
fs.mkdirSync(verdictDir, { recursive: true })
fs.mkdirSync(resumeDir, { recursive: true })
log('info', 'server started', {
  pid: process.pid,
  node: process.version,
  projectRoot,
  stateDir,
  panel: PANEL_PATH,
})
