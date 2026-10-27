#!/usr/bin/env node
// Tests for the single-shot text review tool. No network or real key is used.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const toolDir = path.dirname(fileURLToPath(import.meta.url))
const tool = path.join(toolDir, 'review-ai.mjs')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-review-ai-'))
let failed = 0
let total = 0
function test(name, fn) {
  total += 1
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error.stack || error.message)
  }
}
function write(name, value) {
  const file = path.join(tmp, name)
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
  return file
}
function run(args) {
  return spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' })
}

test('brief review merges checklist and writes markdown', () => {
  const evidence = write('brief-evidence.json', {
    mode: 'brief',
    spec: { text: 'spec' },
    concepts: { text: 'concepts' },
  })
  const skeleton = write('brief-skeleton.json', {
    stage: 'brief',
    artifactPaths: [evidence],
    reviewedArtifacts: [{ path: evidence, sha256: '0'.repeat(64) }],
    automatedChecks: [{ name: 'inputs', status: 'pass', notes: 'ok' }],
    checklist: [
      { item: 'objectives', status: 'n/a' },
      { item: 'coverage', status: 'n/a' },
    ],
    issues: [],
    verdict: 'fail',
    reviewedAt: '2026-10-27T00:00:00Z',
    reviewMeta: { mode: 'brief' },
  })
  const mock = write('brief-mock.json', {
    content: [{ type: 'text', text: JSON.stringify({
      checklist: [
        { index: 0, status: 'pass' },
        { index: 1, status: 'pass' },
      ],
      issues: [],
      verdict: 'pass',
    }) }],
  })
  const review = path.join(tmp, 'brief-review.json')
  fs.copyFileSync(skeleton, review)
  const result = run([
    '--mode', 'brief', '--evidence', evidence, '--review-json', review,
    '--api', 'anthropic-messages', '--model', 'mock', '--mock-response', mock,
  ])
  assert.equal(result.status, 0, result.stderr)
  const data = JSON.parse(fs.readFileSync(review, 'utf8'))
  assert.equal(data.verdict, 'pass')
  assert.equal(data.checklist[0].status, 'pass')
  assert.equal(data.reviewMeta.mode, 'single-shot')
  assert.ok(fs.existsSync(path.join(tmp, 'brief-review.md')))
})

test('script review merges density, complexity and concepts', () => {
  const signals = {
    contentRefs: 1,
    tableRows: 0,
    tableCols: 0,
    textRows: 0,
    textBlocks: 0,
    codeLines: 0,
    codeBlocks: 0,
    bulletItems: 0,
    narrationSentences: 0,
    narrationChars: 0,
    screenChars: 0,
  }
  const evidence = write('script-evidence.json', {
    mode: 'script',
    slides: [{ id: 'S01', screenContent: 'content', narration: 'narration' }],
  })
  const skeleton = write('script-skeleton.json', {
    stage: 'script',
    artifactPaths: [evidence],
    reviewedArtifacts: [{ path: evidence, sha256: '0'.repeat(64) }],
    automatedChecks: [{ name: 'check-script', status: 'pass', notes: 'ok' }],
    density: [{ slideId: 'S01', semanticUnits: [], signals, verdict: 'fail', notes: '' }],
    complexity: [{ slideId: 'S01', signals: { components: 1 }, verdict: 'fail', notes: '' }],
    concepts: [],
    checklist: [{ item: 'script', status: 'n/a' }],
    issues: [],
    verdict: 'fail',
    reviewedAt: '2026-10-27T00:00:00Z',
    reviewMeta: { densityAuthority: 'script' },
  })
  const mock = write('script-mock.json', {
    content: [{ type: 'text', text: JSON.stringify({
      checklist: [{ index: 0, status: 'pass' }],
      issues: [],
      density: [{
        slideId: 'S01',
        semanticUnits: [{ label: 'unit', evidence: 'evidence' }],
        verdict: 'pass',
        notes: '',
      }],
      complexity: [{ slideId: 'S01', verdict: 'pass', notes: '' }],
      concepts: [{ conceptId: 'C01', verdict: 'pass', evidence: 'evidence', slideIds: ['S01'] }],
      verdict: 'pass',
    }) }],
  })
  const review = path.join(tmp, 'script-review.json')
  fs.copyFileSync(skeleton, review)
  const result = run([
    '--mode', 'script', '--evidence', evidence, '--review-json', review,
    '--api', 'anthropic-messages', '--model', 'mock', '--mock-response', mock,
  ])
  assert.equal(result.status, 0, result.stderr)
  const data = JSON.parse(fs.readFileSync(review, 'utf8'))
  assert.equal(data.verdict, 'pass')
  assert.deepEqual(data.density[0].signals, signals)
  assert.equal(data.density[0].semanticUnits[0].label, 'unit')
  assert.equal(data.complexity[0].verdict, 'pass')
  assert.equal(data.concepts[0].conceptId, 'C01')
})

test('missing checklist index forces fail', () => {
  const evidence = write('bad-evidence.json', { mode: 'brief' })
  const skeleton = write('bad-skeleton.json', {
    stage: 'brief',
    artifactPaths: [evidence],
    reviewedArtifacts: [{ path: evidence, sha256: '0'.repeat(64) }],
    automatedChecks: [{ name: 'inputs', status: 'pass', notes: 'ok' }],
    checklist: [
      { item: 'one', status: 'n/a' },
      { item: 'two', status: 'n/a' },
    ],
    issues: [],
    verdict: 'fail',
    reviewedAt: '2026-10-27T00:00:00Z',
  })
  const mock = write('bad-mock.json', {
    content: [{ type: 'text', text: JSON.stringify({
      checklist: [{ index: 0, status: 'pass' }],
      issues: [],
      verdict: 'pass',
    }) }],
  })
  const review = path.join(tmp, 'bad-review.json')
  fs.copyFileSync(skeleton, review)
  const result = run([
    '--mode', 'brief', '--evidence', evidence, '--review-json', review,
    '--api', 'anthropic-messages', '--model', 'mock', '--mock-response', mock,
  ])
  assert.equal(result.status, 0, result.stderr)
  const data = JSON.parse(fs.readFileSync(review, 'utf8'))
  assert.equal(data.verdict, 'fail')
  assert.ok(data.issues.some((issue) => /checklist index 1 is missing/.test(issue.description)))
})

if (failed) {
  console.error(`${failed}/${total} review-ai tests failed`)
  process.exit(1)
}
console.log(`${total}/${total} review-ai tests passed`)
