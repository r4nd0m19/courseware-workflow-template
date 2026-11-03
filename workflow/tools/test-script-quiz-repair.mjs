#!/usr/bin/env node
// Mock-model regression test for quiz option formatting and distribution repair.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { readData } from './lib.mjs'

const tools = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-quiz-repair-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

function fence(content, lang = 'text') {
  return ['```' + lang, content, '```'].join('\n')
}

function optionBlock(lines) {
  return fence(lines.join('\n'))
}

function quizItem(id, text, options) {
  return {
    id,
    kind: 'quiz',
    text,
    required: false,
    quizType: 'single',
    options: options.map((option, index) => ({ text: option, correct: index === 0 })),
  }
}

const contentItems = [
  { id: 'K01', kind: 'knowledge', text: '测试概念', required: true },
  quizItem('Q01', '第一题？', ['甲', '乙', '丙']),
  quizItem('Q02', '第二题？', ['一', '二', '三']),
  quizItem('Q03', '第三题？', ['x', 'y', 'z']),
  quizItem('Q04', '第四题？', ['p', 'q', 'r']),
]
const contentFile = path.join(tmp, 'content.json')
fs.writeFileSync(
  contentFile,
  JSON.stringify({ version: '1.0', lesson: { id: 'quiz-repair', title: '测试课' }, items: contentItems }, null, 2),
)

const styleFile = path.join(tmp, 'style.json')
fs.writeFileSync(
  styleFile,
  JSON.stringify({
    id: 'quiz-repair-style',
    version: '1.0',
    components: [{ id: 'cover-hero', status: 'core' }, { id: 'quiz-bank', status: 'core' }],
    layouts: [{ id: 'cover' }, { id: 'content-slide' }],
  }),
)

const concepts = [{
  id: 'C01',
  term: '测试概念',
  definition: '测试概念是一个用于验证脚本生成的术语。',
  introducedOn: 'S01',
  mustAppear: ['测试概念'],
  evidence: '学生能说出测试概念。',
  sourceRefs: ['K01'],
}]
const conceptsFile = path.join(tmp, 'concepts.yml')
fs.writeFileSync(conceptsFile, YAML.stringify({ schemaVersion: '1.0', lesson: 'quiz-repair', concepts }))

const registryFile = path.join(tmp, 'registry', 'index.json')
fs.mkdirSync(path.join(tmp, 'registry'), { recursive: true })
fs.writeFileSync(
  registryFile,
  JSON.stringify({
    schemaVersion: '1.0',
    registryId: 'quiz-repair-registry',
    version: '0.0.1',
    stylePack: { id: 'quiz-repair-style', version: '1.0' },
    components: [],
  }),
)

const input = path.join(tmp, 'script-input.json')
const courseware = path.join(tmp, 'courseware.md')
const sections = path.join(tmp, 'review-sections.yml')
const reportPath = path.join(tmp, 'script-generation.json')
fs.writeFileSync(
  input,
  JSON.stringify({
    schemaVersion: '1.0',
    lessonSlug: 'quiz-repair',
    lesson: '测试课',
    spec: { path: 'spec.md', text: '# 测试课\n\n学生能说出测试概念。' },
    content: { path: contentFile, items: contentItems },
    concepts: { path: conceptsFile, concepts },
    style: {
      path: styleFile,
      components: [{ id: 'cover-hero' }, { id: 'quiz-bank' }],
      layouts: [{ id: 'cover' }, { id: 'content-slide' }],
    },
    registry: { path: registryFile, components: [] },
    templates: {},
    outputs: { courseware, reviewSections: sections },
    existing: { courseware: '' },
    rules: ['一页一个语义边界。'],
  }),
)

const outline = {
  lesson: 'quiz-repair',
  title: '测试课',
  audience: '测试学生',
  duration: '45 minutes',
  overview: {
    learners: '测试学习者',
    objectives: [{ id: 'O1', text: '说出测试概念并完成选择题' }],
    misconceptions: [],
    pace: '导入 → 练习',
    componentStrategy: '使用 cover-hero 和 quiz-bank。',
  },
  pages: [
    {
      id: 'S01',
      title: '测试页',
      objectiveId: 'O1',
      objective: '说出测试概念',
      contentRefs: ['K01'],
      purpose: '验证结构化生成。',
      concepts: ['C01'],
      components: ['cover-hero'],
      layout: 'cover',
      interaction: { type: 'cover-hero', level: 'watch', learningAction: 'observe' },
    },
    ...[
      ['S02', '第一题', 'Q01'],
      ['S03', '第二题', 'Q02'],
      ['S04', '第三题', 'Q03'],
      ['S05', '第四题', 'Q04'],
    ].map(([id, title, ref]) => ({
      id,
      title,
      objectiveId: 'O1',
      objective: '说出测试概念并完成选择题',
      contentRefs: [ref],
      purpose: '用选择题检验概念。',
      concepts: [],
      components: ['quiz-bank'],
      layout: 'content-slide',
      interaction: { type: 'quiz-bank', level: 'answer', learningAction: 'predict', component: 'quiz-bank' },
    })),
  ],
}

function interactionDesign(level) {
  if (level === 'watch') {
    return {
      attempt: '本页只做定向，静态呈现即可。',
      learningAction: 'observe',
      contentDemand: '学生阅读测试概念。',
      evidence: '能说出测试概念。',
      learningFunction: '建立概念。',
      level: 'watch',
      initialState: '显示测试概念。',
      studentAction: '阅读',
      accessibility: '语义标题，键盘可读。',
      staticAlternative: '静态文字。',
      whyStatic: '定向页没有比静态文字更好的互动证据。',
    }
  }
  return {
    attempt: '用选择题检验概念。',
    learningAction: 'predict',
    contentDemand: '学生需要从选项中预测正确说法。',
    evidence: '选中正确选项。',
    learningFunction: '检验概念。',
    level: 'answer',
    initialState: '显示题干和两个选项。',
    studentAction: '点击选项',
    successFeedback: '显示答对。',
    errorFeedback: '显示答错，并提示测试概念。',
    completion: '选中正确选项。',
    reset: '可以重试。',
    accessibility: '按钮可达，键盘可操作。',
    staticAlternative: '静态题干与答案解析。',
  }
}

function page(id, title, screenContent, level) {
  return {
    id,
    title,
    screenContent,
    interactionDesign: interactionDesign(level),
    narration: ['请阅读并完成本页。'],
    transition: '进入下一页。',
  }
}

const pageS01 = page('S01', '测试页', '测试概念', 'watch')
const pageS02List = page('S02', '第一题', '第一题？\n\n- 甲\n- 乙\n- 丙', 'answer')
const pageS02Fenced = page(
  'S02',
  '第一题',
  `第一题？\n\n${optionBlock(['A. 甲', 'B. 乙', 'C. 丙'])}`,
  'answer',
)
const pageS03 = page('S03', '第二题', `第二题？\n\n${optionBlock(['A. 一', 'B. 二', 'C. 三'])}`, 'answer')
const pageS04 = page('S04', '第三题', `第三题？\n\n${optionBlock(['A. x', 'B. y', 'C. z'])}`, 'answer')
const pageS05 = page('S05', '第四题', `第四题？\n\n${optionBlock(['A. p', 'B. q', 'C. r'])}`, 'answer')

// The first S02 attempt uses a Markdown list and must be repaired by the
// page-level quiz check. S04 and S05 start with every correct answer at A and
// must be repaired by the distribution loop.
const pageS04Repaired = page(
  'S04',
  '第三题',
  `第三题？\n\n${optionBlock(['A. y', 'B. x', 'C. z'])}`,
  'answer',
)
const pageS05Repaired = page(
  'S05',
  '第四题',
  `第四题？\n\n${optionBlock(['A. q', 'B. r', 'C. p'])}`,
  'answer',
)

const mocks = path.join(tmp, 'mocks')
fs.mkdirSync(mocks)
function envelope(value) {
  return JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }] })
}
fs.writeFileSync(path.join(mocks, 'outline.json'), envelope(outline))
for (const [id, value] of [
  ['S01', pageS01],
  ['S02', pageS02List],
  ['S03', pageS03],
  ['S04', pageS04],
  ['S05', pageS05],
]) {
  fs.writeFileSync(path.join(mocks, `page-${id}.json`), envelope(value))
}
fs.writeFileSync(path.join(mocks, 'page-S02-repair.json'), envelope(pageS02Fenced))
fs.writeFileSync(path.join(mocks, 'page-S04-repair.json'), envelope(pageS04Repaired))
fs.writeFileSync(path.join(mocks, 'page-S05-repair.json'), envelope(pageS05Repaired))

const result = spawnSync(
  process.execPath,
  [
    path.join(tools, 'generate-courseware-script.mjs'),
    '--input', input,
    '--report', reportPath,
    '--mock-dir', mocks,
  ],
  { encoding: 'utf8', cwd: tmp },
)
assert.equal(result.status, 0, result.stdout + result.stderr)

const report = readData(reportPath)
assert.equal(report.pages.find((entry) => entry.id === 'S02').attempts, 2)
assert.equal(report.quizRepairs.length, 2)
assert.deepEqual(report.quizRepairs.map((entry) => entry.pageId), ['S04', 'S05'])
assert.ok(report.quizRepairs.every((entry) => entry.ok))
assert.deepEqual(report.quizAudit.distribution, { A: 2, B: 1, C: 1 })

const check = spawnSync(
  process.execPath,
  [path.join(tools, 'check-quiz-keys.mjs'), courseware, '--content', contentFile],
  { encoding: 'utf8' },
)
assert.equal(check.status, 0, check.stdout + check.stderr)
assert.match(check.stdout, /OK quiz keys/)

console.log('PASS quiz format and distribution repair')
