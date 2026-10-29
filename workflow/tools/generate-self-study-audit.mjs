#!/usr/bin/env node
// Code-orchestrated self-study audit.
//
// The model returns judgments (rubric, screen roles, gaps, supplements). Node
// supplies hashes/counts/page budget, validates the audit with the existing
// check-self-study gate, and builds courseware.self-study.md by inserting
// delimited supplement blocks. It never lets the model rewrite courseware.md.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readData, validateWithSchema } from './lib.mjs'
import { parseScript, normalizeForMatch } from './script-lib.mjs'
import { renderSlideBlock } from './script-render-lib.mjs'

const toolsDir = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
function die(message) {
  console.error(`FAIL self-study audit generation — ${message}`)
  process.exit(1)
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.writeFileSync(path.resolve(file), `${JSON.stringify(value, null, 2)}\n`)
}
function readText(file) {
  return fs.existsSync(path.resolve(file)) ? fs.readFileSync(path.resolve(file), 'utf8') : ''
}
function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}
function runNode(scriptArgs, label, capture = false) {
  const result = spawnSync(process.execPath, scriptArgs, {
    cwd: process.cwd(),
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (result.error) die(`${label}: ${result.error.message}`)
  if (result.status !== 0) {
    if (capture) die(`${label} failed (exit ${result.status})\n${result.stdout || ''}\n${result.stderr || ''}`)
    die(`${label} failed (exit ${result.status})`)
  }
  return result
}

const lessonSlug = opt('--lesson-slug')
const lesson = opt('--lesson', lessonSlug)
const scriptPath = opt('--script')
const contentPath = opt('--content')
const stylePath = opt('--style')
const registryPath = opt('--registry')
const conceptsPath = opt('--concepts')
const feature = fs.existsSync('.specify/feature.json') ? readData('.specify/feature.json') : {}
const specPath = opt(
  '--spec',
  feature.feature_directory
    ? path.join(feature.feature_directory, 'spec.md')
    : path.join('specs', lessonSlug, 'spec.md'),
)
const reviewDir = opt('--review-dir', path.join('review', lessonSlug))
const auditPath = opt('--out', path.join(reviewDir, 'self-study-audit.json'))
const mdPath = opt('--md', path.join(reviewDir, 'self-study-audit.md'))
const rawPath = opt('--raw', path.join(reviewDir, 'self-study-audit-generation.json'))
const reportPath = opt('--report', path.join(reviewDir, 'self-study-generation.json'))
const proposalPath = opt(
  '--proposal',
  scriptPath ? path.join(path.dirname(path.resolve(scriptPath)), 'courseware.self-study.md') : '',
)
const singleShotPath = opt('--single-shot', path.join(toolsDir, 'single-shot-generate.mjs'))
const checkPath = opt('--check', path.join(toolsDir, 'check-self-study.mjs'))
const mockDir = opt('--mock-dir')
const declaredPagesOption = opt('--declared-pages', '').trim()
const maxAttempts = Math.max(1, Number(opt('--max-attempts', '3')) || 3)

if (!lessonSlug || !scriptPath || !contentPath) {
  console.error(
    'usage: node generate-self-study-audit.mjs --lesson-slug <slug> --lesson "<title>" --script <courseware.md> --content <content-pack.json> [--declared-pages <n>] [--spec <spec.md>] [--out <audit.json>] [--md <audit.md>] [--proposal <courseware.self-study.md>] [--mock-dir <dir>] [model options]',
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

const scriptText = readText(scriptPath)
if (!scriptText) die(`script not found: ${scriptPath}`)
const parsed = parseScript(scriptPath)
const content = readData(contentPath)
const contentItems = Array.isArray(content.items) ? content.items : []
const contentById = new Map(contentItems.map((item) => [item.id, item]))
const style = stylePath && fs.existsSync(path.resolve(stylePath)) ? readData(stylePath) : { components: [], layouts: [] }
const registry = registryPath && fs.existsSync(path.resolve(registryPath)) ? readData(registryPath) : { components: [] }
const concepts = conceptsPath && fs.existsSync(path.resolve(conceptsPath)) ? readData(conceptsPath).concepts || [] : []
const conceptById = new Map(concepts.map((concept) => [concept.id, concept]))
const styleInfo = new Map(
  (Array.isArray(style.components) ? style.components : Object.entries(style.components || {}).map(([id, item]) => ({ id, ...(item || {}) })))
    .map((item) => (typeof item === 'string' ? { id: item, kind: '' } : item))
    .filter((item) => item?.id)
    .map((item) => [item.id, item]),
)
const registryComponents = new Set(
  (Array.isArray(registry.components) ? registry.components : Object.entries(registry.components || {}).map(([id, item]) => ({ id, ...(item || {}) })))
    .map((item) => (typeof item === 'string' ? item : item?.id))
    .filter(Boolean),
)
const generatedStyleComponents = new Set([...styleInfo.values()].filter((item) => item.kind === 'generated').map((item) => item.id))
const knownComponents = new Set([...registryComponents, ...[...styleInfo.keys()].filter((id) => !generatedStyleComponents.has(id))])
const knownLayouts = new Set(
  (Array.isArray(style.layouts) ? style.layouts : Object.keys(style.layouts || {}))
    .map((item) => (typeof item === 'string' ? item : item?.id))
    .filter(Boolean),
)
const PRODUCTION_TITLE_RE = /^(封面|标题|本页|第\s*\d+\s*页|S\d+[A-Z]?)\s*[：:·\-—\s]/
const scriptSha = sha256(scriptText)
const slides = parsed.slides
let declaredPages = slides.length
if (declaredPagesOption) {
  const value = Number(declaredPagesOption)
  if (!Number.isInteger(value) || value < 1) {
    die(`--declared-pages must be a positive integer, got ${JSON.stringify(declaredPagesOption)}`)
  }
  declaredPages = value
}
const slideIds = slides.map((slide) => slide.id)
const slideSet = new Set(slideIds)
const objectiveById = new Map()
for (const slide of slides) {
  const machine = slide.machine || {}
  if (machine.objectiveId && !objectiveById.has(machine.objectiveId)) {
    objectiveById.set(machine.objectiveId, machine.objective || machine.objectiveId)
  }
}
const referencedIds = new Set()
for (const slide of slides) for (const ref of slide.machine?.contentRefs || []) referencedIds.add(ref)
const requiredItems = contentItems.filter((item) => item.required)
const unreferenced = requiredItems.map((item) => item.id).filter((id) => !referencedIds.has(id))
const rubricIds = [
  ['objectives', '目标链路'],
  ['prerequisites', '先修唤醒'],
  ['explanation', '讲解完整性'],
  ['worked-examples', '完整例题'],
  ['practice', '独立练习'],
  ['feedback', '反馈'],
  ['misconceptions', '误区处理'],
  ['navigation', '转场与定位'],
  ['accessibility', '无障碍与静态替代'],
  ['self-regulation', '卡住时怎么办'],
]
const evidence = {
  mode: 'self-study-audit',
  lessonSlug,
  lesson,
  script: {
    path: scriptPath,
    sha256: scriptSha,
    slides: slides.length,
    ids: slideIds,
    objectives: [...objectiveById].map(([id, text]) => ({ id, text })),
    content: slides.map((slide) => ({
      id: slide.id,
      title: slide.headingTitle,
      objectiveId: slide.machine?.objectiveId || '',
      screenContent: slide.screenContent,
      interactionDesign: slide.interactionDesign,
      narration: slide.narration,
      transition: slide.transition,
      status: slide.machine?.status || '',
    })),
  },
  spec: { path: specPath, text: readText(specPath) },
  content: {
    path: contentPath,
    requiredItems: requiredItems.length,
    referencedItems: referencedIds.size,
    unreferenced,
    items: contentItems,
  },
  rubric: rubricIds.map(([id, name]) => ({ id, name })),
  style: { path: stylePath, components: [...knownComponents], layouts: [...knownLayouts] },
  registry: { path: registryPath, components: [...registryComponents] },
  concepts: { path: conceptsPath, concepts },
  pageBudget: { declared: declaredPages, current: slides.length },
  rules: [
    '只判断学生能否在无老师陪伴下自学；格式由 check-script 负责。',
    'rubric 必须逐项判断：pass / gap / n/a，并给具体屏号或原文证据。',
    '每张屏恰好评估一次；每个 gap 必须被至少一张屏引用。',
    '每个 blocking gap 必须有补充提案；verdict=insufficient 当且仅当存在 blocking。',
    'pageImpact 必须为 0：结构化版本只做原位补充，不新增页面。',
    'supplement 只写补充正文；Node 会加「自学补充」标签、依据和定界块。',
    '不要修改 courseware.md，不要写页面实现或组件代码。',
  ],
}
writeJson(path.join(reviewDir, 'self-study-evidence.json'), evidence)

function mockFile(attempt) {
  if (!mockDir) return ''
  const candidates = attempt > 1
    ? [path.join(mockDir, 'self-study-repair.json'), path.join(mockDir, 'self-study.json')]
    : [path.join(mockDir, 'self-study.json')]
  const found = candidates.find((file) => fs.existsSync(path.resolve(file)))
  if (!found) die(`mock response not found: ${candidates.join(', ')}`)
  return found
}
function callModel(attempt) {
  const callArgs = [
    singleShotPath, '--mode', 'self-study-audit', '--evidence',
    path.join(reviewDir, 'self-study-evidence.json'), '--out', rawPath, ...modelArgs,
  ]
  const mock = mockFile(attempt)
  if (mock) callArgs.push('--mock-response', mock)
  runNode(callArgs, `self-study audit attempt ${attempt}`)
  return readData(rawPath)
}

function allStrings(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const item of value) allStrings(item, out)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) allStrings(item, out)
  return out
}
function validateJudgments(raw) {
  const errors = []
  const schema = validateWithSchema(
    fileURLToPath(new URL('../schemas/self-study-audit-generation.schema.json', import.meta.url)),
    raw,
  )
  for (const error of schema.errors) errors.push(`generation ${error}`)
  if (schema.errors.length) return errors
  for (const text of allStrings(raw)) {
    if (/(\[NEEDS CLARIFICATION\]|\bTODO\b|\bTBD\b|待定|占位)/i.test(text)) {
      errors.push(`audit contains a placeholder: ${text.slice(0, 120)}`)
      break
    }
  }
  const rubricSeen = new Set()
  for (const item of raw.rubric) {
    if (rubricSeen.has(item.id)) errors.push(`rubric ${item.id} appears more than once`)
    rubricSeen.add(item.id)
  }
  for (const [id] of rubricIds) if (!rubricSeen.has(id)) errors.push(`rubric ${id} is missing`)

  const objectiveSeen = new Set()
  for (const objective of raw.objectives) {
    if (objectiveSeen.has(objective.id)) errors.push(`objective ${objective.id} appears more than once`)
    objectiveSeen.add(objective.id)
    if (!objectiveById.has(objective.id)) errors.push(`objective ${objective.id} is not in the script`)
    for (const id of objective.slides || []) if (!slideSet.has(id)) errors.push(`objective ${objective.id}: unknown slide ${id}`)
  }
  for (const id of objectiveById.keys()) if (!objectiveSeen.has(id)) errors.push(`objective ${id} has no audit row`)

  const screenSeen = new Set()
  for (const screen of raw.screens) {
    if (screenSeen.has(screen.id)) errors.push(`screen ${screen.id} appears more than once`)
    screenSeen.add(screen.id)
    if (!slideSet.has(screen.id)) errors.push(`screen ${screen.id} is not in the script`)
    for (const id of screen.objectiveIds || []) if (!objectiveById.has(id)) errors.push(`screen ${screen.id}: unknown objective ${id}`)
  }
  for (const id of slideIds) if (!screenSeen.has(id)) errors.push(`slide ${id} has no screen assessment`)

  const gapIds = new Set()
  const gapsByDimension = new Map()
  for (const gap of raw.gaps) {
    if (gapIds.has(gap.id)) errors.push(`duplicate gap ${gap.id}`)
    gapIds.add(gap.id)
    gapsByDimension.set(gap.dimension, (gapsByDimension.get(gap.dimension) || 0) + 1)
    if (!gap.slideIds.length) errors.push(`${gap.id}: slideIds is empty`)
    for (const id of gap.slideIds) if (!slideSet.has(id)) errors.push(`${gap.id}: unknown slide ${id}`)
    for (const id of gap.objectiveIds || []) if (!objectiveById.has(id)) errors.push(`${gap.id}: unknown objective ${id}`)
  }
  for (const item of raw.rubric) {
    if (item.verdict === 'gap' && !gapsByDimension.get(item.id)) errors.push(`rubric ${item.id} is gap but no gap references it`)
    if (item.verdict === 'pass' && gapsByDimension.get(item.id)) errors.push(`rubric ${item.id} is pass but gaps reference it`)
  }
  for (const screen of raw.screens) {
    for (const id of screen.gapIds || []) {
      if (!gapIds.has(id)) errors.push(`screen ${screen.id}: unknown gap ${id}`)
      const gap = raw.gaps.find((item) => item.id === id)
      if (gap && !gap.slideIds.includes(screen.id)) errors.push(`screen ${screen.id} cites ${id}, but that gap does not list it`)
    }
    if (screen.status === 'gap' && !(screen.gapIds || []).length) errors.push(`screen ${screen.id} is gap but cites no gap`)
  }
  for (const gap of raw.gaps) {
    if (!raw.screens.some((screen) => (screen.gapIds || []).includes(gap.id))) errors.push(`gap ${gap.id} is not cited by any screen`)
  }

  const blocking = raw.gaps.filter((gap) => gap.severity === 'blocking')
  if (raw.verdict === 'sufficient' && blocking.length) errors.push('verdict sufficient but blocking gaps exist')
  if (raw.verdict === 'insufficient' && !blocking.length) errors.push('verdict insufficient but no blocking gap')

  const rawNewIds = new Set((raw.newSlides || []).map((slide) => slide.id))
  const supplementIds = new Set()
  for (const supplement of raw.supplements) {
    if (supplementIds.has(supplement.id)) errors.push(`duplicate supplement ${supplement.id}`)
    supplementIds.add(supplement.id)
    if (!gapIds.has(supplement.gapId)) errors.push(`supplement ${supplement.id}: unknown gap ${supplement.gapId}`)
    for (const id of supplement.targetSlides || []) if (!slideSet.has(id) && !rawNewIds.has(id)) errors.push(`supplement ${supplement.id}: unknown slide ${id}`)
  }
  for (const gap of blocking) {
    if (!raw.supplements.some((supplement) => supplement.gapId === gap.id)) {
      errors.push(`blocking gap ${gap.id} has no supplement`)
    }
  }

  const newIds = new Set()
  const newByGap = new Map()
  for (const slide of raw.newSlides) {
    const where = `new slide ${slide.id}`
    if (slideSet.has(slide.id)) errors.push(`${where}: id already exists in the script`)
    if (newIds.has(slide.id)) errors.push(`${where}: duplicate new slide id`)
    newIds.add(slide.id)
    newByGap.set(slide.gapId, (newByGap.get(slide.gapId) || 0) + 1)
    if (!gapIds.has(slide.gapId)) errors.push(`${where}: unknown gap ${slide.gapId}`)
    if (!objectiveById.has(slide.objectiveId)) errors.push(`${where}: unknown objective ${slide.objectiveId}`)
    for (const ref of slide.contentRefs || []) {
      if (!contentById.has(ref)) errors.push(`${where}: unknown contentRef ${ref}`)
    }
    if (!knownLayouts.has(slide.layout)) errors.push(`${where}: layout ${JSON.stringify(slide.layout)} is not in the style pack`)
    const planById = new Map((slide.componentPlan || []).map((plan) => [plan.id, plan]))
    for (const component of slide.components || []) {
      if (knownComponents.has(component)) continue
      const plan = planById.get(component)
      if (!plan || !['new', 'extend'].includes(plan.status)) {
        errors.push(`${where}: component ${component} is not registered and has no new/extend componentPlan`)
      } else if (!plan.brief) {
        errors.push(`${where}: componentPlan ${component} needs a brief path`)
      }
    }
    if (slide.interaction.level !== 'watch' && !slide.interaction.component) {
      errors.push(`${where}: non-watch interaction needs interaction.component`)
    }
    if (slide.interaction.component && !(slide.components || []).includes(slide.interaction.component)) {
      errors.push(`${where}: interaction.component ${slide.interaction.component} is not in components`)
    }
    for (const conceptId of slide.concepts || []) {
      const concept = conceptById.get(conceptId)
      if (!concept) {
        errors.push(`${where}: unknown concept ${conceptId}`)
        continue
      }
      const screen = normalizeForMatch(slide.screenContent)
      if (!screen.includes(normalizeForMatch(concept.term))) {
        errors.push(`${where}: screenContent is missing concept term ${concept.term}`)
      }
      for (const phrase of concept.mustAppear || []) {
        if (!screen.includes(normalizeForMatch(phrase))) {
          errors.push(`${where}: screenContent is missing mustAppear ${phrase}`)
        }
      }
    }
    const body = {
      id: slide.id,
      title: slide.title,
      screenContent: slide.screenContent,
      interactionDesign: slide.interactionDesign,
      narration: slide.narration,
      transition: slide.transition,
    }
    const bodySchema = validateWithSchema(
      fileURLToPath(new URL('../schemas/script-page.schema.json', import.meta.url)),
      body,
    )
    for (const error of bodySchema.errors) errors.push(`${where} ${error}`)
    if (bodySchema.errors.length) continue
    if (slide.interactionDesign.level !== slide.interaction.level) {
      errors.push(`${where}: interactionDesign.level ${slide.interactionDesign.level} != interaction.level ${slide.interaction.level}`)
    }
    if (slide.interactionDesign.learningAction !== slide.interaction.learningAction) {
      errors.push(`${where}: interactionDesign.learningAction ${slide.interactionDesign.learningAction} != interaction.learningAction ${slide.interaction.learningAction}`)
    }
    if (/[\r\n]/.test(slide.title)) errors.push(`${where}: title must be one line`)
    if (PRODUCTION_TITLE_RE.test(slide.title.trim())) errors.push(`${where}: title starts with a production label`)
    let fence = null
    for (const line of String(slide.screenContent).split(/\r?\n/)) {
      const match = line.match(/^\s*(`{3,}|~{3,})/)
      if (match) {
        if (!fence) fence = match[1][0]
        else if (line.trim().startsWith(fence)) fence = null
        continue
      }
      if (!fence && /^#{1,6}\s+/.test(line)) {
        errors.push(`${where}: screenContent must not contain Markdown headings outside code blocks`)
        break
      }
    }
    if (slide.interaction.level !== 'watch') {
      const misconception = slide.interactionDesign.misconception || slide.interaction.misconception
      const code = misconception ? String(misconception).match(/^M[0-9]+/)?.[0] : ''
      const feedback = String(slide.interactionDesign.errorFeedback || '')
      if (misconception && !feedback.includes(misconception) && !(code && feedback.includes(code)) && !feedback.includes('误区')) {
        errors.push(`${where}: errorFeedback must name misconception ${misconception}`)
      }
    }
  }
  for (const slide of raw.newSlides) {
    if (slide.afterSlide === slide.id) errors.push(`new slide ${slide.id}: afterSlide cannot point to itself`)
    if (!slideSet.has(slide.afterSlide) && !newIds.has(slide.afterSlide)) {
      errors.push(`new slide ${slide.id}: afterSlide ${slide.afterSlide} does not exist`)
    }
  }
  for (const gap of raw.gaps) {
    const count = newByGap.get(gap.id) || 0
    if (gap.pageImpact !== count) {
      errors.push(`gap ${gap.id}: pageImpact ${gap.pageImpact} != ${count} new slide(s)`)
    }
  }
  if (unreferenced.length) errors.push(`required content item(s) are not referenced by the script: ${unreferenced.join(', ')}`)
  return errors
}

function buildAudit(raw) {
  const proposed = slides.length + raw.newSlides.length
  return {
    schemaVersion: '1.0',
    lesson: lessonSlug,
    auditVersion: '1.0',
    mode: 'self-study',
    script: { path: scriptPath, sha256: scriptSha, slides: slides.length },
    contentPack: {
      path: contentPath,
      requiredItems: requiredItems.length,
      referencedItems: referencedIds.size,
      unreferenced,
    },
    rubric: raw.rubric.map((item) => ({
      id: item.id,
      name: rubricIds.find(([id]) => id === item.id)?.[1] || item.id,
      verdict: item.verdict,
      evidence: item.evidence,
      ...(item.notes ? { notes: item.notes } : {}),
    })),
    objectives: raw.objectives.map((objective) => ({
      id: objective.id,
      text: objectiveById.get(objective.id) || objective.id,
      explanation: objective.explanation,
      workedExample: objective.workedExample,
      practice: objective.practice,
      feedback: objective.feedback,
      slides: objective.slides,
    })),
    screens: raw.screens,
    gaps: raw.gaps,
    pageAdditions: raw.newSlides.map((slide) => ({
      id: slide.id,
      afterSlide: slide.afterSlide,
      gapId: slide.gapId,
    })),
    pageBudget: {
      declared: declaredPages,
      current: slides.length,
      proposed,
      exceedsDeclaredBudget: proposed > declaredPages,
      decision: proposed > declaredPages ? 'teacher-approval-required' : 'within-budget',
    },
    supplements: raw.supplements.map((supplement) => ({
      id: supplement.id,
      gapId: supplement.gapId,
      type: supplement.type,
      targetSlides: supplement.targetSlides,
      label: '自学补充',
      basis: supplement.basis,
      summary: supplement.summary,
    })),
    verdict: raw.verdict,
    reviewedAt: new Date().toISOString(),
  }
}

function assembleProposal(script, newSlides) {
  if (!newSlides.length) return script
  const lines = script.split(/\r?\n/)
  const starts = []
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^##\s+(S[0-9]+[A-Z]?)\s*·/)
    if (match) starts.push({ id: match[1], index: i })
  }
  if (!starts.length) die('cannot add pages: script has no slide headings')
  const prefix = lines.slice(0, starts[0].index).join('\n').trimEnd()
  const blocks = starts.map((start, index) => ({
    id: start.id,
    text: lines.slice(start.index, index + 1 < starts.length ? starts[index + 1].index : lines.length).join('\n').trimEnd(),
  }))
  const order = blocks.map((block) => block.id)
  const pending = [...newSlides]
  while (pending.length) {
    const index = pending.findIndex((slide) => order.includes(slide.afterSlide))
    if (index < 0) die(`cannot place new slides; unresolved afterSlide: ${pending.map((slide) => slide.id).join(', ')}`)
    const [slide] = pending.splice(index, 1)
    const target = order.indexOf(slide.afterSlide)
    const outlinePage = {
      id: slide.id,
      title: slide.title,
      objectiveId: slide.objectiveId,
      objective: slide.objective,
      contentRefs: slide.contentRefs,
      purpose: slide.purpose,
      components: slide.components,
      layout: slide.layout,
      interaction: slide.interaction,
      ...(slide.componentPlan?.length ? { componentPlan: slide.componentPlan } : {}),
      ...(slide.continuedFrom ? { continuedFrom: slide.continuedFrom } : {}),
      ...(slide.continued ? { continued: true } : {}),
    }
    const page = {
      id: slide.id,
      title: slide.title,
      screenContent: slide.screenContent,
      interactionDesign: slide.interactionDesign,
      narration: slide.narration,
      transition: slide.transition,
    }
    blocks.splice(target + 1, 0, { id: slide.id, text: renderSlideBlock(outlinePage, page).trimEnd() })
    order.splice(target + 1, 0, slide.id)
  }
  return `${prefix}\n\n${blocks.map((block) => block.text).join('\n\n')}\n`
}

function proposalBlock(supplement) {
  const content = String(supplement.content).trim().split(/\r?\n/).map((line) => `> ${line}`).join('\n')
  return [
    `<!-- self-study-supplement:${supplement.id} -->`,
    `> **自学补充（依据：${supplement.basis}）**：`,
    content,
    `<!-- /self-study-supplement:${supplement.id} -->`,
  ]
}
function insertProposal(script, supplements) {
  const lines = script.split(/\r?\n/)
  const slideStarts = []
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^##\s+(S[0-9]+[A-Z]?)\s*·/)
    if (match) slideStarts.push({ id: match[1], index: i })
  }
  const byId = new Map()
  for (let i = 0; i < slideStarts.length; i += 1) {
    byId.set(slideStarts[i].id, {
      start: slideStarts[i].index,
      end: i + 1 < slideStarts.length ? slideStarts[i + 1].index : lines.length,
    })
  }
  const sectionHeadings = {
    'screen-content': ['### 屏幕内容'],
    'interaction-design': ['### 交互设计'],
    narration: ['### 旁白 / 语音', '### 旁白', '### 语音'],
    transition: ['### 转场'],
  }
  const insertions = []
  for (const supplement of supplements) {
    const target = supplement.targetSlides[0]
    const range = byId.get(target)
    if (!range) die(`supplement ${supplement.id}: target slide ${target} not found`)
    let index = range.end
    if (supplement.placement !== 'after-slide') {
      const headings = sectionHeadings[supplement.placement]
      if (!headings) die(`supplement ${supplement.id}: unsupported placement ${supplement.placement}`)
      let sectionStart = -1
      for (let i = range.start + 1; i < range.end; i += 1) {
        if (headings.includes(lines[i].trim())) {
          sectionStart = i
          break
        }
      }
      if (sectionStart < 0) die(`supplement ${supplement.id}: ${headings.join(' / ')} not found on ${target}`)
      index = range.end
      for (let i = sectionStart + 1; i < range.end; i += 1) {
        if (/^###\s+/.test(lines[i]) || /^##\s+/.test(lines[i])) {
          index = i
          break
        }
      }
      while (index > sectionStart + 1 && lines[index - 1].trim() === '') index -= 1
    }
    insertions.push({ index, order: insertions.length, lines: proposalBlock(supplement) })
  }
  for (const insertion of insertions.sort((a, b) => b.index - a.index || b.order - a.order)) {
    lines.splice(insertion.index, 0, ...insertion.lines)
  }
  return `${lines.join('\n').trimEnd()}\n`
}

if (!mockDir) runNode([singleShotPath, '--check-config', ...modelArgs], 'single-shot config')

let raw = null
let errors = []
let attempts = 0
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  attempts = attempt
  if (attempt > 1) {
    evidence.repair = { errors, previous: raw }
    writeJson(path.join(reviewDir, 'self-study-evidence.json'), evidence)
  }
  raw = callModel(attempt)
  errors = validateJudgments(raw)
  if (errors.length) {
    console.error(`self-study audit attempt ${attempt} failed:\n${errors.map((error) => `  - ${error}`).join('\n')}`)
    continue
  }
  const audit = buildAudit(raw)
  writeJson(auditPath, audit)
  if (raw.supplements.length || raw.newSlides.length) {
    if (!proposalPath) die('page additions/supplements exist but no --proposal path')
    fs.mkdirSync(path.dirname(path.resolve(proposalPath)), { recursive: true })
    const withPages = assembleProposal(scriptText, raw.newSlides)
    fs.writeFileSync(path.resolve(proposalPath), insertProposal(withPages, raw.supplements))
  }
  const check = spawnSync(process.execPath, [
    checkPath, auditPath, '--script', scriptPath, '--proposal', proposalPath || '',
  ], { encoding: 'utf8' })
  if (check.status === 0) {
    errors = []
    break
  }
  errors = `${check.stdout || ''}\n${check.stderr || ''}`.trim().split(/\r?\n/).filter(Boolean)
  console.error(`self-study audit check attempt ${attempt} failed:\n${errors.map((error) => `  - ${error}`).join('\n')}`)
}
if (errors.length) die(`self-study audit is still invalid after ${attempts} attempt(s):\n${errors.map((error) => `  - ${error}`).join('\n')}`)

runNode([
  path.join(toolsDir, 'render-self-study-audit-md.mjs'),
  '--audit', auditPath,
  '--out', mdPath,
], 'render self-study audit')
writeJson(reportPath, {
  schemaVersion: '1.0',
  lessonSlug,
  attempts,
  audit: auditPath,
  proposal: raw.supplements.length || raw.newSlides.length ? proposalPath : '',
  md: mdPath,
})
console.log(`OK self-study generation — ${raw.gaps.length} gap(s), ${raw.supplements.length} supplement(s), verdict ${raw.verdict}`)
