#!/usr/bin/env node
// Regression test for structured spec.md + concepts.yml generation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readData } from './lib.mjs'

const tools = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-brief-'))
const contentPath = path.join(tmp, 'content.json')
const stylePath = path.join(tmp, 'style.json')
const specPath = path.join(tmp, 'spec.md')
const conceptsPath = path.join(tmp, 'concepts.yml')
const mockDir = path.join(tmp, 'mocks')
fs.mkdirSync(mockDir)
fs.writeFileSync(
  contentPath,
  JSON.stringify({
    version: '1.0',
    lesson: { id: 'smoke-brief', title: '测试课' },
    items: [{ id: 'K01', kind: 'knowledge', title: '测试概念', text: '测试概念', required: true }],
  }),
)
fs.writeFileSync(
  stylePath,
  JSON.stringify({
    id: 'smoke-style',
    version: '1.0',
    components: [{ id: 'cover-hero', status: 'core' }],
    layouts: [{ id: 'cover' }],
  }),
)
const brief = {
  lesson: 'smoke-brief',
  title: '测试课',
  audience: '测试学生',
  duration: '45 minutes',
  scenario: '自学',
  learnerProfile: {
    priorKnowledge: '无先修要求',
    gaps: '可能没有自学经验',
    motivation: '通过小例子建立信心',
  },
  misconceptions: [{
    id: 'M1',
    text: '把测试概念当成测试',
    source: 'K01',
    expose: '在例子中展示区别',
    rebut: '明确指出测试概念的定义',
  }],
  objectives: [{
    id: 'O1',
    text: '能说出测试概念',
    type: 'concept',
    evidence: '学生能用自己的话解释测试概念',
  }],
  concepts: [{
    id: 'C01',
    term: '测试概念',
    definition: '测试概念是一个用于验证结构化简报生成的概念。',
    introducedOn: 'S01',
    mustAppear: ['测试概念', '必须出现'],
    evidence: '学生能说出测试概念。',
    sourceRefs: ['K01'],
  }],
  assessments: {
    preTest: '先预测测试概念是什么',
    transfer: '在新例子中认出测试概念',
    delayed: '课后复述测试概念',
  },
  coverage: [{ contentId: 'K01', kind: 'knowledge', plannedSlides: ['S01'], notes: '开场引入' }],
  nonGoals: { notCovered: ['高级用法'], intentionallyNotDone: ['不做完整项目'] },
  sequence: '问题激活 → 示例 → 练习 → 小结',
  risks: ['例子可能过短'],
  assumptions: ['学生已有基本阅读能力'],
}
fs.writeFileSync(
  path.join(mockDir, 'brief.json'),
  JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(brief) }] }),
)
const result = spawnSync(
  process.execPath,
  [
    path.join(tools, 'generate-brief.mjs'),
    '--lesson-slug', 'smoke-brief',
    '--lesson', '测试课',
    '--content', contentPath,
    '--style', stylePath,
    '--spec', specPath,
    '--concepts', conceptsPath,
    '--review-dir', path.join(tmp, 'review'),
    '--mock-dir', mockDir,
    '--api', 'anthropic-messages',
    '--model', 'mock',
  ],
  { encoding: 'utf8' },
)
if (result.status !== 0) {
  console.error(result.stdout, result.stderr)
  process.exit(1)
}
assert.ok(fs.existsSync(specPath))
assert.ok(fs.existsSync(conceptsPath))
const spec = fs.readFileSync(specPath, 'utf8')
assert.match(spec, /# 教学简报：测试课/)
assert.match(spec, /核心概念台账/)
assert.match(spec, /测试概念/)
const ledger = readData(conceptsPath)
assert.equal(ledger.schemaVersion, '1.0')
assert.equal(ledger.concepts[0].introducedOn, 'S01')
const gate = spawnSync(
  process.execPath,
  [path.join(tools, 'check-concepts.mjs'), '--ledger-only', contentPath, '--concepts', conceptsPath],
  { encoding: 'utf8' },
)
if (gate.status !== 0) {
  console.error(gate.stdout, gate.stderr)
  process.exit(1)
}
console.log('PASS structured teaching brief generation')
