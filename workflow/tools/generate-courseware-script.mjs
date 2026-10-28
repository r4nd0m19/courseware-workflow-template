#!/usr/bin/env node
// Code-orchestrated courseware script generation.
//
// The model never writes courseware.md. It returns one outline JSON and one
// page JSON per call. This tool owns the loop, schema validation, page repair,
// deterministic content checks and the final renderer hand-off.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readData, validateWithSchema } from './lib.mjs'
import { normalizeForMatch, hasPlaceholder } from './script-lib.mjs'

const toolsDir = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)

function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
function die(message, code = 1) {
  console.error(`FAIL script generation — ${message}`)
  process.exit(code)
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.writeFileSync(path.resolve(file), `${JSON.stringify(value, null, 2)}\n`)
}
function readIfExists(file) {
  return fs.existsSync(path.resolve(file)) ? readData(file) : null
}
function runNode(scriptArgs, label) {
  const result = spawnSync(process.execPath, scriptArgs, {
    cwd: process.cwd(),
    stdio: 'inherit',
  })
  if (result.error) die(`${label}: ${result.error.message}`)
  if (result.status !== 0) die(`${label} failed (exit ${result.status})`)
}

const inputPath = opt('--input')
if (!inputPath) {
  console.error(
    'usage: node generate-courseware-script.mjs --input <script-input.json> [--out <courseware.md>] [--sections <review-sections.yml>] [--outline <outline.json>] [--pages-dir <dir>] [--report <report.json>] [--max-outline-attempts 2] [--max-page-attempts 3] [--mock-dir <dir>] [model options]',
  )
  process.exit(2)
}
const input = readData(inputPath)
const lessonSlug = input.lessonSlug || ''
const lesson = input.lesson || lessonSlug
if (!lessonSlug) die(`${inputPath} has no lessonSlug`)

const outPath = opt('--out', input.outputs?.courseware)
const sectionsPath = opt('--sections', input.outputs?.reviewSections)
const workDir = opt('--work-dir', path.join('review', lessonSlug))
const outlinePath = opt('--outline', path.join(workDir, 'script-outline.json'))
const pagesDir = opt('--pages-dir', path.join(workDir, 'script-pages'))
const reportPath = opt('--report', path.join(workDir, 'script-generation.json'))
const singleShotPath = opt('--single-shot', path.join(toolsDir, 'single-shot-generate.mjs'))
const mockDir = opt('--mock-dir')
const maxOutlineAttempts = Math.max(1, Number(opt('--max-outline-attempts', '2')) || 2)
const maxPageAttempts = Math.max(1, Number(opt('--max-page-attempts', '3')) || 3)
const maxPages = Math.max(1, Number(opt('--max-pages', '30')) || 30)

if (!outPath || !sectionsPath) {
  die('input.outputs.courseware and input.outputs.reviewSections are required (or pass --out/--sections)')
}

// Forward only model/endpoint options. Credentials stay in the child process;
// this tool never prints them.
const FORWARDED_OPTIONS = new Set([
  '--config',
  '--zcode-config',
  '--zcode-provider',
  '--api',
  '--base-url',
  '--model',
  '--api-key-env',
  '--api-key-file',
  '--max-tokens',
  '--timeout-ms',
  '--max-attempts',
  '--auth',
])
const modelArgs = []
for (let i = 0; i < args.length; i += 1) {
  if (FORWARDED_OPTIONS.has(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
    modelArgs.push(args[i], args[i + 1])
    i += 1
  }
}

const contentItems = Array.isArray(input.content?.items) ? input.content.items : []
const contentById = new Map(contentItems.map((item) => [item.id, item]))
const concepts = Array.isArray(input.concepts?.concepts) ? input.concepts.concepts : []
const conceptById = new Map(concepts.map((concept) => [concept.id, concept]))
const styleComponentInfo = new Map(
  (input.style?.components || [])
    .map((component) =>
      typeof component === 'string'
        ? [component, { id: component, kind: '' }]
        : [component?.id, component],
    )
    .filter(([id]) => Boolean(id)),
)
const registryComponents = new Set(
  (input.registry?.components || [])
    .map((component) => (typeof component === 'string' ? component : component?.id))
    .filter(Boolean),
)
// A generated style-pack entry is only design vocabulary; its implementation
// must come from the core registry. A bare/reference style entry is usable.
const generatedStyleComponents = new Set(
  [...styleComponentInfo.values()]
    .filter((component) => component?.kind === 'generated')
    .map((component) => component.id),
)
const knownComponents = new Set([
  ...registryComponents,
  ...[...styleComponentInfo.keys()].filter((id) => !generatedStyleComponents.has(id)),
])
const knownLayouts = new Set(
  (input.style?.layouts || [])
    .map((layout) => (typeof layout === 'string' ? layout : layout?.id))
    .filter(Boolean),
)
const objectiveIds = new Set()
const misconceptionIds = new Set()
const PRODUCTION_TITLE_RE = /^(封面|标题|本页|第\s*\d+\s*页|S\d+[A-Z]?)\s*[：:·\-—\s]/

function summaryPage(page) {
  if (!page) return null
  return {
    id: page.id,
    title: page.title,
    purpose: page.purpose,
    objectiveId: page.objectiveId,
    transitionHint: page.transitionHint || undefined,
  }
}

function referencedItems(page) {
  return (page.contentRefs || []).map((id) => contentById.get(id)).filter(Boolean)
}

function relevantConcepts(page) {
  return concepts.filter((concept) =>
    concept.introducedOn === page.id ||
    (concept.reinforcedOn || []).includes(page.id) ||
    (concept.assessedOn || []).includes(page.id),
  )
}

function mockFile(kind, id, attempt) {
  if (!mockDir) return ''
  const candidates = []
  if (kind === 'outline') {
    if (attempt > 1) candidates.push(path.join(mockDir, 'outline-repair.json'))
    candidates.push(path.join(mockDir, 'outline.json'))
  } else {
    if (attempt > 1) candidates.push(path.join(mockDir, `page-${id}-repair.json`))
    candidates.push(path.join(mockDir, `page-${id}.json`))
  }
  const found = candidates.find((file) => fs.existsSync(path.resolve(file)))
  if (!found) die(`mock response not found for ${kind} ${id} attempt ${attempt}: ${candidates.join(', ')}`)
  return found
}

function callModel(mode, evidence, output, kind, id, attempt) {
  const evidencePath = path.join(
    workDir,
    kind === 'outline'
      ? `script-outline-evidence${attempt > 1 ? `-attempt${attempt}` : ''}.json`
      : `script-page-${id}-evidence${attempt > 1 ? `-attempt${attempt}` : ''}.json`,
  )
  writeJson(evidencePath, evidence)
  const callArgs = [singleShotPath, '--mode', mode, '--evidence', evidencePath, '--out', output, ...modelArgs]
  const mock = mockFile(kind, id, attempt)
  if (mock) callArgs.push('--mock-response', mock)
  runNode(callArgs, `${mode} ${id} attempt ${attempt}`)
  if (!fs.existsSync(path.resolve(output))) die(`${mode} produced no output: ${output}`)
  return readData(output)
}

function validateOutline(outline) {
  const errors = []
  const result = validateWithSchema(
    fileURLToPath(new URL('../schemas/script-outline.schema.json', import.meta.url)),
    outline,
  )
  for (const error of result.errors) errors.push(`outline ${error}`)
  if (result.errors.length) return errors

  if (outline.lesson !== lessonSlug) {
    errors.push(`outline.lesson ${JSON.stringify(outline.lesson)} != ${JSON.stringify(lessonSlug)}`)
  }
  if (/[\r\n]/.test(outline.title)) errors.push('outline.title must be a single line')
  if (PRODUCTION_TITLE_RE.test(outline.title.trim())) {
    errors.push(`outline.title ${JSON.stringify(outline.title)} starts with a production label`)
  }
  objectiveIds.clear()
  for (const objective of outline.overview.objectives) {
    if (objectiveIds.has(objective.id)) errors.push(`duplicate objective id ${objective.id}`)
    objectiveIds.add(objective.id)
  }
  misconceptionIds.clear()
  for (const misconception of outline.overview.misconceptions) {
    if (misconceptionIds.has(misconception.id)) errors.push(`duplicate misconception id ${misconception.id}`)
    misconceptionIds.add(misconception.id)
  }

  if (!outline.pages.length) errors.push('outline.pages is empty')
  if (outline.pages.length > maxPages) errors.push(`outline has ${outline.pages.length} pages; maximum is ${maxPages}`)
  const pageIds = new Set()
  const pagesById = new Map()
  for (const [index, page] of outline.pages.entries()) {
    const where = `page ${page.id || `#${index + 1}`}`
    if (pageIds.has(page.id)) errors.push(`${where}: duplicate page id`)
    pageIds.add(page.id)
    pagesById.set(page.id, page)
    if (!objectiveIds.has(page.objectiveId)) {
      errors.push(`${where}: objectiveId ${page.objectiveId} is not in overview.objectives`)
    }
    if (/[\r\n]/.test(page.title)) errors.push(`${where}: title must be a single line`)
    if (PRODUCTION_TITLE_RE.test(page.title.trim())) {
      errors.push(`${where}: title ${JSON.stringify(page.title)} starts with a production label`)
    }
    if (!String(page.purpose || '').trim()) errors.push(`${where}: purpose is empty`)
    if (!page.contentRefs?.length) errors.push(`${where}: contentRefs is empty`)
    for (const ref of page.contentRefs || []) {
      if (!contentById.has(ref)) errors.push(`${where}: unknown contentRef ${ref}`)
    }
    if (!knownLayouts.has(page.layout)) {
      errors.push(`${where}: layout ${JSON.stringify(page.layout)} is not in the style pack`)
    }
    const planById = new Map()
    for (const plan of page.componentPlan || []) {
      if (planById.has(plan.id)) errors.push(`${where}: duplicate componentPlan ${plan.id}`)
      planById.set(plan.id, plan)
      if (!(page.components || []).includes(plan.id)) {
        errors.push(`${where}: componentPlan ${plan.id} is not used by this page`)
      }
      if (plan.status === 'existing' || plan.status === 'reference-verbatim') {
        if (!knownComponents.has(plan.id)) {
          errors.push(`${where}: componentPlan ${plan.id} is ${plan.status} but is not in the style pack or registry`)
        }
      } else if (!String(plan.brief || '').trim()) {
        errors.push(`${where}: componentPlan ${plan.id} is ${plan.status} and needs a brief path`)
      }
    }
    for (const component of page.components || []) {
      if (knownComponents.has(component)) continue
      const plan = planById.get(component)
      if (!plan || !['new', 'extend'].includes(plan.status)) {
        errors.push(`${where}: component ${component} is not registered and has no new/extend componentPlan`)
      }
    }
    if (!page.interaction?.component && page.interaction?.level !== 'watch') {
      errors.push(`${where}: non-watch interaction needs interaction.component`)
    }
    if (page.interaction?.component && !(page.components || []).includes(page.interaction.component)) {
      errors.push(`${where}: interaction.component ${page.interaction.component} is not in components`)
    }
    if (page.interaction?.misconception) {
      const misconceptionId = String(page.interaction.misconception).match(/^M[0-9]+/)?.[0]
      if (!misconceptionId || !misconceptionIds.has(misconceptionId)) {
        errors.push(`${where}: interaction.misconception ${page.interaction.misconception} is not in overview.misconceptions`)
      }
    }
    if (page.continuedFrom) {
      const source = pagesById.get(page.continuedFrom)
      if (!source) errors.push(`${where}: continuedFrom ${page.continuedFrom} does not exist`)
      else if (outline.pages.indexOf(source) >= index) errors.push(`${where}: continuedFrom ${page.continuedFrom} must be an earlier page`)
    }
  }

  const referenced = new Set(outline.pages.flatMap((page) => page.contentRefs || []))
  for (const item of contentItems.filter((entry) => entry.required)) {
    if (!referenced.has(item.id)) errors.push(`required content item ${item.id} is not referenced by any page`)
  }

  for (const concept of concepts) {
    const page = pagesById.get(concept.introducedOn)
    if (!page) {
      errors.push(`concept ${concept.id} introducedOn ${concept.introducedOn} has no page`)
      continue
    }
    if (!(page.concepts || []).includes(concept.id)) {
      errors.push(`concept ${concept.id} is not listed on its introducing page ${page.id}`)
    }
    for (const ref of concept.sourceRefs || []) {
      if (!(page.contentRefs || []).includes(ref)) {
        errors.push(`concept ${concept.id} introducing page ${page.id} does not reference ${ref}`)
      }
    }
  }
  for (const page of outline.pages) {
    for (const conceptId of page.concepts || []) {
      const concept = conceptById.get(conceptId)
      if (!concept) errors.push(`page ${page.id}: unknown concept ${conceptId}`)
      else if (concept.introducedOn !== page.id) {
        errors.push(`page ${page.id}: concept ${conceptId} is introduced on ${concept.introducedOn}, not this page`)
      }
    }
  }
  for (const objective of objectiveIds) {
    if (!outline.pages.some((page) => page.objectiveId === objective && page.interaction?.level !== 'watch')) {
      errors.push(`objective ${objective} has no non-watch page`)
    }
  }
  return errors
}

function normalizedExact(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
}
function present(haystack, needle, exactHaystack) {
  const normalized = normalizeForMatch(needle)
  if (!normalized || haystack.includes(normalized)) return true
  const exact = normalizedExact(needle)
  return Boolean(exact && exactHaystack.includes(exact))
}
function contentErrors(page, satisfied) {
  const errors = []
  const screen = normalizeForMatch(page.screenContent)
  const exactScreen = normalizedExact(page.screenContent)
  const interaction = normalizeForMatch(Object.values(page.interactionDesign || {}).join('\n'))
  const exactInteraction = normalizedExact(Object.values(page.interactionDesign || {}).join('\n'))
  const narration = normalizeForMatch((page.narration || []).join('\n'))
  const exactNarration = normalizedExact((page.narration || []).join('\n'))
  for (const item of referencedItems(page.__outline)) {
    if (satisfied.has(item.id)) continue
    let ok = true
    let detail = ''
    if (item.kind === 'narration') {
      const text = item.narration || item.text
      ok = !text || present(narration, text, exactNarration)
      detail = '旁白'
    } else if (item.kind === 'example') {
      ok = (!item.code || present(screen, item.code, exactScreen)) &&
        (!item.output || present(screen, item.output, exactScreen))
      detail = '屏幕内容'
    } else if (item.kind === 'quiz') {
      ok = (!item.text || present(screen, item.text, exactScreen) || present(interaction, item.text, exactInteraction)) &&
        (item.options || []).every((option) => {
          const text = typeof option === 'string' ? option : option?.text
          return !text || present(screen, text, exactScreen) || present(interaction, text, exactInteraction)
        })
      detail = '屏幕内容/交互设计'
    }
    if (!ok) errors.push(`${item.id} (${item.kind}): required ${detail} is missing from this page`)
    else satisfied.add(item.id)
  }
  return errors
}

function conceptErrors(page) {
  const errors = []
  const screen = normalizeForMatch(page.screenContent)
  for (const concept of concepts.filter((entry) => entry.introducedOn === page.id)) {
    if (!screen.includes(normalizeForMatch(concept.term))) {
      errors.push(`concept ${concept.id}: screenContent is missing term "${concept.term}"`)
    }
    for (const phrase of concept.mustAppear || []) {
      if (!screen.includes(normalizeForMatch(phrase))) {
        errors.push(`concept ${concept.id}: screenContent is missing mustAppear "${phrase}"`)
      }
    }
  }
  return errors
}

function validatePage(page, outlinePage) {
  const errors = []
  const result = validateWithSchema(
    fileURLToPath(new URL('../schemas/script-page.schema.json', import.meta.url)),
    page,
  )
  for (const error of result.errors) errors.push(`page ${error}`)
  if (result.errors.length) return errors

  if (page.id !== outlinePage.id) errors.push(`page.id ${page.id} != outline ${outlinePage.id}`)
  if (normalizeForMatch(page.title) !== normalizeForMatch(outlinePage.title)) {
    errors.push(`page.title "${page.title}" does not match outline "${outlinePage.title}"`)
  }
  if (/[\r\n]/.test(page.title)) errors.push('page.title must be a single line')
  if (PRODUCTION_TITLE_RE.test(page.title.trim())) errors.push(`page.title starts with a production label`)
  if (hasPlaceholder(page.screenContent) || hasPlaceholder(page.narration.join('\n')) || hasPlaceholder(Object.values(page.interactionDesign).join('\n'))) {
    errors.push('page contains TODO/TBD/待定/占位/[NEEDS CLARIFICATION]')
  }
  if (page.interactionDesign.level !== outlinePage.interaction.level) {
    errors.push(`interactionDesign.level ${page.interactionDesign.level} != outline ${outlinePage.interaction.level}`)
  }
  if (page.interactionDesign.learningAction !== outlinePage.interaction.learningAction) {
    errors.push(`interactionDesign.learningAction ${page.interactionDesign.learningAction} != outline ${outlinePage.interaction.learningAction}`)
  }
  if (page.interactionDesign.misconception) {
    const code = String(page.interactionDesign.misconception).match(/^M[0-9]+/)?.[0]
    if (!code || !misconceptionIds.has(code)) {
      errors.push(`interactionDesign.misconception ${page.interactionDesign.misconception} is not in overview.misconceptions`)
    }
    if (outlinePage.interaction.misconception &&
        code !== String(outlinePage.interaction.misconception).match(/^M[0-9]+/)?.[0]) {
      errors.push(`interactionDesign.misconception ${page.interactionDesign.misconception} != outline ${outlinePage.interaction.misconception}`)
    }
  }
  if (outlinePage.interaction.level === 'watch') {
    if (!String(page.interactionDesign.whyStatic || '').trim()) errors.push('watch page needs whyStatic')
  } else {
    if (String(page.interactionDesign.whyStatic || '').trim()) errors.push('non-watch page must not have whyStatic')
    for (const field of ['successFeedback', 'errorFeedback', 'completion', 'reset']) {
      if (!String(page.interactionDesign[field] || '').trim()) errors.push(`non-watch page needs ${field}`)
    }
    const misconception = page.interactionDesign.misconception || outlinePage.interaction.misconception
    const misconceptionCode = misconception ? String(misconception).match(/^M[0-9]+/)?.[0] : ''
    const errorFeedback = String(page.interactionDesign.errorFeedback || '')
    if (misconception && !errorFeedback.includes(misconception) &&
        !(misconceptionCode && errorFeedback.includes(misconceptionCode)) &&
        !errorFeedback.includes('误区')) {
      errors.push(`errorFeedback must name misconception ${misconception}`)
    }
  }
  if (normalizeForMatch(page.screenContent) === normalizeForMatch(page.narration.join('\n'))) {
    errors.push('narration must not be a copy of screenContent')
  }
  let fence = null
  for (const line of String(page.screenContent || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(`{3,}|~{3,})/)
    if (match) {
      if (!fence) fence = match[1][0]
      else if (line.trim().startsWith(fence)) fence = null
      continue
    }
    if (!fence && /^#{1,6}\s+/.test(line)) {
      errors.push(`screenContent must not contain Markdown headings outside code blocks: ${line.trim()}`)
      break
    }
  }
  return errors
}

function buildPageEvidence(page, outline, previous, next, repair) {
  return {
    mode: 'script-page',
    lessonSlug,
    lesson,
    spec: input.spec?.text || '',
    outline: { overview: outline.overview, pages: outline.pages },
    page,
    previous: summaryPage(previous),
    next: summaryPage(next),
    content: referencedItems(page),
    concepts: relevantConcepts(page),
    style: input.style,
    registry: input.registry,
    rules: input.rules || [],
    repair: repair || undefined,
  }
}

function writeGenerated(outline, pages) {
  writeJson(outlinePath, outline)
  for (const page of pages) writeJson(path.join(pagesDir, `${page.id}.json`), page)
  const renderArgs = [
    path.join(toolsDir, 'render-courseware-md.mjs'),
    '--input', inputPath,
    '--outline', outlinePath,
    '--pages-dir', pagesDir,
    '--out', outPath,
  ]
  runNode(renderArgs, 'render courseware.md')
  runNode([
    path.join(toolsDir, 'render-review-sections.mjs'),
    '--outline', outlinePath,
    '--out', sectionsPath,
  ], 'render review-sections.yml')
}

if (!mockDir) {
  runNode([singleShotPath, '--check-config', ...modelArgs], 'single-shot config')
}

const outlineBase = {
  mode: 'script-outline',
  lessonSlug,
  lesson,
  spec: input.spec?.text || '',
  content: contentItems,
  concepts,
  style: input.style,
  registry: input.registry,
  rules: input.rules || [],
  existing: input.existing?.courseware || '',
  limits: { maxPages },
}

let outline = null
let outlineErrors = []
let outlineAttempts = 0
for (let attempt = 1; attempt <= maxOutlineAttempts; attempt += 1) {
  outlineAttempts = attempt
  const evidence = {
    ...outlineBase,
    repair: attempt > 1 ? { errors: outlineErrors, previous: outline } : undefined,
  }
  outline = callModel('script-outline', evidence, outlinePath, 'outline', 'outline', attempt)
  outlineErrors = validateOutline(outline)
  if (!outlineErrors.length) break
  console.error(`outline attempt ${attempt} failed:\n${outlineErrors.map((error) => `  - ${error}`).join('\n')}`)
}
if (outlineErrors.length) {
  die(`outline is still invalid after ${outlineAttempts} attempt(s):\n${outlineErrors.map((error) => `  - ${error}`).join('\n')}`)
}

const pages = []
const pageAttempts = []
const satisfied = new Set()
for (const [index, outlinePage] of outline.pages.entries()) {
  const previous = outline.pages[index - 1] || null
  const next = outline.pages[index + 1] || null
  let page = null
  let errors = []
  let attempts = 0
  for (let attempt = 1; attempt <= maxPageAttempts; attempt += 1) {
    attempts = attempt
    const evidence = buildPageEvidence(
      outlinePage,
      outline,
      previous,
      next,
      attempt > 1 ? { errors, previous: page } : undefined,
    )
    page = callModel('script-page', evidence, path.join(pagesDir, `${outlinePage.id}.json`), 'page', outlinePage.id, attempt)
    errors = validatePage(page, outlinePage)
    if (!errors.length) errors = conceptErrors(page)
    if (!errors.length) {
      // Only commit content coverage after the whole page passes; a failed
      // attempt must not mark earlier items as satisfied.
      const pendingSatisfied = new Set(satisfied)
      errors = contentErrors({ ...page, __outline: outlinePage }, pendingSatisfied)
      if (!errors.length) {
        for (const id of pendingSatisfied) satisfied.add(id)
      }
    }
    if (!errors.length) break
    console.error(`page ${outlinePage.id} attempt ${attempt} failed:\n${errors.map((error) => `  - ${error}`).join('\n')}`)
  }
  if (errors.length) {
    die(`page ${outlinePage.id} is still invalid after ${attempts} attempt(s):\n${errors.map((error) => `  - ${error}`).join('\n')}`)
  }
  pages.push(page)
  pageAttempts.push({ id: outlinePage.id, attempts })
}

const missingRequired = contentItems
  .filter((item) => item.required && !satisfied.has(item.id))
  .map((item) => item.id)
if (missingRequired.length) {
  die(`required content items were not placed verbatim by any page: ${missingRequired.join(', ')}`)
}

writeGenerated(outline, pages)
writeJson(reportPath, {
  schemaVersion: '1.0',
  lessonSlug,
  outline: { attempts: outlineAttempts, pages: outline.pages.length },
  pages: pageAttempts,
  outputs: { courseware: outPath, reviewSections: sectionsPath, outline: outlinePath, pagesDir },
})
console.log(`OK script generation — ${pages.length} page(s), outline attempts ${outlineAttempts}`)
