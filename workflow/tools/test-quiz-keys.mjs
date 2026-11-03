#!/usr/bin/env node
// Regression test for the answer-position gate and its shared quiz rules.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const tools = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-quiz-keys-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

function fence(content, lang = 'text') {
  return ['```' + lang, content, '```'].join('\n')
}

function optionBlock(lines) {
  return fence(lines.join('\n'))
}

function slide(id, { level = 'answer', refs = [], screen = '', title = '测试页' } = {}) {
  const interaction = level === 'watch'
    ? [
        'interaction:',
        '  type: observe',
        '  level: watch',
        '  learningAction: observe',
        `contentRefs: [${refs.join(', ')}]`,
      ].join('\n')
    : [
        'interaction:',
        '  type: quiz-bank',
        '  level: answer',
        '  learningAction: predict',
        '  component: quiz-bank',
        `contentRefs: [${refs.join(', ')}]`,
      ].join('\n')
  return `## ${id} · ${title}

**对应目标**：O1 · 测试

**内容来源**：${refs.join(', ')}

**本屏作用**：测试。

### 屏幕内容

${screen}

### 交互设计

测试交互。

### 旁白 / 语音

> 测试旁白。

### 转场

> 转到下一页。

### 制作字段

\`\`\`yaml
${interaction}
\`\`\`
`
}

function quiz(id, text, options, correctIndex = 0) {
  return {
    id,
    kind: 'quiz',
    text,
    quizType: 'single',
    options: options.map((option, index) => ({ text: option, correct: index === correctIndex })),
  }
}

function writeContent(name, items) {
  const file = path.join(tmp, `${name}.content.json`)
  fs.writeFileSync(file, JSON.stringify({ version: '1.0', items }, null, 2))
  return file
}

function writeScript(name, slides) {
  const file = path.join(tmp, `${name}.md`)
  fs.writeFileSync(file, `---\nlesson: test\n---\n\n${slides.join('\n')}`)
  return file
}

function check(scriptPath, contentPath) {
  const result = spawnSync(
    process.execPath,
    [path.join(tools, 'check-quiz-keys.mjs'), scriptPath, '--content', contentPath, '--json'],
    { encoding: 'utf8' },
  )
  let json = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    // The assertions below report the raw output when the checker crashed.
  }
  return { status: result.status, json, stdout: result.stdout, stderr: result.stderr }
}

// 1) Fenced answer blocks pass; watch preview pages are not counted; inline
//    code backticks do not change option identity.
{
  const content = writeContent('pass', [
    quiz('Q01', '第一题？', ['甲', '乙', '丙'], 1),
    quiz('Q02', '第二题？', ['一', '二', '三'], 2),
    quiz('Q03', '第三题？', ['a[2][3]', 'a[1][2]', 'a[2][4]', 'a[3][2]'], 0),
  ])
  const script = writeScript('pass', [
    slide('S01', { level: 'watch', refs: ['Q01'], screen: '- 甲\n- 乙\n- 丙' }),
    slide('S02', { refs: ['Q01'], screen: `第一题？\n\n${optionBlock(['A. 甲', 'B. 乙', 'C. 丙'])}` }),
    slide('S03', { refs: ['Q02'], screen: `第二题？\n\n${optionBlock(['A. 一', 'B. 二', 'C. 三'])}` }),
    slide('S04', {
      refs: ['Q03'],
      screen: `第三题？\n\n${optionBlock(['A. `a[2][3]`', 'B. a[1][2]', 'C. a[2][4]', 'D. a[3][2]'])}`,
    }),
  ])
  const result = check(script, content)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.json.ok, true)
  assert.equal(result.json.questions.length, 3)
  assert.equal(result.json.questions.find((question) => question.id === 'Q01').slideId, 'S02')
  assert.equal(result.json.questions.find((question) => question.id === 'Q03').answer, 'A')
  assert.ok(!result.json.questions.some((question) => question.slideId === 'S01'))
}

// 2) A Markdown list on an answer page is not an option block.
{
  const content = writeContent('list', [quiz('Q01', '第一题？', ['甲', '乙', '丙'], 1)])
  const script = writeScript('list', [
    slide('S01', { level: 'watch', refs: ['Q01'], screen: '- 甲\n- 乙\n- 丙' }),
    slide('S02', { refs: ['Q01'], screen: '第一题？\n\n- 甲\n- 乙\n- 丙' }),
  ])
  const result = check(script, content)
  assert.equal(result.status, 1)
  assert.ok(
    result.json.errors.some((error) => error.includes('S02') && error.includes('has no option block')),
    result.stdout,
  )
}

// 3) The same quiz answered on two non-watch pages counts once. Without
//    deduplication this lesson would be 3/4 A and fail the distribution gate.
{
  const content = writeContent('dedupe', [
    quiz('Q01', '第一题？', ['甲', '乙', '丙'], 0),
    quiz('Q02', '第二题？', ['一', '二', '三'], 0),
    quiz('Q03', '第三题？', ['x', 'y', 'z'], 1),
  ])
  const script = writeScript('dedupe', [
    slide('S01', { refs: ['Q01'], screen: `第一题？\n\n${optionBlock(['A. 甲', 'B. 乙', 'C. 丙'])}` }),
    slide('S02', { refs: ['Q01'], screen: `第一题再答一次？\n\n${optionBlock(['A. 甲', 'B. 乙', 'C. 丙'])}` }),
    slide('S03', { refs: ['Q02'], screen: `第二题？\n\n${optionBlock(['A. 一', 'B. 二', 'C. 三'])}` }),
    slide('S04', { refs: ['Q03'], screen: `第三题？\n\n${optionBlock(['A. x', 'B. y', 'C. z'])}` }),
  ])
  const result = check(script, content)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.json.questions.length, 3)
  assert.ok(result.json.warnings.some((warning) => warning.includes('already answered')))
}

// 4) Four correct answers in the same position fail both distribution checks.
{
  const content = writeContent('distribution', [
    quiz('Q01', '第一题？', ['甲', '乙', '丙'], 0),
    quiz('Q02', '第二题？', ['一', '二', '三'], 0),
    quiz('Q03', '第三题？', ['x', 'y', 'z'], 0),
    quiz('Q04', '第四题？', ['p', 'q', 'r'], 0),
  ])
  const script = writeScript('distribution', [
    slide('S01', { refs: ['Q01'], screen: `第一题？\n\n${optionBlock(['A. 甲', 'B. 乙', 'C. 丙'])}` }),
    slide('S02', { refs: ['Q02'], screen: `第二题？\n\n${optionBlock(['A. 一', 'B. 二', 'C. 三'])}` }),
    slide('S03', { refs: ['Q03'], screen: `第三题？\n\n${optionBlock(['A. x', 'B. y', 'C. z'])}` }),
    slide('S04', { refs: ['Q04'], screen: `第四题？\n\n${optionBlock(['A. p', 'B. q', 'C. r'])}` }),
  ])
  const result = check(script, content)
  assert.equal(result.status, 1)
  assert.ok(result.json.errors.some((error) => error.includes('all 4 correct answers are at position A')))
  assert.ok(result.json.errors.some((error) => error.includes('exceeds the 60% limit')))
}

// 5) Deck mode keeps working after the shared-rule refactor.
{
  const deck = path.join(tmp, 'deck.json')
  fs.writeFileSync(
    deck,
    JSON.stringify({
      slides: [{
        id: 'S01',
        component: 'quiz-bank',
        props: {
          questions: [
            { id: 'Q1', options: [{ id: 'A', text: '甲', correct: true }, { id: 'B', text: '乙' }, { id: 'C', text: '丙' }] },
            { id: 'Q2', options: [{ id: 'A', text: '一' }, { id: 'B', text: '二', correct: true }, { id: 'C', text: '三' }] },
            { id: 'Q3', options: [{ id: 'A', text: 'x' }, { id: 'B', text: 'y' }, { id: 'C', text: 'z', correct: true }] },
          ],
        },
      }],
    }),
  )
  const result = spawnSync(process.execPath, [path.join(tools, 'check-quiz-keys.mjs'), deck, '--json'], {
    encoding: 'utf8',
  })
  const json = JSON.parse(result.stdout)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(json.ok, true)
  assert.equal(json.mode, 'deck')
  assert.equal(json.questions.length, 3)
}

console.log('PASS quiz keys checker')
