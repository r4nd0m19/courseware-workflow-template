#!/usr/bin/env node
// Regression test for nested-gate resume in the per-page review loop.
//
// Spec Kit re-runs a nested step's parent body on resume. In the real page
// loop the body regenerates the AI self-review (reviewedAt changes), so a gate
// that re-entered without a guard would compute a new digest and discard the
// teacher's verdict. The workflow's page-review-resume-guard skips the
// build/self-review block when this run already has a pending/decided gate.
//
// This toy reproduces the hazard: a step before the gate rewrites the evidence
// on every execution. The guard must make it run exactly once, and the
// verdict must be consumed and the run completed.
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
const guardScript = path.join(projectRoot, 'workflow/tools/check-pending-gui-gate.mjs')
const panelFile = path.join(projectRoot, 'workflow/mcp/panel.html')
const stepDir = path.join(projectRoot, '.specify/workflows/steps/gui-gate')

let server = null
let tmpRoot = null
let runId = null
const fixtureFiles = []

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
  for (const file of fixtureFiles) fs.rmSync(file, { force: true })
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
  console.error(`FAIL gui-gate resume: ${message}`)
  cleanup()
  process.exit(1)
}

function pass(message) {
  console.log(`PASS gui-gate resume: ${message}`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const specifyBin = process.env.SPECIFY_BIN || 'specify'
const specify = spawnSync(specifyBin, ['--version'], { encoding: 'utf8' })
if (specify.status !== 0) {
  console.log('SKIP gui-gate resume (specify CLI not on PATH)')
  process.exit(0)
}
if (!fs.existsSync(path.join(stepDir, 'step.yml')) || !fs.existsSync(path.join(stepDir, '__init__.py'))) {
  console.log('SKIP gui-gate resume (run workflow/install.mjs to install the step type)')
  process.exit(0)
}
if (!fs.existsSync(panelFile)) {
  fail('workflow/mcp/panel.html is missing; run node workflow/mcp/build-panel.mjs')
}
if (!fs.existsSync(guardScript)) fail('check-pending-gui-gate.mjs is missing')

tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-gui-gate-resume-'))
const stateDir = path.join(tmpRoot, 'state')
const tag = `${process.pid}-${Date.now()}`
const reviewRel = `review/gui-gate-resume-${tag}.md`
const reviewMd = path.join(projectRoot, reviewRel)
const reviewJson = reviewMd.replace(/\.md$/, '.json')
fixtureFiles.push(reviewMd, reviewJson)
fs.mkdirSync(path.dirname(reviewMd), { recursive: true })
function writeEvidence(stamp) {
  fs.writeFileSync(reviewMd, `# GUI gate resume review\n\nstamp: ${stamp}\nhttp://127.0.0.1:9/review\n`)
  const hash = crypto.createHash('sha256').update(fs.readFileSync(reviewMd)).digest('hex')
  fs.writeFileSync(
    reviewJson,
    `${JSON.stringify(
      {
        stage: 'smoke',
        artifactPaths: [reviewRel],
        reviewedArtifacts: [{ path: reviewRel, sha256: hash }],
        verdict: 'pass',
        reviewedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
}
writeEvidence('initial')

const tickFile = path.join(tmpRoot, 'ticks.json')
const mutate = path.join(tmpRoot, 'mutate.mjs')
fs.writeFileSync(
  mutate,
  `import fs from 'node:fs'
import crypto from 'node:crypto'
const [md, json, rel, ticks] = process.argv.slice(2)
let data = {}
try { data = JSON.parse(fs.readFileSync(ticks, 'utf8')) } catch {}
data.before = (data.before || 0) + 1
fs.writeFileSync(ticks, JSON.stringify(data))
// Stands in for the AI page self-review: every execution rewrites the
// evidence and its reviewedAt, which would change the gate digest.
fs.writeFileSync(md, '# GUI gate resume review\\n\\nstamp: ' + data.before + '-' + Date.now() + '\\nhttp://127.0.0.1:9/review\\n')
const hash = crypto.createHash('sha256').update(fs.readFileSync(md)).digest('hex')
fs.writeFileSync(json, JSON.stringify({ stage: 'smoke', artifactPaths: [rel], reviewedArtifacts: [{ path: rel, sha256: hash }], verdict: 'pass', reviewedAt: new Date().toISOString() }, null, 2))
console.log(JSON.stringify({ before: data.before }))
`,
)
const after = path.join(tmpRoot, 'after.mjs')
fs.writeFileSync(
  after,
  `import fs from 'node:fs'
const [ticks] = process.argv.slice(2)
let data = {}
try { data = JSON.parse(fs.readFileSync(ticks, 'utf8')) } catch {}
data.after = (data.after || 0) + 1
fs.writeFileSync(ticks, JSON.stringify(data))
console.log(JSON.stringify({ done: data.after >= 1 }))
`,
)

const toy = path.join(tmpRoot, 'toy-gui-gate-resume.yml')
fs.writeFileSync(
  toy,
  [
    'schema_version: "1.0"',
    'workflow:',
    '  id: smoke-gui-gate-resume',
    '  name: Smoke GUI Gate Resume',
    '  version: "0.0.1"',
    '  author: smoke',
    '  description: nested gui-gate resume guard',
    'inputs: {}',
    'steps:',
    '  - id: loop',
    '    type: do-while',
    '    condition: "{{ not steps.after.output.data.done }}"',
    '    max_iterations: 2',
    '    steps:',
    '      - id: body',
    '        type: if',
    '        condition: "true"',
    '        then:',
    '          - id: guard',
    '            type: shell',
    `            run: ${JSON.stringify(`${process.execPath} ${guardScript} --step-id inner`)}`,
    '            output_format: json',
    '          - id: pre',
    '            type: if',
    '            condition: "{{ not steps.guard.output.data.resume }}"',
    '            then:',
    '              - id: before',
    '                type: shell',
    `                run: ${JSON.stringify(`${process.execPath} ${mutate} ${reviewMd} ${reviewJson} ${reviewRel} ${tickFile}`)}`,
    '                output_format: json',
    '          - id: inner',
    '            type: gui-gate',
    '            message: "resume guard review http://127.0.0.1:9/review"',
    `            show_file: ${JSON.stringify(reviewRel)}`,
    '            options: [approve, reject]',
    '            on_reject: abort',
    '      - id: after',
    '        type: shell',
    `        run: ${JSON.stringify(`${process.execPath} ${after} ${tickFile}`)}`,
    '        output_format: json',
    '',
  ].join('\n'),
)

const env = { ...process.env, COURSEWARE_GATE_STATE_DIR: stateDir }
// The wrapper must mint the run id itself; a value inherited from the parent
// would make this test share another run's guard state.
delete env.SPECKIT_WORKFLOW_RUN_ID
const paused = spawnSync(process.execPath, [wrapper, toy], {
  cwd: projectRoot,
  encoding: 'utf8',
  env,
})
const pauseOut = `${paused.stdout || ''}\n${paused.stderr || ''}`
if (paused.status !== 3) fail(`expected exit 3 from the wrapper, got ${paused.status}\n${pauseOut}`)
let outcome
try {
  outcome = JSON.parse(paused.stdout)
} catch {
  fail(`wrapper stdout is not JSON: ${paused.stdout}`)
}
runId = outcome.run_id
if (!runId) fail('wrapper outcome has no run_id')

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
if (request.stepId !== 'inner') fail(`pending step is ${request.stepId}`)
const ticksAfterPause = JSON.parse(fs.readFileSync(tickFile, 'utf8'))
if (ticksAfterPause.before !== 1) fail(`pre-gate step ran ${ticksAfterPause.before} times before the pause`)
pass('first entry runs the pre-gate step once and pauses')

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
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 20000)
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
    clientInfo: { name: 'gui-gate-resume-smoke', version: '1' },
  })
  if (!init.result || !init.result.protocolVersion) fail(`initialize failed: ${JSON.stringify(init)}`)
  notify('notifications/initialized', {})

  const resource = await rpc('resources/read', { uri: 'ui://courseware-approval/gate.html' })
  const html =
    (resource.result && resource.result.contents && resource.result.contents[0] &&
      resource.result.contents[0].text) || ''
  const token = (html.match(/name="courseware-gate-token" content="([0-9a-f]{32})"/) || [])[1]
  if (!token) fail('panel resource has no token')

  const opened = await callTool('courseware_gate_open', { runId })
  const openedBody = opened.result && opened.result.structuredContent
  if (!openedBody || openedBody.status !== 'pending') {
    fail(`courseware_gate_open did not return the pending gate: ${JSON.stringify(opened)}`)
  }
  if (openedBody.gate.nonce !== request.nonce) fail('open returned a different nonce')

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

  const ticks = JSON.parse(fs.readFileSync(tickFile, 'utf8'))
  if (ticks.before !== 1) {
    fail(`pre-gate step ran ${ticks.before} times; resume must not regenerate the evidence`)
  }
  if (ticks.after !== 1) fail(`post-gate step ran ${ticks.after} times, expected 1`)
  const state = JSON.parse(
    fs.readFileSync(path.join(projectRoot, '.specify/workflows/runs', runId, 'state.json'), 'utf8'),
  )
  if (state.status !== 'completed') fail(`run state is ${state.status}`)
  const gateResult = state.step_results.inner
  if (!gateResult || gateResult.output.choice !== 'approve') fail('gate choice was not approve')
  const consumedPending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'))
  if (consumedPending.status !== 'consumed') {
    fail(`pending request is ${consumedPending.status}, expected consumed`)
  }
  const requestCount = fs
    .readdirSync(pendingDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(pendingDir, name), 'utf8')))
    .filter((record) => record.runId === runId).length
  if (requestCount !== 1) fail(`run has ${requestCount} pending requests, expected 1`)
  pass('resume skips the pre-gate rebuild and consumes the original verdict')
  if (serverErr.includes(token)) fail('panel token leaked into server logs')
} catch (error) {
  fail(error && error.message ? error.message : String(error))
}

cleanup()
console.log('OK gui-gate resume guard')
