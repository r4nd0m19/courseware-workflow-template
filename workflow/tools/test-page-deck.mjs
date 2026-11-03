#!/usr/bin/env node
// Test the single-shot page-deck generator plus the validating applier.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const tools = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-page-deck-'))
const evidence = path.join(tmp, 'evidence.json')
const deck = path.join(tmp, 'deck.json')
const mock = path.join(tmp, 'mock.json')
const slideOut = path.join(tmp, 'slide.json')
fs.writeFileSync(
  evidence,
  JSON.stringify({
    lesson: '测试课',
    lessonSlug: 'smoke',
    section: { id: 'S01', title: '封面', slides: ['S01'] },
    slideId: 'S01',
    scriptSlide: { title: '测试课' },
    storyboardSlide: { title: '测试课' },
    hint: { type: 'hero' },
    slideTypes: ['hero'],
    typeTemplates: { hero: { type: 'hero', title: '占位', lead: '占位', topics: [] } },
    deckMeta: { coverCode: 'old', coverOutput: 'old' },
    existingSlide: null,
    components: {},
  }),
)
fs.writeFileSync(deck, JSON.stringify({ meta: { coverCode: 'old', coverOutput: 'old' }, slides: [] }))
fs.writeFileSync(
  mock,
  JSON.stringify({
    content: [{
      type: 'text',
      text: JSON.stringify({
        meta: { coverCode: 'new' },
        slide: { id: 'S01', title: '测试课', type: 'hero', lead: '新封面', topics: ['路线'] },
      }),
    }],
  }),
)
const generate = spawnSync(
  process.execPath,
  [
    path.join(tools, 'single-shot-generate.mjs'),
    '--mode', 'page-deck',
    '--evidence', evidence,
    '--out', slideOut,
    '--api', 'anthropic-messages',
    '--model', 'mock',
    '--mock-response', mock,
  ],
  { encoding: 'utf8' },
)
if (generate.status !== 0) {
  console.error(generate.stdout, generate.stderr)
  process.exit(1)
}
const apply = spawnSync(
  process.execPath,
  [
    path.join(tools, 'apply-page-deck.mjs'),
    '--deck', deck,
    '--evidence', evidence,
    '--slide-json', slideOut,
  ],
  { encoding: 'utf8' },
)
if (apply.status !== 0) {
  console.error(apply.stdout, apply.stderr)
  process.exit(1)
}
const result = JSON.parse(fs.readFileSync(deck, 'utf8'))
assert.equal(result.meta.coverCode, 'new')
assert.equal(result.slides[0].id, 'S01')
assert.equal(result.slides[0].lead, '新封面')

// Staged exercise page: the applier must accept an exact copy of the approved
// script exercise and reject any drift in the visible tests.
const codeJudge = JSON.parse(
  fs.readFileSync(path.join(tools, '..', '..', 'registry', 'staging', 'code-judge', 'component.json'), 'utf8'),
)
const exercise = {
  component: 'code-judge',
  statement: '读入两个整数，输出它们的和。',
  starterCode: '#include <iostream>\nint main() {\n  int a, b;\n  std::cin >> a >> b;\n  std::cout << a + b << std::endl;\n  return 0;\n}',
  tests: [{ id: 't1', label: '基本样例', input: '1 2\n', expected: '3\n' }],
  timeLimitMs: 2000,
  maxOutputBytes: 65536,
}
function exerciseEvidence(withExercise) {
  return {
    lesson: '测试课',
    lessonSlug: 'smoke',
    section: { id: 'S03', title: '判题', slides: ['S03'] },
    slideId: 'S03',
    scriptSlide: withExercise
      ? { title: '测试判题', exercise }
      : { title: '测试判题' },
    storyboardSlide: { title: '测试判题' },
    hint: { type: 'blank', component: 'code-judge' },
    slideTypes: ['blank'],
    typeTemplates: {},
    deckMeta: {},
    existingSlide: null,
    components: { 'code-judge': { id: 'code-judge', propsSchema: codeJudge.propsSchema } },
  }
}
function applySlide(currentEvidence, slide) {
  const evidenceFile = path.join(tmp, 'exercise-evidence.json')
  const deckFile = path.join(tmp, 'exercise-deck.json')
  const slideFile = path.join(tmp, 'exercise-slide.json')
  fs.writeFileSync(evidenceFile, JSON.stringify(currentEvidence))
  fs.writeFileSync(deckFile, JSON.stringify({ meta: {}, slides: [] }))
  fs.writeFileSync(slideFile, JSON.stringify({ slide }))
  return spawnSync(
    process.execPath,
    [path.join(tools, 'apply-page-deck.mjs'), '--deck', deckFile, '--evidence', evidenceFile, '--slide-json', slideFile],
    { encoding: 'utf8' },
  )
}
const judgeSlide = {
  id: 'S03',
  title: '测试判题',
  type: 'blank',
  component: 'code-judge',
  props: {
    statement: exercise.statement,
    starterCode: exercise.starterCode,
    tests: exercise.tests,
    timeLimitMs: exercise.timeLimitMs,
    maxOutputBytes: exercise.maxOutputBytes,
  },
}
const exerciseApply = applySlide(exerciseEvidence(true), judgeSlide)
if (exerciseApply.status !== 0) {
  console.error(exerciseApply.stdout, exerciseApply.stderr)
  process.exit(1)
}
const driftedSlide = structuredClone(judgeSlide)
driftedSlide.props.tests[0].expected = '4\n'
const driftApply = applySlide(exerciseEvidence(true), driftedSlide)
assert.notEqual(driftApply.status, 0)
assert.match(driftApply.stderr, /props\.tests must exactly match/)
const noExerciseApply = applySlide(exerciseEvidence(false), judgeSlide)
assert.notEqual(noExerciseApply.status, 0)
assert.match(noExerciseApply.stderr, /code-judge is only allowed when the approved script declares an exercise/)
console.log('OK page deck generator + applier')
