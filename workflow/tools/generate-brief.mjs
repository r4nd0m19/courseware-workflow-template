#!/usr/bin/env node
// Code-orchestrated teaching brief generation (spec.md + concepts.yml).
//
// The model returns one structured brief. Node validates it, repairs only the
// brief, then renders both human-readable artifacts deterministically.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readData, validateWithSchema } from './lib.mjs'

const toolsDir = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
function die(message) {
  console.error(`FAIL brief generation — ${message}`)
  process.exit(1)
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.writeFileSync(path.resolve(file), `${JSON.stringify(value, null, 2)}\n`)
}
function readText(file) {
  return fs.existsSync(path.resolve(file)) ? fs.readFileSync(path.resolve(file), 'utf8') : ''
}
function runNode(scriptArgs, label) {
  const result = spawnSync(process.execPath, scriptArgs, { cwd: process.cwd(), stdio: 'inherit' })
  if (result.error) die(`${label}: ${result.error.message}`)
  if (result.status !== 0) die(`${label} failed (exit ${result.status})`)
}

const lessonSlug = opt('--lesson-slug')
const lesson = opt('--lesson', lessonSlug)
const contentPath = opt('--content')
const stylePath = opt('--style')
const conceptsPath = opt('--concepts')
const constitutionPath = opt('--constitution', '.specify/memory/constitution.md')
const feature = fs.existsSync('.specify/feature.json') ? readData('.specify/feature.json') : {}
const specPath = opt(
  '--spec',
  feature.feature_directory
    ? path.join(feature.feature_directory, 'spec.md')
    : path.join('specs', lessonSlug, 'spec.md'),
)
const reviewDir = opt('--review-dir', path.join('review', lessonSlug))
const evidencePath = opt('--evidence', path.join(reviewDir, 'brief-input.json'))
const briefPath = opt('--out', path.join(reviewDir, 'brief.json'))
const reportPath = opt('--report', path.join(reviewDir, 'brief-generation.json'))
const singleShotPath = opt('--single-shot', path.join(toolsDir, 'single-shot-generate.mjs'))
const mockDir = opt('--mock-dir')
const maxAttempts = Math.max(1, Number(opt('--max-attempts', '2')) || 2)

if (!lessonSlug || !contentPath || !stylePath || !conceptsPath) {
  console.error(
    'usage: node generate-brief.mjs --lesson-slug <slug> --lesson "<title>" --content <content-pack.json> --style <style-pack.manifest.json> --concepts <concepts.yml> [--spec <spec.md>] [--constitution <file>] [--out <brief.json>] [--mock-dir <dir>] [model options]',
  )
  process.exit(2)
}

const FORWARDED_OPTIONS = new Set([
  '--config', '--zcode-config', '--zcode-provider', '--api', '--base-url', '--model',
  '--api-key-env', '--api-key-file', '--max-tokens', '--timeout-ms', '--max-attempts', '--auth',
])
const modelArgs = []
for (let i = 0; i < args.length; i += 1) {
  if (FORWARDED_OPTIONS.has(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
    modelArgs.push(args[i], args[i + 1])
    i += 1
  }
}

const content = readData(contentPath)
const style = readData(stylePath)
const contentItems = Array.isArray(content.items) ? content.items : []
const contentById = new Map(contentItems.map((item) => [item.id, item]))
const styleVocabulary = (value) =>
  (Array.isArray(value) ? value : Object.entries(value || {}).map(([id, item]) => ({ id, ...(item || {}) })))
    .map((item) => (typeof item === 'string' ? { id: item } : { id: item.id, name: item.name || item.id }))
    .filter((item) => item.id)
const evidence = {
  mode: 'brief',
  lessonSlug,
  lesson,
  content: { path: contentPath, items: contentItems },
  style: {
    path: stylePath,
    components: styleVocabulary(style.components),
    layouts: styleVocabulary(style.layouts),
  },
  constitution: { path: constitutionPath, text: readText(constitutionPath) },
  template: { path: 'workflow/preset/templates/spec-template.md', text: readText('workflow/preset/templates/spec-template.md') },
  existing: { spec: readText(specPath), concepts: readText(conceptsPath) },
  outputs: { spec: specPath, concepts: conceptsPath },
  rules: [
    '教学设计先于页面实现；不要写页面正文、组件代码或 CSS。',
    '每个 required 内容项必须在 coverage 中出现；允许新增，不可删减。',
    '概念只收学生必须能自己解释的核心概念；mustAppear 是屏幕上可见的完整短语。',
    '每个概念必须有 introducedOn、definition、mustAppear、evidence、sourceRefs。',
    '每个误区必须有来源、暴露方式和反驳方式。',
    '每个目标必须有可观察的评估证据。',
    '不要依赖老师口头补充；面向无老师在旁的自学场景。',
    '不要使用 [NEEDS CLARIFICATION]、TODO、TBD、待定或占位。',
  ],
}
writeJson(evidencePath, evidence)

function mockFile(attempt) {
  if (!mockDir) return ''
  const candidates = attempt > 1
    ? [path.join(mockDir, 'brief-repair.json'), path.join(mockDir, 'brief.json')]
    : [path.join(mockDir, 'brief.json')]
  const found = candidates.find((file) => fs.existsSync(path.resolve(file)))
  if (!found) die(`mock response not found: ${candidates.join(', ')}`)
  return found
}
function callModel(attempt) {
  const callArgs = [
    singleShotPath, '--mode', 'brief', '--evidence', evidencePath,
    '--out', briefPath, ...modelArgs,
  ]
  const mock = mockFile(attempt)
  if (mock) callArgs.push('--mock-response', mock)
  runNode(callArgs, `brief attempt ${attempt}`)
  return readData(briefPath)
}

function allStrings(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const item of value) allStrings(item, out)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) allStrings(item, out)
  return out
}
function validateBrief(brief) {
  const errors = []
  const schema = validateWithSchema(
    fileURLToPath(new URL('../schemas/brief.schema.json', import.meta.url)),
    brief,
  )
  for (const error of schema.errors) errors.push(`brief ${error}`)
  if (schema.errors.length) return errors
  if (brief.lesson !== lessonSlug) errors.push(`brief.lesson ${JSON.stringify(brief.lesson)} != ${JSON.stringify(lessonSlug)}`)
  if (/[\r\n]/.test(brief.title)) errors.push('brief.title must be one line')
  for (const text of allStrings(brief)) {
    if (/(\[NEEDS CLARIFICATION\]|\bTODO\b|\bTBD\b|待定|占位)/i.test(text)) {
      errors.push(`brief contains a placeholder: ${text.slice(0, 120)}`)
      break
    }
  }

  const objectiveIds = new Set()
  for (const objective of brief.objectives) {
    if (objectiveIds.has(objective.id)) errors.push(`duplicate objective ${objective.id}`)
    objectiveIds.add(objective.id)
  }
  const misconceptionIds = new Set()
  for (const misconception of brief.misconceptions) {
    if (misconceptionIds.has(misconception.id)) errors.push(`duplicate misconception ${misconception.id}`)
    misconceptionIds.add(misconception.id)
  }

  const conceptIds = new Set()
  for (const concept of brief.concepts) {
    if (conceptIds.has(concept.id)) errors.push(`duplicate concept ${concept.id}`)
    conceptIds.add(concept.id)
    for (const ref of concept.sourceRefs || []) {
      if (!contentById.has(ref)) errors.push(`concept ${concept.id}: unknown sourceRef ${ref}`)
    }
    if (!brief.coverage.some((row) => (row.plannedSlides || []).includes(concept.introducedOn))) {
      errors.push(`concept ${concept.id}: introducedOn ${concept.introducedOn} is not in any coverage plannedSlides`)
    }
  }
  const conceptSchema = validateWithSchema(
    fileURLToPath(new URL('../schemas/concepts.schema.json', import.meta.url)),
    { schemaVersion: '1.0', lesson: lessonSlug, concepts: brief.concepts },
  )
  for (const error of conceptSchema.errors) errors.push(`concepts ${error}`)

  const coverageIds = new Set()
  for (const row of brief.coverage) {
    if (coverageIds.has(row.contentId)) errors.push(`coverage duplicates ${row.contentId}`)
    coverageIds.add(row.contentId)
    const item = contentById.get(row.contentId)
    if (!item) {
      errors.push(`coverage references unknown content item ${row.contentId}`)
      continue
    }
    if (row.kind !== item.kind) errors.push(`coverage ${row.contentId} kind ${row.kind} != ${item.kind}`)
    if (!row.plannedSlides.length) errors.push(`coverage ${row.contentId} has no plannedSlides`)
  }
  for (const item of contentItems.filter((entry) => entry.required)) {
    if (!coverageIds.has(item.id)) errors.push(`required content item ${item.id} has no coverage row`)
  }
  return errors
}

if (!mockDir) runNode([singleShotPath, '--check-config', ...modelArgs], 'single-shot config')

let brief = null
let errors = []
let attempts = 0
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  attempts = attempt
  if (attempt > 1) {
    evidence.repair = { errors, previous: brief }
    writeJson(evidencePath, evidence)
  }
  brief = callModel(attempt)
  errors = validateBrief(brief)
  if (!errors.length) break
  console.error(`brief attempt ${attempt} failed:\n${errors.map((error) => `  - ${error}`).join('\n')}`)
}
if (errors.length) die(`brief is still invalid after ${attempts} attempt(s):\n${errors.map((error) => `  - ${error}`).join('\n')}`)

runNode([
  path.join(toolsDir, 'render-brief.mjs'),
  '--brief', briefPath,
  '--spec', specPath,
  '--concepts', conceptsPath,
  '--input', evidencePath,
], 'render brief')
writeJson(reportPath, {
  schemaVersion: '1.0',
  lessonSlug,
  attempts,
  outputs: { spec: specPath, concepts: conceptsPath, brief: briefPath },
})
console.log(`OK brief generation — ${brief.objectives.length} objective(s), ${brief.concepts.length} concept(s), ${brief.coverage.length} coverage row(s)`)
