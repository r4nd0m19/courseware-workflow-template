#!/usr/bin/env node
// Render spec.md and concepts.yml from a structured teaching brief.
// Node owns the headings, tables and YAML so the brief format cannot drift.
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { readData } from './lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
const briefPath = opt('--brief')
const specPath = opt('--spec')
const conceptsPath = opt('--concepts')
const inputPath = opt('--input')
if (!briefPath || !specPath || !conceptsPath) {
  console.error('usage: node render-brief.mjs --brief <brief.json> --spec <spec.md> --concepts <concepts.yml> [--input <brief-input.json>]')
  process.exit(2)
}
const brief = readData(briefPath)
const input = inputPath && fs.existsSync(path.resolve(inputPath)) ? readData(inputPath) : {}
function cell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}
function list(values) {
  const items = (values || []).filter((value) => String(value || '').trim())
  return items.length ? items.map((value) => `- ${value}`).join('\n') : '- （无）'
}
const concepts = brief.concepts || []
const objectives = brief.objectives || []
const misconceptions = brief.misconceptions || []
const coverage = brief.coverage || []
const nonGoals = brief.nonGoals || {}
const assessments = brief.assessments || {}

const lines = [
  `# 教学简报：${brief.title}`,
  '',
  '## 0. 元数据',
  '',
  `- lesson id：${brief.lesson}`,
  `- content pack：${brief.contentPackPath || input.content?.path || ''}`,
  `- style pack：${brief.stylePackPath || input.style?.path || ''}`,
  `- 受众 / 前置知识：${brief.audience}`,
  `- 时长 / 场景：${brief.duration} / ${brief.scenario}`,
  '',
  '## 1. 学习者与前置',
  '',
  `- 已有知识：${brief.learnerProfile.priorKnowledge}`,
  `- 可能缺口：${brief.learnerProfile.gaps}`,
  `- 学习动机 / 使用场景：${brief.learnerProfile.motivation}`,
  '',
  '## 2. 常见误区',
  '',
  '| ID | 误区 | 来源（contentRef / 文献） | 如何暴露 | 如何反驳 |',
  '|---|---|---|---|---|',
  ...(misconceptions.length
    ? misconceptions.map((m) => `| ${m.id} | ${cell(m.text)} | ${cell(m.source)} | ${cell(m.expose)} | ${cell(m.rebut)} |`)
    : ['| — | — | — | — | — |']),
  '',
  '## 3. 学习目标',
  '',
  '| ID | 目标（可观察） | 类型（过程/概念） | 评估证据 |',
  '|---|---|---|---|',
  ...objectives.map((o) => `| ${o.id} | ${cell(o.text)} | ${o.type} | ${cell(o.evidence)} |`),
  '',
  '## 3.1 核心概念台账',
  '',
  '`concepts.yml` 是核心概念的唯一台账（schema：`workflow/schemas/concepts.schema.json`）。只列“本课结束时学生必须能自己解释”的概念，不列每个知识点。',
  '',
  '| 概念 ID | 术语 | 一句话定义 | 引入页 | 强化页 | 评估页 | 来源 |',
  '|---|---|---|---|---|---|---|',
  ...concepts.map((c) => `| ${c.id} | ${cell(c.term)} | ${cell(c.definition)} | ${c.introducedOn} | ${(c.reinforcedOn || []).join(', ')} | ${(c.assessedOn || []).join(', ')} | ${(c.sourceRefs || []).join(', ')} |`),
  '',
  ...concepts.flatMap((c) => [
    `### ${c.id} ${c.term}`,
    '',
    `- **必现短语**：${(c.mustAppear || []).join('；')}`,
    `- **判定证据**：${c.evidence}`,
    '',
  ]),
  '## 4. 评估证据（先于活动写）',
  '',
  `- 前测预测题：${assessments.preTest}`,
  `- 迁移题：${assessments.transfer}`,
  `- 延迟题：${assessments.delayed}`,
  '',
  '## 5. 内容覆盖映射',
  '',
  'content pack 中每个 `required: true` 的项都必须出现；允许新增，不可删减。',
  '',
  '| content ID | 类型 | 将在哪屏覆盖 | 备注 |',
  '|---|---|---|---|',
  ...coverage.map((row) => `| ${row.contentId} | ${cell(row.kind)} | ${(row.plannedSlides || []).join(', ')} | ${cell(row.notes || '')} |`),
  '',
  '## 6. Non-goals',
  '',
  '**本课不覆盖：**',
  list(nonGoals.notCovered),
  '',
  '**刻意不做：**',
  list(nonGoals.intentionallyNotDone),
  '',
  '## 7. 教学序列草案',
  '',
  brief.sequence,
  '',
  '## 8. 风险与待澄清',
  '',
  '**风险：**',
  list(brief.risks),
  '',
  '**已作出的合理假设：**',
  list(brief.assumptions),
  '',
]
fs.mkdirSync(path.dirname(path.resolve(specPath)), { recursive: true })
fs.writeFileSync(path.resolve(specPath), `${lines.join('\n').trimEnd()}\n`)

const ledger = {
  schemaVersion: '1.0',
  lesson: brief.lesson,
  concepts: concepts.map((concept) => {
    const out = {
      id: concept.id,
      term: concept.term,
      definition: concept.definition,
      introducedOn: concept.introducedOn,
      mustAppear: concept.mustAppear,
      evidence: concept.evidence,
    }
    if (concept.reinforcedOn?.length) out.reinforcedOn = concept.reinforcedOn
    if (concept.assessedOn?.length) out.assessedOn = concept.assessedOn
    if (concept.sourceRefs?.length) out.sourceRefs = concept.sourceRefs
    return out
  }),
}
fs.mkdirSync(path.dirname(path.resolve(conceptsPath)), { recursive: true })
fs.writeFileSync(path.resolve(conceptsPath), YAML.stringify(ledger, { lineWidth: 0 }).trimEnd() + '\n')
console.log(`OK render brief — ${objectives.length} objective(s), ${concepts.length} concept(s) -> ${specPath}, ${conceptsPath}`)
