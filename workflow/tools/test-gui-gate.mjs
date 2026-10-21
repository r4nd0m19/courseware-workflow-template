#!/usr/bin/env node
// End-to-end test for the hash-bound review gate and the chat review helper.
//
// It starts a toy gui-gate workflow, verifies the wrapper's pause output,
// inspects the pending request, records a teacher verdict with
// `gate-review.mjs decide`, resumes through the wrapper, and checks that the
// verdict was consumed exactly once. Everything runs against a temp state
// directory; the review fixtures and the toy run are removed afterwards.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const toolsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(toolsDir, '..', '..')
const wrapper = path.join(projectRoot, 'workflow/tools/run-workflow.mjs')
const reviewTool = path.join(projectRoot, 'workflow/tools/gate-review.mjs')
const stepDir = path.join(projectRoot, '.specify/workflows/steps/gui-gate')

let tmpRoot = null
let fixtureMd = null
let fixtureJson = null
let runId = null

function cleanup() {
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
  console.error(`FAIL review gate: ${message}`)
  cleanup()
  process.exit(1)
}

function pass(message) {
  console.log(`PASS review gate: ${message}`)
}

const specifyBin = process.env.SPECIFY_BIN || 'specify'
const specify = spawnSync(specifyBin, ['--version'], { encoding: 'utf8' })
if (specify.status !== 0) {
  console.log('SKIP review gate end-to-end (specify CLI not on PATH)')
  process.exit(0)
}
if (
  !fs.existsSync(path.join(stepDir, 'step.yml')) ||
  !fs.existsSync(path.join(stepDir, '__init__.py'))
) {
  console.log('SKIP review gate end-to-end (run workflow/install.mjs to install the step type)')
  process.exit(0)
}
if (!fs.existsSync(reviewTool)) {
  fail('workflow/tools/gate-review.mjs is missing')
}

tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-review-gate-'))
const stateDir = path.join(tmpRoot, 'state')
const tag = `${process.pid}-${Date.now()}`
const reviewRel = `review/gui-gate-smoke-${tag}.md`
fixtureMd = path.join(projectRoot, reviewRel)
fixtureJson = fixtureMd.replace(/\.md$/, '.json')
fs.mkdirSync(path.dirname(fixtureMd), { recursive: true })
fs.writeFileSync(fixtureMd, '# Review gate smoke review\n\nReview http://127.0.0.1:9/review\n')
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
    '  name: Smoke Review Gate',
    '  version: "0.0.1"',
    '  author: smoke',
    '  description: smoke review gate outcome',
    'inputs: {}',
    'steps:',
    '  - id: g',
    '    type: gui-gate',
    '    message: "smoke review gate: http://127.0.0.1:9/review"',
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
if (!pauseOut.includes('REVIEW REQUIRED')) fail('wrapper did not mark the review')
if (!pauseOut.includes('AskUserQuestion')) fail('wrapper did not require the native question UI')
if (!pauseOut.includes('Do not ask the teacher to type a choice')) {
  fail('wrapper did not forbid prose-only questions')
}
if (!pauseOut.includes(`gate-review.mjs show`)) fail('wrapper did not name gate-review.mjs show')
if (!pauseOut.includes(`gate-review.mjs decide`)) fail('wrapper did not name gate-review.mjs decide')
if (!pauseOut.includes(`run-workflow.mjs resume`)) fail('wrapper did not name the resume command')
if (!pauseOut.includes(`Review file: ${fixtureMd}`)) {
  fail(`wrapper did not print the absolute review file\n${pauseOut}`)
}
let outcome
try {
  outcome = JSON.parse(paused.stdout)
} catch {
  fail(`wrapper stdout is not JSON: ${paused.stdout}`)
}
runId = outcome.run_id
if (!runId) fail('wrapper outcome has no run_id')
pass('wrapper pauses with file-link and decide/resume instructions')

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

const show = spawnSync(
  process.execPath,
  [reviewTool, 'show', runId, '--project', projectRoot, '--state-dir', stateDir],
  { cwd: projectRoot, encoding: 'utf8' },
)
if (show.status !== 0) fail(`gate-review show failed: ${show.stderr || show.stdout}`)
if (!show.stdout.includes(`Review file: ${fixtureMd}`)) {
  fail(`gate-review show did not print the absolute review file: ${show.stdout}`)
}
if (!show.stdout.includes('Options: approve / reject')) {
  fail(`gate-review show did not print the options: ${show.stdout}`)
}
pass('gate-review show prints the review file and options')

const decided = spawnSync(
  process.execPath,
  [
    reviewTool,
    'decide',
    runId,
    '--step',
    'g',
    '--choice',
    'approve',
    '--by',
    'teacher',
    '--project',
    projectRoot,
    '--state-dir',
    stateDir,
  ],
  { cwd: projectRoot, encoding: 'utf8' },
)
if (decided.status !== 0) fail(`gate-review decide failed: ${decided.stderr || decided.stdout}`)
if (!decided.stdout.includes('OK gate verdict recorded: approve')) {
  fail(`gate-review decide did not record approve: ${decided.stdout}`)
}
const verdictFile = JSON.parse(
  fs.readFileSync(path.join(stateDir, 'verdicts', `${request.gateKey}.json`), 'utf8'),
)
if (verdictFile.accepted !== true || verdictFile.choice !== 'approve') {
  fail(`unexpected verdict: ${JSON.stringify(verdictFile)}`)
}
if (verdictFile.source !== 'chat' || verdictFile.decidedBy !== 'teacher') {
  fail(`verdict source is not the teacher chat answer: ${JSON.stringify(verdictFile)}`)
}
if (verdictFile.consumedAt) fail('verdict was consumed before resume')
pass('gate-review decide records the teacher answer without resuming')

const resumed = spawnSync(process.execPath, [wrapper, 'resume', runId], {
  cwd: projectRoot,
  encoding: 'utf8',
  env,
})
const resumeOut = `${resumed.stdout || ''}\n${resumed.stderr || ''}`
if (resumed.status !== 0) fail(`resume failed (${resumed.status})\n${resumeOut}`)
if (!resumeOut.includes('OK workflow smoke-gui-gate completed')) {
  fail(`resume did not complete the run\n${resumeOut}`)
}

const state = JSON.parse(
  fs.readFileSync(path.join(projectRoot, '.specify/workflows/runs', runId, 'state.json'), 'utf8'),
)
if (state.status !== 'completed') fail(`run state is ${state.status}`)
const stepResult = state.step_results.g
if (!stepResult || stepResult.output.choice !== 'approve') fail('gate choice was not approve')
const consumedVerdict = JSON.parse(
  fs.readFileSync(path.join(stateDir, 'verdicts', `${request.gateKey}.json`), 'utf8'),
)
if (!consumedVerdict.consumedAt) fail('verdict was not consumed by the gate')
const consumedPending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'))
if (consumedPending.status !== 'consumed') fail('pending request was not consumed')
pass('resume consumes the verdict exactly once and completes the run')

cleanup()
console.log('OK review gate end-to-end')
