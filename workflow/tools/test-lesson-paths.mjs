#!/usr/bin/env node
// Regression test for per-lesson runtime paths. The wrapper must export
// COURSEWARE_REVIEW_DIR / COURSEWARE_SCREENSHOTS_DIR / COURSEWARE_SCRIPT_APPROVAL
// / COURSEWARE_PAGE_APPROVALS / COURSEWARE_GATE_STATE_DIR from -i lesson_slug=...
// so two lessons in one project cannot overwrite each other's ledgers.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const toolsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(toolsDir, '..', '..')
const wrapper = path.join(projectRoot, 'workflow/tools/run-workflow.mjs')
const specifyBin = process.env.SPECIFY_BIN || 'specify'
const probe = spawnSync(specifyBin, ['--version'], { encoding: 'utf8' })
if (probe.status !== 0) {
  console.log('SKIP lesson paths (specify CLI not on PATH)')
  process.exit(0)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-lesson-paths-'))
const toy = path.join(tmp, 'lesson-paths.yml')
const outFor = (slug) => path.join(tmp, `out-${slug}.json`)
const runIds = []

function cleanup() {
  for (const runId of runIds) {
    if (/^[A-Za-z0-9._-]+$/.test(runId) && !runId.includes('..')) {
      fs.rmSync(path.join(projectRoot, '.specify/workflows/runs', runId), {
        recursive: true,
        force: true,
      })
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true })
}

const command = [
  JSON.stringify(process.execPath),
  '-e',
  JSON.stringify(
    "require('fs').writeFileSync(process.argv[1], JSON.stringify({review:process.env.COURSEWARE_REVIEW_DIR,shots:process.env.COURSEWARE_SCREENSHOTS_DIR,script:process.env.COURSEWARE_SCRIPT_APPROVAL,pages:process.env.COURSEWARE_PAGE_APPROVALS,gate:process.env.COURSEWARE_GATE_STATE_DIR}))",
  ),
  `${tmp}/out-{{ inputs.lesson_slug }}.json`,
].join(' ')

fs.writeFileSync(
  toy,
  [
    'schema_version: "1.0"',
    'workflow:',
    '  id: smoke-lesson-paths',
    '  name: Smoke Lesson Paths',
    '  version: "0.0.1"',
    '  author: smoke',
    '  description: per-lesson runtime paths',
    'inputs:',
    '  lesson_slug:',
    '    type: string',
    '    required: true',
    'steps:',
    '  - id: env',
    '    type: shell',
    `    run: ${JSON.stringify(command)}`,
    '',
  ].join('\n'),
)

function runLesson(slug, extraEnv = {}) {
  const result = spawnSync(
    process.execPath,
    [wrapper, toy, '-i', `lesson_slug=${slug}`],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv },
    },
  )
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  if (result.status !== 0) {
    console.error(`FAIL lesson paths (${slug}) — wrapper exited ${result.status}\n${output}`)
    cleanup()
    process.exit(1)
  }
  try {
    const outcome = JSON.parse(result.stdout)
    if (!outcome.run_id) {
      console.error(`FAIL lesson paths (${slug}) — wrapper output has no run_id`)
      cleanup()
      process.exit(1)
    }
    if (
      extraEnv.SPECKIT_WORKFLOW_RUN_ID &&
      outcome.run_id === extraEnv.SPECKIT_WORKFLOW_RUN_ID
    ) {
      console.error(
        `FAIL lesson paths (${slug}) — new run reused inherited SPECKIT_WORKFLOW_RUN_ID ` +
          `(${outcome.run_id}); a nested smoke test must never overwrite a live run`,
      )
      cleanup()
      process.exit(1)
    }
    runIds.push(outcome.run_id)
  } catch (error) {
    console.error(`FAIL lesson paths (${slug}) — cannot parse wrapper output: ${error.message}`)
    cleanup()
    process.exit(1)
  }
  let env
  try {
    env = JSON.parse(fs.readFileSync(outFor(slug), 'utf8'))
  } catch (error) {
    console.error(`FAIL lesson paths (${slug}) — missing env snapshot: ${error.message}`)
    cleanup()
    process.exit(1)
  }
  const expected = {
    review: `review/${slug}`,
    shots: `screenshots/${slug}`,
    script: `review/${slug}/script-approval.json`,
    pages: `review/${slug}/page-approvals.json`,
    gate: `review/${slug}/gui-gates`,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (env[key] !== value) {
      console.error(`FAIL lesson paths (${slug}) — ${key} is ${JSON.stringify(env[key])}, expected ${JSON.stringify(value)}`)
      cleanup()
      process.exit(1)
    }
  }
}

const inheritedRunId = `smoke-inherited-${process.pid}`
runLesson('alpha', { SPECKIT_WORKFLOW_RUN_ID: inheritedRunId })
runLesson('beta')
if (fs.existsSync(path.join(projectRoot, '.specify/workflows/runs', inheritedRunId))) {
  console.error(
    `FAIL lesson paths — inherited run id ${inheritedRunId} was created; ` +
      'run-workflow.mjs must generate a fresh id for a new run',
  )
  cleanup()
  process.exit(1)
}

const checker = path.join(toolsDir, 'check-lesson-paths.mjs')
const checkerEnv = {
  ...process.env,
  COURSEWARE_REVIEW_DIR: 'review/alpha',
  COURSEWARE_SCREENSHOTS_DIR: 'screenshots/alpha',
  COURSEWARE_SCRIPT_APPROVAL: 'review/alpha/script-approval.json',
  COURSEWARE_PAGE_APPROVALS: 'review/alpha/page-approvals.json',
  COURSEWARE_GATE_STATE_DIR: 'review/alpha/gui-gates',
}
const checkerArgs = [
  '--lesson-slug',
  'alpha',
  '--site-dir',
  'site/alpha',
  '--narration',
  'site/alpha/narration.json',
  '--audio-dir',
  'site/alpha/audio',
  '--audio-url-prefix',
  '/audio',
  '--art-dir',
  'generated/alpha',
  '--baseline-dir',
  'baselines/alpha',
]
const good = spawnSync(process.execPath, [checker, ...checkerArgs], {
  cwd: projectRoot,
  encoding: 'utf8',
  env: checkerEnv,
})
if (good.status !== 0) {
  console.error(`FAIL lesson paths — checker rejected valid paths:\n${good.stdout}${good.stderr}`)
  cleanup()
  process.exit(1)
}
const badArgs = checkerArgs.map((value, index) =>
  index === 3 ? 'site/shared' : value,
)
const bad = spawnSync(process.execPath, [checker, ...badArgs], {
  cwd: projectRoot,
  encoding: 'utf8',
  env: checkerEnv,
})
if (bad.status !== 1 || !`${bad.stdout}${bad.stderr}`.includes('must contain')) {
  console.error('FAIL lesson paths — checker accepted a shared site path')
  cleanup()
  process.exit(1)
}
const badAudioArgs = checkerArgs.map((value, index) =>
  value === '/audio' ? 'C:/Program Files/Git/audio' : value,
)
const badAudio = spawnSync(process.execPath, [checker, ...badAudioArgs], {
  cwd: projectRoot,
  encoding: 'utf8',
  env: checkerEnv,
})
if (badAudio.status !== 1 || !`${badAudio.stdout}${badAudio.stderr}`.includes('audio_url_prefix')) {
  console.error('FAIL lesson paths — checker accepted a rewritten audio URL prefix')
  cleanup()
  process.exit(1)
}

cleanup()
console.log('OK lesson paths')
