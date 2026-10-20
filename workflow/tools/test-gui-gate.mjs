#!/usr/bin/env node
// End-to-end test for the gui-gate step and the MCP approval server.
//
// It starts a toy gui-gate workflow, verifies the wrapper's GUI pause output,
// reads the panel resource through the MCP server, records a verdict with the
// panel token, and waits for the server's automatic resume to complete the run.
// Everything runs against a temp state directory; the review fixtures and the
// toy run are removed afterwards.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const toolsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(toolsDir, '..', '..')
const wrapper = path.join(projectRoot, 'workflow/tools/run-workflow.mjs')
const serverScript = path.join(projectRoot, 'workflow/mcp/approval-server.mjs')
const panelFile = path.join(projectRoot, 'workflow/mcp/panel.html')
const stepDir = path.join(projectRoot, '.specify/workflows/steps/gui-gate')

let server = null
let tmpRoot = null
let fixtureMd = null
let fixtureJson = null
let runId = null

function cleanup() {
  if (server) {
    try {
      server.stdin.end()
    } catch {
      // already closed
    }
    try {
      server.kill()
    } catch {
      // already exited
    }
    server = null
  }
  for (const file of [fixtureMd, fixtureJson]) {
    if (file) fs.rmSync(file, { force: true })
  }
  if (runId && /^[A-Za-z0-9._-]+$/.test(runId) && !runId.includes('..')) {
    fs.rmSync(path.join(projectRoot, '.specify/workflows/runs', runId), {
      recursive: true,
      force: true,
    })
  }
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true })
  tmpRoot = null
}

function fail(message) {
  console.error(`FAIL gui-gate: ${message}`)
  cleanup()
  process.exit(1)
}

function pass(message) {
  console.log(`PASS gui-gate: ${message}`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const specifyBin = process.env.SPECIFY_BIN || 'specify'
const specify = spawnSync(specifyBin, ['--version'], { encoding: 'utf8' })
if (specify.status !== 0) {
  console.log('SKIP gui-gate end-to-end (specify CLI not on PATH)')
  process.exit(0)
}
if (!fs.existsSync(path.join(stepDir, 'step.yml')) || !fs.existsSync(path.join(stepDir, '__init__.py'))) {
  console.log('SKIP gui-gate end-to-end (run workflow/install.mjs to install the step type)')
  process.exit(0)
}
if (!fs.existsSync(panelFile)) {
  fail('workflow/mcp/panel.html is missing; run node workflow/mcp/build-panel.mjs')
}

tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-gui-gate-'))
const stateDir = path.join(tmpRoot, 'state')
const tag = `${process.pid}-${Date.now()}`
const reviewRel = `review/gui-gate-smoke-${tag}.md`
fixtureMd = path.join(projectRoot, reviewRel)
fixtureJson = fixtureMd.replace(/\.md$/, '.json')
fs.mkdirSync(path.dirname(fixtureMd), { recursive: true })
fs.writeFileSync(fixtureMd, '# GUI gate smoke review\n\nReview http://127.0.0.1:9/review\n')
const fixtureHash = crypto.createHash('sha256').update(fs.readFileSync(fixtureMd)).digest('hex')
fs.writeFileSync(
  fixtureJson,
  `${JSON.stringify(
    {
      stage: 'smoke',
      artifactPaths: [reviewRel],
      reviewedArtifacts: [{ path: reviewRel, sha256: fixtureHash }],
      verdict: 'pass',
    },
    null,
    2,
  )}\n`,
)

const toy = path.join(tmpRoot, 'toy-gui-gate.yml')
fs.writeFileSync(
  toy,
  [
    'schema_version: "1.0"',
    'workflow:',
    '  id: smoke-gui-gate',
    '  name: Smoke GUI Gate',
    '  version: "0.0.1"',
    '  author: smoke',
    '  description: smoke gui gate outcome',
    'inputs: {}',
    'steps:',
    '  - id: g',
    '    type: gui-gate',
    '    message: "smoke GUI gate review: http://127.0.0.1:9/review"',
    `    show_file: "${reviewRel}"`,
    '    options: [approve, reject]',
    '    on_reject: abort',
    '',
  ].join('\n'),
)

const env = { ...process.env, COURSEWARE_GATE_STATE_DIR: stateDir }
const paused = spawnSync(process.execPath, [wrapper, toy], {
  cwd: projectRoot,
  encoding: 'utf8',
  env,
})
const pauseOut = `${paused.stdout || ''}\n${paused.stderr || ''}`
if (paused.status !== 3) fail(`expected exit 3 from the wrapper, got ${paused.status}\n${pauseOut}`)
if (!pauseOut.includes('courseware_gate_open')) fail('wrapper did not name courseware_gate_open')
if (!pauseOut.includes('Do not run `specify workflow resume`')) fail('wrapper did not forbid resume')
if (!pauseOut.includes(`Review file: ${reviewRel}`)) fail('wrapper did not print the review file')
let outcome
try {
  outcome = JSON.parse(paused.stdout)
} catch {
  fail(`wrapper stdout is not JSON: ${paused.stdout}`)
}
runId = outcome.run_id
if (!runId) fail('wrapper outcome has no run_id')
pass('wrapper pauses a gui-gate with GUI instructions')

const pendingDir = path.join(stateDir, 'pending')
const pendingFiles = fs
  .readdirSync(pendingDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => path.join(pendingDir, name))
const pendingFile = pendingFiles.find((file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).runId === runId
  } catch {
    return false
  }
})
if (!pendingFile) fail('no pending request for the toy run')
const request = JSON.parse(fs.readFileSync(pendingFile, 'utf8'))
if (request.status !== 'pending') fail(`pending status is ${request.status}`)
if (!/^[0-9a-f]{24}$/.test(request.gateKey)) fail(`bad gateKey ${request.gateKey}`)
if (!/^[0-9a-f]{32}$/.test(request.nonce)) fail(`bad nonce ${request.nonce}`)
if (!/^[0-9a-f]{64}$/.test(request.digest)) fail(`bad digest ${request.digest}`)
if (!(request.files || []).some((file) => file.role === 'show' && file.path === reviewRel)) {
  fail('pending request does not bind the shown review file')
}
if (!(request.files || []).some((file) => file.role === 'review' && file.path.endsWith('.json'))) {
  fail('pending request does not bind the sibling self-review record')
}
const shown = (request.files || []).find((file) => file.role === 'show' && file.path === reviewRel)
if (!shown || shown.sha256 !== fixtureHash) fail('shown review file is not hashed')
pass('pending request binds the review file and its self-review hash')

server = spawn(process.execPath, [serverScript], {
  cwd: projectRoot,
  env: { ...process.env, COURSEWARE_PROJECT_ROOT: projectRoot, COURSEWARE_GATE_STATE_DIR: stateDir },
  stdio: ['pipe', 'pipe', 'pipe'],
})
let buffer = ''
let nextId = 1
const waiting = new Map()
let serverErr = ''
server.stderr.on('data', (chunk) => {
  serverErr += chunk.toString()
})
server.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    if (message.id !== undefined && waiting.has(message.id)) {
      waiting.get(message.id)(message)
      waiting.delete(message.id)
    }
  }
})
function rpc(method, params) {
  const id = nextId
  nextId += 1
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 15000)
    waiting.set(id, (message) => {
      clearTimeout(timer)
      resolve(message)
    })
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
}
function notify(method, params) {
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
}
function callTool(name, args) {
  return rpc('tools/call', { name, arguments: args })
}

try {
  const init = await rpc('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'gui-gate-smoke', version: '1' },
  })
  if (!init.result || !init.result.protocolVersion) fail(`initialize failed: ${JSON.stringify(init)}`)
  notify('notifications/initialized', {})
  pass('MCP server initializes')

  const resource = await rpc('resources/read', { uri: 'ui://courseware-approval/gate.html' })
  const html = (resource.result && resource.result.contents && resource.result.contents[0] &&
    resource.result.contents[0].text) || ''
  const token = (html.match(/name="courseware-gate-token" content="([0-9a-f]{32})"/) || [])[1]
  if (!token) fail('panel resource has no token')
  if (!html.includes('courseware_gate_verdict') || !html.includes('课件人工审核')) {
    fail('panel resource is not the approval panel')
  }

  const opened = await callTool('courseware_gate_open', { runId })
  const openedBody = opened.result && opened.result.structuredContent
  if (!openedBody || openedBody.status !== 'pending') {
    fail(`courseware_gate_open did not return the pending gate: ${JSON.stringify(opened)}`)
  }
  if (JSON.stringify(opened).includes(token)) fail('panel token leaked into a tool result')
  if (openedBody.gate.nonce !== request.nonce) fail('open returned a different nonce')
  pass('panel resource exposes the gate without leaking its token')

  const verdict = await callTool('courseware_gate_verdict', {
    choice: 'approve',
    nonce: request.nonce,
    gateKey: request.gateKey,
    panelToken: token,
    runId,
  })
  const verdictBody = verdict.result && verdict.result.structuredContent
  if (!verdictBody || verdictBody.accepted !== true) {
    fail(`verdict was not accepted: ${JSON.stringify(verdict)}`)
  }
  pass('server accepts a token-bound, nonce-bound verdict')

  let last = null
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    const next = await callTool('courseware_gate_next', { runId })
    last = next.result && next.result.structuredContent
    if (last && ['completed', 'failed', 'aborted'].includes(last.status)) break
    await sleep(500)
  }
  if (!last || last.status !== 'completed') {
    fail(`auto-resume did not complete the run: ${JSON.stringify(last)}\n${serverErr}`)
  }

  const state = JSON.parse(
    fs.readFileSync(path.join(projectRoot, '.specify/workflows/runs', runId, 'state.json'), 'utf8'),
  )
  if (state.status !== 'completed') fail(`run state is ${state.status}`)
  const stepResult = state.step_results.g
  if (!stepResult || stepResult.output.choice !== 'approve') fail('gate choice was not approve')
  const verdictFile = JSON.parse(fs.readFileSync(path.join(stateDir, 'verdicts', `${request.gateKey}.json`), 'utf8'))
  if (!verdictFile.consumedAt) fail('verdict was not consumed')
  const consumedPending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'))
  if (consumedPending.status !== 'consumed') fail('pending request was not consumed')
  const resumeLog = fs.readFileSync(path.join(stateDir, 'resume', `${runId}.log`), 'utf8')
  if (!resumeLog.includes('OK workflow smoke-gui-gate completed')) {
    fail('resume log does not show a completed run')
  }
  pass('server auto-resumes the workflow and consumes the verdict')
  if (serverErr.includes(token)) fail('panel token leaked into server logs')
} catch (error) {
  fail(error && error.message ? error.message : String(error))
}

cleanup()
console.log('OK gui-gate end-to-end')
