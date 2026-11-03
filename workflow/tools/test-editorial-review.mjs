#!/usr/bin/env node
// Regression test for the editorial-review gate. No model or network is used.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const toolDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(toolDir, '..', '..')
const script = path.join(root, 'workflow/examples/courseware.example.md')
const checker = path.join(toolDir, 'check-editorial-review.mjs')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-editorial-review-'))
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(script)).digest('hex')

let failed = 0
function test(name, fn) {
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
function review(findings, overrides = {}) {
  return {
    stage: 'script-editorial',
    artifactPaths: [script],
    reviewedArtifacts: [{ path: script, sha256 }],
    summary: '审稿总结',
    findings,
    verdict: findings.some((finding) => finding.severity === 'blocking') ? 'revise' : 'pass',
    reviewedAt: '2026-11-03T00:00:00Z',
    reviewMeta: { mode: 'script-editorial' },
    ...overrides,
  }
}
function run(file, extra = []) {
  return spawnSync(process.execPath, [checker, file, '--script', script, ...extra], {
    encoding: 'utf8',
  })
}
function finding(overrides = {}) {
  return {
    slideId: 'S01',
    dimension: 'language',
    severity: 'minor',
    evidence: '程序是一组指令',
    suggestion: '把这句话写得更具体。',
    ...overrides,
  }
}

test('advisory findings pass the gate', () => {
  const file = write('advisory.json', review([finding()]))
  const result = run(file)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /0 blocking/)
})

test('blocking findings fail and write a fix brief', () => {
  const file = write('blocking.json', review([finding({ severity: 'blocking' })]))
  const fixBrief = path.join(tmp, 'fix.md')
  const result = run(file, ['--fix-brief', fixBrief])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /blocking finding/)
  const markdown = fs.readFileSync(fixBrief, 'utf8')
  assert.match(markdown, /S01/)
  assert.match(markdown, /把这句话写得更具体/)
})

test('unknown slide ids fail', () => {
  const file = write('unknown-slide.json', review([finding({ slideId: 'S99' })]))
  const result = run(file)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /unknown slide S99/)
})

test('stale script hash fails', () => {
  const file = write('stale.json', review([], {
    reviewedArtifacts: [{ path: script, sha256: '0'.repeat(64) }],
  }))
  const result = run(file)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /stale review/)
})

test('missing script binding fails', () => {
  const file = write('unbound.json', review([], {
    reviewedArtifacts: [{ path: path.join(root, 'workflow/examples/README.md'), sha256: sha256 }],
  }))
  const result = run(file)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /does not bind the current script/)
})

if (failed) {
  console.error(`${failed} editorial-review test(s) failed`)
  process.exit(1)
}
console.log('OK editorial review gate')
