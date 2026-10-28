#!/usr/bin/env node
// Code-orchestrated component plan: structured reuse search + gaps + briefs.
//
// The model writes the plan JSON and brief Markdown. Node validates paths and
// declarations, renders component-plan.md, writes the briefs, then runs the
// existing check-component-plan gate. Failures are fed back for a bounded retry.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readData, validateWithSchema } from './lib.mjs'
import { parseScript, parseMarkdownSections, canonicalHeading, hasPlaceholder } from './script-lib.mjs'
import { loadRegistryPackages } from './registry-lib.mjs'
import { assertScriptApproved, DEFAULT_SCRIPT_APPROVAL } from './approval-lib.mjs'

const toolsDir = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
function die(message) {
  console.error(`FAIL component plan generation — ${message}`)
  process.exit(1)
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.writeFileSync(path.resolve(file), `${JSON.stringify(value, null, 2)}\n`)
}
function readText(file) {
  return fs.existsSync(path.resolve(file)) ? fs.readFileSync(path.resolve(file), 'utf8') : ''
}
const lessonSlug = opt('--lesson-slug')
const lesson = opt('--lesson', lessonSlug)
const scriptPath = opt('--script')
const stylePath = opt('--style')
const registryPath = opt('--registry', 'registry/index.json')
const approvalPath = opt('--approval', DEFAULT_SCRIPT_APPROVAL)
const scriptDir = scriptPath ? path.dirname(path.resolve(scriptPath)) : ''
const planPath = opt('--plan', path.join(scriptDir, 'component-plan.md'))
const briefsDir = opt('--briefs', path.join(scriptDir, 'component-briefs'))
const reviewDir = opt('--review-dir', path.join('review', lessonSlug))
const evidencePath = opt('--evidence', path.join(reviewDir, 'component-plan-input.json'))
const rawPath = opt('--raw', path.join(reviewDir, 'component-plan-generation.json'))
const reportPath = opt('--report', path.join(reviewDir, 'component-plan-generation-report.json'))
const singleShotPath = opt('--single-shot', path.join(toolsDir, 'single-shot-generate.mjs'))
const checkPath = opt('--check', path.join(toolsDir, 'check-component-plan.mjs'))
const mockDir = opt('--mock-dir')
const maxAttempts = Math.max(1, Number(opt('--max-attempts', '2')) || 2)
if (!lessonSlug || !scriptPath || !stylePath) {
  console.error('usage: node generate-component-plan.mjs --lesson-slug <slug> --lesson "<title>" --script <courseware.md> --style <style-pack.manifest.json> [--registry registry/index.json] [--approval review/<slug>/script-approval.json] [--plan <component-plan.md>] [--briefs <dir>] [--mock-dir <dir>] [model options]')
  process.exit(2)
}
try {
  assertScriptApproved(scriptPath, { approvalPath })
} catch (error) {
  die(error.message)
}
const parsed = parseScript(scriptPath)
const style = readData(stylePath)
let registry
try {
  registry = loadRegistryPackages(registryPath, { projectRoot: process.cwd() })
} catch {
  registry = { index: { components: [] }, packages: [] }
}
const scriptSlides = parsed.slides.map((slide) => ({
  id: slide.id,
  title: slide.headingTitle,
  objectiveId: slide.machine?.objectiveId || '',
  objective: slide.machine?.objective || '',
  components: slide.machine?.components || [],
  componentPlan: slide.machine?.componentPlan || [],
  interaction: slide.machine?.interaction || null,
}))
const declared = []
for (const slide of parsed.slides) {
  for (const item of slide.machine?.componentPlan || []) {
    if (item.status === 'new' || item.status === 'extend') {
      declared.push({ ...item, slideId: slide.id })
    }
  }
}
const styleComponents = (style.components || []).map((component) => ({
  id: component.id,
  name: component.name || component.id,
  kind: component.kind || '',
  status: component.status || '',
  interactionLevels: component.interactionLevels || [],
  whenToUse: component.whenToUse || '',
  whenNotToUse: component.whenNotToUse || '',
  sourceRefs: component.sourceRefs || [],
}))
const registryComponents = registry.packages
  .filter((pkg) => pkg.manifest)
  .map((pkg) => ({
    id: pkg.manifest.id,
    version: pkg.manifest.version,
    status: pkg.manifest.status,
    category: pkg.manifest.category,
    interactionLevels: pkg.manifest.interactionLevels || [],
    tags: pkg.manifest.tags || [],
    whenToUse: pkg.manifest.whenToUse || '',
    whenNotToUse: pkg.manifest.whenNotToUse || '',
    learningFunction: pkg.manifest.learningFunction || '',
  }))
function matchesFor(query, level) {
  const q = String(query || '').toLowerCase()
  const scored = registry.packages
    .filter((pkg) => pkg.manifest && pkg.manifest.status !== 'deprecated')
    .map((pkg) => {
      const m = pkg.manifest
      const haystack = [m.id, m.name, m.description, m.whenToUse, m.learningFunction, ...(m.tags || [])].join(' ').toLowerCase()
      let score = 0
      if (q && `${m.id} ${m.name}`.toLowerCase().includes(q)) score += 3
      if (q && haystack.includes(q)) score += 1
      if (level && (m.interactionLevels || []).includes(level)) score += 2
      return { id: m.id, version: m.version, score, whenToUse: m.whenToUse, learningFunction: m.learningFunction }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 3)
  return scored
}
const reuseHints = scriptSlides
  .filter((slide) => slide.interaction)
  .map((slide) => {
    const demand = `${slide.title} · ${slide.interaction.learningAction || ''}`
    const query = `${slide.interaction.learningAction || ''} ${slide.interaction.type || ''}`.trim()
    return {
      slideId: slide.id,
      demand,
      query,
      level: slide.interaction.level,
      matches: matchesFor(query, slide.interaction.level),
    }
  })
const evidence = {
  schemaVersion: '1.0',
  mode: 'component-plan',
  lessonSlug,
  lesson,
  script: { path: scriptPath, slides: scriptSlides },
  declared,
  style: { path: stylePath, components: styleComponents },
  registry: { path: registryPath, components: registryComponents },
  reuseHints,
  templates: {
    plan: { path: 'workflow/preset/templates/component-plan-template.md', text: readText('workflow/preset/templates/component-plan-template.md') },
    brief: { path: 'workflow/preset/templates/component-brief-template.md', text: readText('workflow/preset/templates/component-brief-template.md') },
  },
  rules: [
    '只做组件复用规划与简报，不写实现代码、HTML、CSS 或测试。',
    '尊重脚本已批准的 componentPlan：每个 new/extend id 必须且只能出现在 gaps 中，decision 与脚本一致。',
    '每个互动需求先记参考源码检索，再记注册表检索；没有命中也要记录原因。',
    '每个 new/extend 必须有一份完整简报，包含模板要求的所有标题、状态机表、props 表、无障碍、降级和测试计划。',
    '不要把风格包 kind=generated 的条目当成可用实现；实现必须在 registry core。',
    '不允许 TODO/TBD/待定/占位/[NEEDS CLARIFICATION]。',
  ],
}
writeJson(evidencePath, evidence)

function mockFile(attempt) {
  if (!mockDir) return ''
  const candidates = attempt > 1
    ? [path.join(mockDir, 'component-plan-repair.json'), path.join(mockDir, 'component-plan.json')]
    : [path.join(mockDir, 'component-plan.json')]
  const found = candidates.find((file) => fs.existsSync(path.resolve(file)))
  if (!found) die(`mock response not found: ${candidates.join(', ')}`)
  return found
}
const MODEL_ARGS = []
for (let i = 0; i < args.length; i += 1) {
  if (['--config', '--zcode-config', '--zcode-provider', '--api', '--base-url', '--model', '--api-key-env', '--api-key-file', '--max-tokens', '--timeout-ms', '--auth'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
    MODEL_ARGS.push(args[i], args[i + 1])
    i += 1
  }
}
if (!MODEL_ARGS.includes('--max-tokens')) MODEL_ARGS.push('--max-tokens', '65536')
if (!MODEL_ARGS.includes('--timeout-ms')) MODEL_ARGS.push('--timeout-ms', '600000')

function callModel(attempt, errors, previous) {
  const currentEvidence = attempt === 1 ? evidence : { ...evidence, repair: { errors, previous } }
  const attemptEvidence = path.join(reviewDir, `component-plan-input-attempt-${attempt}.json`)
  writeJson(attemptEvidence, currentEvidence)
  const callArgs = [singleShotPath, '--mode', 'component-plan', '--evidence', attemptEvidence, '--out', rawPath]
  const mock = mockFile(attempt)
  if (mock) callArgs.push('--mock-response', mock)
  const result = spawnSync(process.execPath, [...callArgs, ...MODEL_ARGS], { cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe' })
  if (result.error) die(result.error.message)
  if (result.status !== 0) return { error: `${result.stdout || ''}\n${result.stderr || ''}`.trim() }
  return { raw: readData(rawPath) }
}

function validatePlan(raw) {
  const errors = []
  const schema = validateWithSchema(
    fileURLToPath(new URL('../schemas/component-plan-generation.schema.json', import.meta.url)),
    raw,
  )
  for (const error of schema.errors) errors.push(`schema ${error}`)
  if (schema.errors.length) return errors
  if (raw.lesson !== lessonSlug) errors.push(`lesson ${raw.lesson} != ${lessonSlug}`)
  const declaredById = new Map(declared.map((item) => [item.id, item]))
  const gapById = new Map()
  for (const gap of raw.gaps) {
    if (gapById.has(gap.id)) errors.push(`duplicate gap ${gap.id}`)
    gapById.set(gap.id, gap)
    const item = declaredById.get(gap.id)
    if (!item) errors.push(`gap ${gap.id} is not declared new/extend in the script`)
    else if (item.status !== gap.decision) errors.push(`gap ${gap.id} decision ${gap.decision} != script ${item.status}`)
  }
  for (const item of declared) {
    if (!gapById.has(item.id)) errors.push(`declared component ${item.id} has no gap row`)
  }
  const briefIds = new Set()
  for (const brief of raw.briefs) {
    if (briefIds.has(brief.id)) errors.push(`duplicate brief ${brief.id}`)
    briefIds.add(brief.id)
    if (!declaredById.has(brief.id)) errors.push(`brief ${brief.id} is not a declared new/extend component`)
    if (hasPlaceholder(brief.markdown)) errors.push(`brief ${brief.id} contains a placeholder`)
    const sections = parseMarkdownSections(brief.markdown)
    const required = ['复用检索', '缺口与决定', '学习目标与成功标准', '交互状态机', 'Props API', '视觉状态与布局约束', '参考源码对照', '无障碍', '静态降级', '测试计划', '风险与非目标', '审核']
    for (const heading of required) {
      if (!sections.some((section) => section.canonical === canonicalHeading(heading))) {
        errors.push(`brief ${brief.id}: missing section ${heading}`)
      }
    }
  }
  for (const item of declared) {
    if (!briefIds.has(item.id)) errors.push(`declared component ${item.id} has no brief`)
  }
  const slideIds = new Set(scriptSlides.map((slide) => slide.id))
  for (const row of raw.reuseSearch) if (!slideIds.has(row.slideId)) errors.push(`reuseSearch references unknown slide ${row.slideId}`)
  for (const row of raw.mapping) if (!slideIds.has(row.slideId)) errors.push(`mapping references unknown slide ${row.slideId}`)
  return errors
}

function planMarkdown(raw) {
  const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
  const lines = [
    `# 组件计划：${lesson}`,
    '',
    '> 先查参考源码 → 再查风格包/注册表 → 最后才新建。每个交互需求都要有检索记录；`new` / `extend` 必须有简报，不得在页面里临时发明组件。',
    '> 组件计划先于分镜；分镜只能使用参考源码类型、风格包或已入 core 的组件。',
    '',
    '## 1. 复用检索',
    '',
    '**参考源码检索（第一优先）**',
    '',
    '| 需求（来自哪屏 / 哪个学习动作） | 参考类型 / 选择器 | 参考文件 / 哈希 | 是否可直接复制 | 说明 |',
    '|---|---|---|---|---|',
  ]
  const refs = raw.reuseSearch.filter((row) => row.reference)
  if (refs.length) {
    for (const row of refs) {
      const r = row.reference
      lines.push(`| ${cell(`${row.slideId} ${row.demand}`)} | ${cell(`${r.type}${r.selector ? ` / ${r.selector}` : ''}`)} | ${cell(`${r.source}${r.hash ? ` / ${r.hash}` : ''}`)} | ${r.canCopy ? '是（reference-verbatim）' : '否'} | ${cell(r.notes || '')} |`)
    }
  } else lines.push('| — | — | — | — | 无参考源码命中 |')
  lines.push('', '**注册表检索**', '', '| 需求（来自哪屏 / 哪个学习动作） | 检索词 / tags / level | 命中组件 | 是否满足 | 不满足的原因 |', '|---|---|---|---|---|')
  for (const row of raw.reuseSearch) {
    const matches = row.registry.matches || []
    const search = `${row.registry.query}${row.registry.tags ? ` / ${row.registry.tags}` : ''}${row.registry.level ? ` / ${row.registry.level}` : ''}`
    if (!matches.length) {
      lines.push(`| ${cell(`${row.slideId} ${row.demand}`)} | ${cell(search)} | 未命中 | 否 | 注册表无匹配 |`)
    } else {
      for (const match of matches) {
        lines.push(`| ${cell(`${row.slideId} ${row.demand}`)} | ${cell(search)} | ${cell(`${match.id}${match.version ? `@${match.version}` : ''}`)} | ${match.satisfied ? '是' : '否'} | ${cell(match.satisfied ? '—' : match.reason)} |`)
      }
    }
  }
  lines.push('', '## 2. 缺口', '', '| ID | 学习动作 | 互动层级 | 现有组件为何不够 | 决定 | 简报 |', '|---|---|---|---|---|---|')
  if (raw.gaps.length) {
    for (const gap of raw.gaps) lines.push(`| ${cell(gap.id)} | ${cell(gap.learningAction)} | ${cell(gap.level)} | ${cell(gap.whyExisting)} | ${cell(gap.decision)} | ${cell(gap.brief)} |`)
  } else {
    lines.push('| — | — | — | 现有组件已覆盖 | 无 | — |')
  }
  lines.push('', '## 3. 复用映射', '', '| Slide | 需要的学习动作 | 组件 | 来源 |', '|---|---|---|---|')
  for (const row of raw.mapping) lines.push(`| ${cell(row.slideId)} | ${cell(row.demand)} | ${cell(row.component)} | ${cell(row.source)} |`)
  lines.push('', '## 4. 风险与非目标', '')
  if (raw.risks?.length) lines.push('**风险：**', ...raw.risks.map((risk) => `- ${risk}`), '')
  if (raw.nonGoals?.length) lines.push('**不准备做的能力：**', ...raw.nonGoals.map((item) => `- ${item}`), '')
  return `${lines.join('\n').trimEnd()}\n`
}

function writeArtifacts(raw) {
  fs.mkdirSync(path.dirname(path.resolve(planPath)), { recursive: true })
  fs.writeFileSync(path.resolve(planPath), planMarkdown(raw))
  fs.mkdirSync(path.resolve(briefsDir), { recursive: true })
  for (const brief of raw.briefs) {
    const item = declared.find((entry) => entry.id === brief.id)
    const target = item?.brief ? path.resolve(scriptDir, item.brief) : path.join(briefsDir, `${brief.id}.md`)
    const root = path.resolve(scriptDir)
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) die(`brief path escapes script directory: ${target}`)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `${brief.markdown.trimEnd()}\n`)
  }
}

function runCheck() {
  return spawnSync(process.execPath, [checkPath, scriptPath, stylePath, registryPath, '--plan', planPath, '--briefs', briefsDir, '--approval', approvalPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  })
}

if (!mockDir) {
  const config = spawnSync(process.execPath, [singleShotPath, '--check-config', ...MODEL_ARGS], { cwd: process.cwd(), stdio: 'inherit' })
  if (config.status !== 0) die(`single-shot config failed (exit ${config.status})`)
}

let raw = null
let errors = []
let attempts = 0
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  attempts = attempt
  const call = callModel(attempt, errors, raw)
  if (call.error) {
    errors = call.error.split(/\r?\n/).filter(Boolean)
  } else {
    raw = call.raw
    errors = validatePlan(raw)
    if (!errors.length) {
      writeArtifacts(raw)
      const check = runCheck()
      if (check.status === 0) {
        writeJson(reportPath, { schemaVersion: '1.0', lessonSlug, attempts, plan: planPath, briefs: raw.briefs.map((brief) => brief.id) })
        console.log(`OK component plan — ${raw.gaps.length} gap(s), ${raw.briefs.length} brief(s), ${attempts} attempt(s)`)
        process.exit(0)
      }
      errors = `${check.stdout || ''}\n${check.stderr || ''}`.trim().split(/\r?\n/).filter(Boolean)
    }
  }
  console.error(`component plan attempt ${attempt} failed:\n${errors.map((error) => `  - ${error}`).join('\n')}`)
}
die(`component plan is still invalid after ${attempts} attempt(s):\n${errors.map((error) => `  - ${error}`).join('\n')}`)
