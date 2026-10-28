#!/usr/bin/env node
// Regression test for structured self-study audit + proposal insertion.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readData } from './lib.mjs'

const tools = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(tools, '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-self-study-'))
const script = path.join(tmp, 'courseware.md')
const content = path.join(root, 'workflow/examples/content-pack.example.json')
const audit = path.join(tmp, 'self-study-audit.json')
const md = path.join(tmp, 'self-study-audit.md')
const proposal = path.join(tmp, 'courseware.self-study.md')
const raw = path.join(tmp, 'self-study-audit-generation.json')
const mocks = path.join(tmp, 'mocks')
fs.mkdirSync(mocks)
fs.copyFileSync(path.join(root, 'workflow/examples/courseware.example.md'), script)

const judgments = {
  rubric: [
    { id: 'objectives', verdict: 'pass', evidence: 'S01 讲解，S02 练习，O1 覆盖。' },
    { id: 'prerequisites', verdict: 'pass', evidence: 'S01 从零开始。' },
    { id: 'explanation', verdict: 'pass', evidence: 'S01 给出程序定义与指令顺序。' },
    { id: 'worked-examples', verdict: 'gap', evidence: 'S02 只有代码和输出，没有逐步解释。' },
    { id: 'practice', verdict: 'pass', evidence: 'S02 有输出练习。' },
    { id: 'feedback', verdict: 'pass', evidence: 'S02 测验有逐项反馈。' },
    { id: 'misconceptions', verdict: 'pass', evidence: 'S02 辨析题处理 cin 误区。' },
    { id: 'navigation', verdict: 'pass', evidence: 'S01 结尾转到 S02。' },
    { id: 'accessibility', verdict: 'n/a', evidence: '无动画，全部为静态文本。' },
    { id: 'self-regulation', verdict: 'gap', evidence: 'S02 做错后没有提示如何重试。' },
  ],
  objectives: [{
    id: 'O1',
    explanation: true,
    workedExample: false,
    practice: true,
    feedback: true,
    slides: ['S01', 'S02'],
  }],
  screens: [
    { id: 'S01', role: 'explain', objectiveIds: ['O1'], status: 'sufficient', gapIds: [] },
    { id: 'S02', role: 'practice', objectiveIds: ['O1'], status: 'gap', gapIds: ['G01', 'G02'], notes: '缺完整例题与重试提示' },
  ],
  gaps: [
    {
      id: 'G01', severity: 'blocking', dimension: 'worked-examples', slideIds: ['S02'], objectiveIds: ['O1'],
      summary: 'S02 缺少逐步执行的完整例题',
      evidence: '屏幕只给出最终代码和输出，没有解释每一行做什么。',
      proposal: '在 S02 代码后补一段逐行解释，并给出一次输出推演。',
      basis: 'content pack K01；worked-example effect',
      pageImpact: 0,
    },
    {
      id: 'G02', severity: 'recommended', dimension: 'self-regulation', slideIds: ['S02'], objectiveIds: ['O1'],
      summary: '错误后缺少重试提示',
      evidence: '测验错误反馈只写“再想想”。',
      proposal: '补一句可操作提示：先检查分号，再检查引号。',
      basis: 'content pack 反馈字段；formative feedback',
      pageImpact: 0,
    },
  ],
  supplements: [
    {
      id: 'G01-a', gapId: 'G01', type: 'worked-example', targetSlides: ['S02'],
      basis: 'content pack K01；worked-example effect',
      summary: '在 S02 补逐行解释与输出推演',
      placement: 'screen-content',
      content: '逐行看这段程序：`#include <iostream>` 引入输入输出库；`int main()` 是程序入口；`std::cout` 把文字送到屏幕。',
    },
    {
      id: 'G02-a', gapId: 'G02', type: 'feedback', targetSlides: ['S02'],
      basis: 'content pack 反馈字段；formative feedback',
      summary: '在 S02 补可操作的重试提示',
      placement: 'interaction-design',
      content: '如果选错，先检查语句里是否用了 `cout`，再检查字符串是否放在双引号内；改完后点“重试”。',
    },
  ],
  newSlides: [],
  verdict: 'insufficient',
}
fs.writeFileSync(
  path.join(mocks, 'self-study.json'),
  JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(judgments) }] }),
)
const result = spawnSync(
  process.execPath,
  [
    path.join(tools, 'generate-self-study-audit.mjs'),
    '--lesson-slug', 'demo-lesson-01',
    '--lesson', '演示课：程序与输出',
    '--script', script,
    '--content', content,
    '--style', path.join(root, 'workflow/examples/style-pack.example.json'),
    '--registry', path.join(root, 'workflow/examples/registry/index.json'),
    '--concepts', path.join(root, 'workflow/examples/concepts.example.yml'),
    '--out', audit,
    '--md', md,
    '--raw', raw,
    '--proposal', proposal,
    '--review-dir', path.join(tmp, 'review'),
    '--declared-pages', '2',
    '--mock-dir', mocks,
    '--api', 'anthropic-messages',
    '--model', 'mock',
  ],
  { encoding: 'utf8' },
)
if (result.status !== 0) {
  console.error(result.stdout, result.stderr)
  process.exit(1)
}
const data = readData(audit)
assert.equal(data.verdict, 'insufficient')
assert.equal(data.script.slides, 2)
assert.equal(data.pageBudget.proposed, 2)
assert.equal(data.supplements.length, 2)
const proposalText = fs.readFileSync(proposal, 'utf8')
assert.match(proposalText, /<!-- self-study-supplement:G01-a -->/)
assert.match(proposalText, /<!-- self-study-supplement:G02-a -->/)
assert.match(proposalText, /自学补充/)
assert.match(proposalText, /G01-a[\s\S]*依据：content pack K01/)
assert.ok(fs.existsSync(md))
assert.match(fs.readFileSync(md, 'utf8'), /十维评分/)
const gate = spawnSync(
  process.execPath,
  [path.join(tools, 'check-self-study.mjs'), audit, '--script', script, '--proposal', proposal],
  { encoding: 'utf8' },
)
if (gate.status !== 0) {
  console.error(gate.stdout, gate.stderr)
  process.exit(1)
}
console.log('PASS structured self-study audit + proposal insertion')

// A new page must be rendered into the proposal and added to review-sections.
const pageTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-self-study-page-'))
const pageScript = path.join(pageTmp, 'courseware.md')
const pageAudit = path.join(pageTmp, 'self-study-audit.json')
const pageProposal = path.join(pageTmp, 'courseware.self-study.md')
const pageSections = path.join(pageTmp, 'review-sections.yml')
const pageMocks = path.join(pageTmp, 'mocks')
fs.mkdirSync(pageMocks)
fs.copyFileSync(path.join(root, 'workflow/examples/courseware.example.md'), pageScript)
const withPage = structuredClone(judgments)
withPage.gaps[0].pageImpact = 1
withPage.newSlides = [{
  id: 'S03',
  afterSlide: 'S02',
  gapId: 'G01',
  title: '自学补充练习',
  objectiveId: 'O1',
  objective: '能说出程序按顺序执行',
  contentRefs: ['K01'],
  purpose: '补一页检查学生是否理解指令顺序。',
  concepts: [],
  components: ['eyebrow-heading', 'rich-text'],
  layout: 'content-slide',
  interaction: { type: 'static-reading', level: 'watch', learningAction: 'observe' },
  screenContent: '程序是一组按顺序执行的指令。\n\n请读完后说出一条指令和一个执行顺序。',
  interactionDesign: {
    attempt: '本页是补充阅读与口头复述，不做额外交互。',
    learningAction: 'observe',
    contentDemand: '学生需要复述指令与顺序。',
    evidence: '能说出指令按顺序执行。',
    learningFunction: '补充检查理解。',
    level: 'watch',
    initialState: '显示补充说明。',
    studentAction: '阅读并复述。',
    accessibility: '语义段落，键盘可读。',
    staticAlternative: '静态文字。',
    whyStatic: '本页只补一段检查，静态阅读已有完整信息。',
  },
  narration: ['读一读这段补充说明，然后用自己的话说出指令和顺序。'],
  transition: '回到练习。',
}]
fs.writeFileSync(
  path.join(pageMocks, 'self-study.json'),
  JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(withPage) }] }),
)
const pageResult = spawnSync(
  process.execPath,
  [
    path.join(tools, 'generate-self-study-audit.mjs'),
    '--lesson-slug', 'demo-lesson-01',
    '--lesson', '演示课：程序与输出',
    '--script', pageScript,
    '--content', content,
    '--style', path.join(root, 'workflow/examples/style-pack.example.json'),
    '--registry', path.join(root, 'workflow/examples/registry/index.json'),
    '--concepts', path.join(root, 'workflow/examples/concepts.example.yml'),
    '--out', pageAudit,
    '--md', path.join(pageTmp, 'self-study-audit.md'),
    '--raw', path.join(pageTmp, 'self-study-audit-generation.json'),
    '--proposal', pageProposal,
    '--review-dir', path.join(pageTmp, 'review'),
    '--declared-pages', '3',
    '--mock-dir', pageMocks,
    '--api', 'anthropic-messages',
    '--model', 'mock',
  ],
  { encoding: 'utf8' },
)
if (pageResult.status !== 0) {
  console.error(pageResult.stdout, pageResult.stderr)
  process.exit(1)
}
assert.equal(readData(pageAudit).pageBudget.proposed, 3)
assert.match(fs.readFileSync(pageProposal, 'utf8'), /^## S03 · 自学补充练习/m)
const applyResult = spawnSync(
  process.execPath,
  [
    path.join(tools, 'apply-self-study-audit.mjs'),
    '--audit', pageAudit,
    '--script', pageScript,
    '--proposal', pageProposal,
    '--sections', pageSections,
    '--record', path.join(pageTmp, 'self-study-apply.json'),
    '--backup', path.join(pageTmp, 'courseware.before-self-study.md'),
  ],
  { encoding: 'utf8' },
)
if (applyResult.status !== 0) {
  console.error(applyResult.stdout, applyResult.stderr)
  process.exit(1)
}
assert.equal(fs.readFileSync(pageScript, 'utf8').match(/^##\s+S\d+/gm).length, 3)
assert.match(fs.readFileSync(pageSections, 'utf8'), /id: S03/)
assert.match(fs.readFileSync(pageSections, 'utf8'), /slides: \[S03\]/)
const scriptGate = spawnSync(
  process.execPath,
  [path.join(tools, 'check-script.mjs'), pageScript, content, path.join(root, 'workflow/examples/style-pack.example.json')],
  { encoding: 'utf8' },
)
if (scriptGate.status !== 0) {
  console.error(scriptGate.stdout, scriptGate.stderr)
  process.exit(1)
}
console.log('PASS structured self-study new page + review-sections sync')
