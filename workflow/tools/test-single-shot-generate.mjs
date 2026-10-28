#!/usr/bin/env node
// Tests for the single-shot art/reference JSON generator. No network/key.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const toolDir = path.dirname(fileURLToPath(import.meta.url))
const tool = path.join(toolDir, 'single-shot-generate.mjs')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-single-shot-generate-'))
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
function mock(text) {
  return write(`mock-${Math.random().toString(16).slice(2)}.json`, {
    content: [{ type: 'text', text: JSON.stringify(text) }],
  })
}

test('art brief writes one prompt per slot', () => {
  const evidence = write('art-evidence.json', {
    lessonSlug: 'smoke',
    lesson: '测试课',
    slots: [{ slot: 'cover' }, { slot: 'end' }],
    scriptSlides: [],
  })
  const response = mock({ prompts: { cover: 'a', end: 'b' } })
  const out = path.join(tmp, 'art-prompts.json')
  const result = run([
    '--mode', 'art-brief', '--evidence', evidence, '--out', out,
    '--api', 'anthropic-messages', '--model', 'mock', '--mock-response', response,
  ])
  assert.equal(result.status, 0, result.stderr)
  const data = JSON.parse(fs.readFileSync(out, 'utf8'))
  assert.equal(data.lesson, 'smoke')
  assert.deepEqual(data.prompts, { cover: 'a', end: 'b' })
})

test('art brief rejects missing slots', () => {
  const evidence = write('art-missing-evidence.json', {
    lessonSlug: 'smoke',
    lesson: '测试课',
    slots: [{ slot: 'cover' }, { slot: 'end' }],
    scriptSlides: [],
  })
  const response = mock({ prompts: { cover: 'a' } })
  const out = path.join(tmp, 'art-missing.json')
  const result = run([
    '--mode', 'art-brief', '--evidence', evidence, '--out', out,
    '--api', 'anthropic-messages', '--model', 'mock', '--mock-response', response,
  ])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /missing=end/)
})

test('reference adaptation fills metadata and validates entries', () => {
  const evidence = write('ref-evidence.json', {
    lessonSlug: 'smoke',
    lesson: '测试课',
    shell: 'branch-choice',
    referenceSource: 'shells/branch-choice/source/lesson.js',
    scriptSlides: [],
  })
  const response = mock({
    referenceLesson: 'reference',
    entries: [{
      id: 'RA01',
      kind: 'text',
      reference: 'reference title',
      where: 'cover',
      lesson: '本课标题',
      lessonText: '本课标题',
      evidence: 'same slot',
      pages: ['S01'],
      residue: 'replace',
    }],
  })
  const out = path.join(tmp, 'reference.json')
  const result = run([
    '--mode', 'reference-adaptation', '--evidence', evidence, '--out', out,
    '--api', 'anthropic-messages', '--model', 'mock', '--mock-response', response,
  ])
  assert.equal(result.status, 0, result.stderr)
  const data = JSON.parse(fs.readFileSync(out, 'utf8'))
  assert.equal(data.lesson, 'smoke')
  assert.equal(data.shell, 'branch-choice')
  assert.equal(data.entries[0].id, 'RA01')
})

test('script outline and page modes pass structured JSON through', () => {
  const outlineEvidence = write('script-outline-evidence.json', {
    lessonSlug: 'smoke',
    lesson: '测试课',
    content: [],
    concepts: [],
    style: { components: [], layouts: [] },
    registry: { components: [] },
    rules: [],
  })
  const outlineResponse = mock({ lesson: 'smoke', title: '测试课', pages: [] })
  const outlineOut = path.join(tmp, 'script-outline.json')
  const outlineResult = run([
    '--mode', 'script-outline', '--evidence', outlineEvidence, '--out', outlineOut,
    '--api', 'anthropic-messages', '--model', 'mock', '--mock-response', outlineResponse,
  ])
  assert.equal(outlineResult.status, 0, outlineResult.stderr)
  assert.equal(JSON.parse(fs.readFileSync(outlineOut, 'utf8')).title, '测试课')

  const pageEvidence = write('script-page-evidence.json', {
    lessonSlug: 'smoke',
    lesson: '测试课',
    page: { id: 'S01', title: '测试页' },
  })
  const pageResponse = mock({ id: 'S01', title: '测试页', narration: ['旁白'] })
  const pageOut = path.join(tmp, 'script-page.json')
  const pageResult = run([
    '--mode', 'script-page', '--evidence', pageEvidence, '--out', pageOut,
    '--api', 'anthropic-messages', '--model', 'mock', '--mock-response', pageResponse,
  ])
  assert.equal(pageResult.status, 0, pageResult.stderr)
  assert.equal(JSON.parse(fs.readFileSync(pageOut, 'utf8')).id, 'S01')
})

if (failed) {
  console.error(`${failed}/${total} single-shot-generate tests failed`)
  process.exit(1)
}
console.log(`${total}/${total} single-shot-generate tests passed`)
