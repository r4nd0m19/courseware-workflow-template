#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { readData, validateWithSchema, fail, ok } from './lib.mjs'
import {
  parseScript,
  normalizeForMatch,
  normalizeComparable,
  hasPlaceholder,
} from './script-lib.mjs'

const rawArgs = process.argv.slice(2)
const options = { waivers: '', strictContent: false }
const positionals = []
for (let i = 0; i < rawArgs.length; i += 1) {
  const arg = rawArgs[i]
  if (arg === '--waivers') {
    options.waivers = rawArgs[i + 1] || ''
    i += 1
  } else if (arg === '--strict-content') {
    options.strictContent = true
  } else if (arg.startsWith('--')) {
    console.error(`unknown option ${arg}`)
    process.exit(2)
  } else {
    positionals.push(arg)
  }
}

const [scriptPath, contentPath, stylePath, registryArg] = positionals
if (!scriptPath || !contentPath || !stylePath) {
  console.error(
    'usage: node check-script.mjs <courseware.md> <content-pack.json> <style-pack-manifest.json> [component-registry.json] [--waivers waivers.json] [--strict-content]',
  )
  process.exit(2)
}

const errors = []
const warnings = []
// Production labels belong in the review process, not in student-facing
// titles. A cover is expressed by layout/type, never by a "封面：" prefix.
const PRODUCTION_TITLE_RE = /^(封面|标题|本页|第\s*\d+\s*页|S\d+[A-Z]?)\s*[：:·\-—\s]/

let parsed
try {
  parsed = parseScript(scriptPath)
} catch (err) {
  console.error(`FAIL courseware script parse — ${err.message}`)
  process.exit(1)
}

const parsedObject = parsed.toParsedObject()
const scriptCheck = validateWithSchema(
  fileURLToPath(new URL('../schemas/courseware-script.schema.json', import.meta.url)),
  parsedObject,
)
for (const e of scriptCheck.errors) errors.push(`script ${e}`)

const content = readData(contentPath)
const contentCheck = validateWithSchema(
  fileURLToPath(new URL('../schemas/content-pack.schema.json', import.meta.url)),
  content,
)
for (const e of contentCheck.errors) errors.push(`content pack ${e}`)

const style = readData(stylePath)
const styleCheck = validateWithSchema(
  fileURLToPath(new URL('../schemas/style-pack-manifest.schema.json', import.meta.url)),
  style,
)
for (const e of styleCheck.errors) errors.push(`style pack ${e}`)

let registry = null
let registryPath = registryArg
if (!registryPath && parsed.frontmatter.componentRegistry) {
  registryPath = path.resolve(path.dirname(parsed.path), parsed.frontmatter.componentRegistry)
}
if (registryPath && registryPath.trim()) {
  const absoluteRegistry = path.resolve(registryPath)
  if (fs.existsSync(absoluteRegistry)) {
    registry = readData(absoluteRegistry)
    const registryCheck = validateWithSchema(
      fileURLToPath(new URL('../schemas/component-registry.schema.json', import.meta.url)),
      registry,
    )
    for (const e of registryCheck.errors) errors.push(`component registry ${e}`)
    if (
      registry.stylePack &&
      style.id &&
      (registry.stylePack.id !== style.id || registry.stylePack.version !== (style.version || ''))
    ) {
      errors.push(
        `component registry targets style pack ${registry.stylePack.id}@${registry.stylePack.version}, but style pack is ${style.id}@${style.version || '(no version)'}`,
      )
    }
  } else {
    warnings.push(`component registry ${registryPath} not found; checking style pack only`)
  }
}

if (errors.length) {
  fail('courseware script schema', errors)
  process.exit(1)
}

// ---- vocabulary ----
const registered = new Map()
const generated = new Set()
for (const c of style.components || []) {
  if (c.kind === 'generated') {
    generated.add(c.id)
    continue
  }
  registered.set(c.id, { source: 'style-pack', status: c.status })
}
for (const c of registry?.components || []) {
  if (registered.has(c.id)) {
    warnings.push(`component ${c.id} exists in both style pack and registry; registry version ignored`)
  } else {
    registered.set(c.id, { source: 'registry', status: c.status })
  }
}
// A manifest may carry layout ids as bare strings or as {id, description}
// objects (the extracted shell and full style pack use the object form).
const layouts = new Set(
  (style.layouts || []).map((l) => (typeof l === 'string' ? l : l?.id)).filter(Boolean),
)

// ---- per-slide checks ----
const ids = new Set()
const declared = new Map()
const levelAliases = {
  watch: ['watch', '观看', '观察'],
  answer: ['answer', '回答', '作答'],
  modify: ['modify', '修改', '调整'],
  construct: ['construct', '构造', '构建'],
  explain: ['explain', '解释', '自述'],
}
function detectLevel(text) {
  const m = String(text).match(/互动层级[^\n：:]{0,12}[：:]\s*[`"'“”]?([a-zA-Z一-龥]+)/)
  if (!m) return null
  const raw = m[1].toLowerCase()
  for (const [level, aliases] of Object.entries(levelAliases)) {
    if (aliases.includes(raw)) return level
  }
  return null
}
function hasLabel(text, re) {
  return re.test(text)
}

for (const slide of parsed.slides) {
  const where = `${slide.id}`
  if (ids.has(slide.id)) errors.push(`${where}: duplicate slide id`)
  ids.add(slide.id)

  if (!slide.screenContent) errors.push(`${where}: 缺少「屏幕内容」`)
  if (!slide.interactionDesign) errors.push(`${where}: 缺少「交互设计」`)
  if (!slide.narration) errors.push(`${where}: 缺少「旁白 / 语音」`)
  for (const [label, text] of [
    ['屏幕内容', slide.screenContent],
    ['交互设计', slide.interactionDesign],
    ['旁白', slide.narration],
  ]) {
    if (text && hasPlaceholder(text)) {
      errors.push(`${where}: ${label} contains a placeholder (TODO/TBD/待定/[NEEDS CLARIFICATION])`)
    }
  }
  if (slide.unknownSections.length) {
    warnings.push(`${where}: unknown section(s) ${slide.unknownSections.join(', ')}`)
  }

  const m = slide.machine
  if (!m) {
    errors.push(`${where}: 缺少「制作字段」YAML 块`)
    continue
  }
  if (m.id !== slide.id) errors.push(`${where}: 制作字段 id=${m.id}, heading id=${slide.id}`)
  if (normalizeComparable(m.title) !== normalizeComparable(slide.headingTitle)) {
    errors.push(`${where}: 制作字段 title 与标题不一致 ("${m.title}" vs "${slide.headingTitle}")`)
  }
  for (const title of [slide.headingTitle, m.title]) {
    if (typeof title === 'string' && PRODUCTION_TITLE_RE.test(title.trim())) {
      errors.push(
        `${where}: title ${JSON.stringify(title)} starts with a production label; use a student-facing title (the cover is expressed by layout/type, not "封面：")`,
      )
      break
    }
  }

  if (slide.objectiveLine) {
    const om = slide.objectiveLine.match(/^(O\d+)/)
    if (!om) warnings.push(`${where}: 「对应目标」未以 O 编号开头`)
    else if (om[1] !== m.objectiveId) {
      errors.push(`${where}: 「对应目标」${om[1]} 与制作字段 ${m.objectiveId} 不一致`)
    }
  } else {
    warnings.push(`${where}: 缺少「**对应目标**」行`)
  }
  if (slide.contentLine) {
    const refs = [...slide.contentLine.matchAll(/\b([A-Z]+\d+)\b/g)].map((x) => x[1])
    const a = [...new Set(refs)].sort().join(',')
    const b = [...new Set(m.contentRefs || [])].sort().join(',')
    if (a !== b) errors.push(`${where}: 「内容来源」${a || '(none)'} 与制作字段 ${b || '(none)'} 不一致`)
  } else {
    warnings.push(`${where}: 缺少「**内容来源**」行`)
  }

  // component vocabulary
  for (const c of m.components || []) {
    const reg = registered.get(c)
    if (reg) {
      if (reg.status === 'deprecated') errors.push(`${where}: uses deprecated component "${c}"`)
    } else if (!declared.has(c)) {
      // may be declared below; re-check after collecting declarations
    }
  }
  if (!layouts.has(m.layout)) errors.push(`${where}: uses unregistered layout "${m.layout}"`)

  // component plan declarations
  for (const item of m.componentPlan || []) {
    if (declared.has(item.id)) warnings.push(`${where}: componentPlan ${item.id} declared more than once`)
    declared.set(item.id, { ...item, slide: slide.id })
    if (item.status === 'existing' || item.status === 'reference-verbatim') {
      if (!registered.has(item.id)) {
        errors.push(
          generated.has(item.id)
            ? `${where}: componentPlan marks "${item.id}" ${item.status}, but it is a generated style-pack entry with no bundled implementation; register it core first`
            : `${where}: componentPlan marks "${item.id}" ${item.status}, but it is not in the style pack or registry`,
        )
      }
    } else if (!item.brief) {
      errors.push(`${where}: componentPlan ${item.status} "${item.id}" needs a brief path`)
    }
    if (!(m.components || []).includes(item.id)) {
      warnings.push(`${where}: componentPlan ${item.id} is not used by this slide`)
    }
  }

  // interaction design completeness
  const level = detectLevel(slide.interactionDesign)
  if (!level) {
    errors.push(`${where}: 「交互设计」缺少可识别的「互动层级：watch|answer|modify|construct|explain」`)
  } else {
    if (!m.interaction) {
      errors.push(
        `${where}: 缺少制作字段 interaction；每一页都必须先尝试互动，watch 也要写静态理由`,
      )
    } else {
      if (m.interaction.level !== level) {
        errors.push(`${where}: 交互设计层级 ${level} 与制作字段 ${m.interaction.level} 不一致`)
      }
      for (const field of ['contentDemand', 'learningAction', 'evidence', 'learningFunction', 'staticAlternative']) {
        if (!String(m.interaction[field] || '').trim()) {
          errors.push(`${where}: interaction.${field} is required`)
        }
      }
      const action = String(m.interaction.learningAction || '').trim()
      const actions = new Set([
        'observe', 'locate', 'label', 'predict', 'trace',
        'convert', 'classify', 'construct', 'modify', 'explain',
      ])
      if (action && !actions.has(action)) {
        errors.push(`${where}: interaction.learningAction "${action}" is not in the controlled vocabulary`)
      }
      if (level === 'watch') {
        if (action && action !== 'observe') {
          errors.push(`${where}: watch 级只能配 learningAction=observe，当前为 ${action}`)
        }
        if (!String(m.interaction.whyStatic || '').trim()) {
          errors.push(`${where}: watch 级必须有 interaction.whyStatic（为什么没有互动比静态更能产生学习证据）`)
        }
        if (!hasLabel(slide.interactionDesign, /静态理由/)) {
          errors.push(`${where}: watch 级「交互设计」缺少「静态理由」`)
        }
      } else {
        if (String(m.interaction.whyStatic || '').trim()) {
          errors.push(`${where}: 非 watch 级不应有 interaction.whyStatic；请把它改成实际互动，或改成 watch 并说明理由`)
        }
        if (action === 'observe') {
          errors.push(`${where}: 非 watch 级不能使用 learningAction=observe`)
        }
        if (!String(m.interaction.component || '').trim()) {
          errors.push(`${where}: 非 watch 级必须写 interaction.component（由哪个组件实现该互动）`)
        } else if (!(m.components || []).includes(m.interaction.component)) {
          errors.push(`${where}: interaction.component ${m.interaction.component} 不在 components 中`)
        }
      }
    }

    if (!hasLabel(slide.interactionDesign, /互动尝试/)) {
      errors.push(`${where}: 「交互设计」缺少「互动尝试」`)
    }
    if (!hasLabel(slide.interactionDesign, /学习动作/)) {
      errors.push(`${where}: 「交互设计」缺少「学习动作」`)
    }
    if (!hasLabel(slide.interactionDesign, /内容依据/)) {
      errors.push(`${where}: 「交互设计」缺少「内容依据」`)
    }
    if (!hasLabel(slide.interactionDesign, /证据/)) {
      errors.push(`${where}: 「交互设计」缺少「证据」`)
    }

    if (level !== 'watch') {
      if (!hasLabel(slide.interactionDesign, /学生动作|学习者动作|学生操作/)) {
        errors.push(`${where}: 交互设计缺少「学生动作」`)
      }
      if (!hasLabel(slide.interactionDesign, /成功反馈|正确反馈|答对/)) {
        errors.push(`${where}: 交互设计缺少「成功反馈」`)
      }
      if (!hasLabel(slide.interactionDesign, /错误反馈|误区反馈|答错/)) {
        errors.push(`${where}: 交互设计缺少「错误反馈」`)
      }
      if (!hasLabel(slide.interactionDesign, /完成条件|通过条件|完成标准/)) {
        errors.push(`${where}: 交互设计缺少「完成条件」`)
      }
      if (
        m.interaction?.misconception &&
        !slide.interactionDesign.includes(m.interaction.misconception) &&
        !slide.interactionDesign.includes('误区')
      ) {
        errors.push(
          `${where}: 交互绑定误区 ${m.interaction.misconception}，但交互设计没有提到该误区`,
        )
      }
    } else if (!hasLabel(slide.interactionDesign, /静态替代|无交互替代|静态降级/)) {
      errors.push(`${where}: watch 级页面需要「静态替代」说明`)
    }
  }

  // narration quality
  const noNarration = /^[（(]无旁白[：:）)]/.test(slide.narration)
  if (!noNarration && normalizeForMatch(slide.narration).length < 10) {
    warnings.push(`${where}: 旁白过短（<10 字），请确认是完整逐字稿`)
  }
  if (
    !noNarration &&
    normalizeForMatch(slide.narration) === normalizeForMatch(slide.screenContent)
  ) {
    warnings.push(`${where}: 旁白与屏幕文字完全相同；旁白应补充解释而非复读`)
  }
}

// late vocabulary check for components declared new/extend
for (const slide of parsed.slides) {
  const m = slide.machine
  if (!m) continue
  for (const c of m.components || []) {
    if (registered.has(c)) continue
    const d = declared.get(c)
    if (!d) {
      errors.push(`${slide.id}: uses unregistered component "${c}" (no componentPlan declaration)`)
    } else if (d.status === 'existing' || d.status === 'reference-verbatim') {
      errors.push(
        generated.has(c)
          ? `${slide.id}: component "${c}" is declared ${d.status} but it is a generated style-pack entry with no bundled implementation; register it core first`
          : `${slide.id}: component "${c}" is declared ${d.status} but is not in the style pack or registry`,
      )
    }
  }
}

// ---- coverage ----
const known = new Set((content.items || []).map((i) => i.id))
const required = (content.items || []).filter((i) => i.required).map((i) => i.id)
const referenced = new Set()
for (const slide of parsed.slides) {
  for (const ref of slide.machine?.contentRefs || []) {
    if (!known.has(ref)) errors.push(`${slide.id}: references unknown content item ${ref}`)
    referenced.add(ref)
  }
}
let waivers = new Set()
if (options.waivers && options.waivers.trim()) {
  const raw = readData(options.waivers)
  const list = Array.isArray(raw) ? raw : raw.waivers || []
  waivers = new Set(list.map((w) => (typeof w === 'string' ? w : w.id)).filter(Boolean))
  for (const id of waivers) {
    if (!known.has(id)) errors.push(`waiver references unknown content item ${id}`)
    if (!required.includes(id)) errors.push(`waiver targets a non-required item ${id}`)
  }
}
const missing = required.filter((id) => !referenced.has(id) && !waivers.has(id))
for (const id of missing) {
  const item = content.items.find((i) => i.id === id)
  errors.push(`missing required content item ${id} (${item?.kind}: ${item?.title})`)
}

// ---- content presence in the human-readable document ----
const allScreen = parsed.slides.map((s) => normalizeForMatch(s.screenContent)).join('')
const allInteraction = parsed.slides.map((s) => normalizeForMatch(s.interactionDesign)).join('')
const allNarration = parsed.slides.map((s) => normalizeForMatch(s.narration)).join('')
// Word-level matching strips punctuation, so symbol-only content (star outputs,
// code punctuation) would otherwise compare as empty. Keep a whitespace-normalized
// copy that preserves symbols, and treat literal "\n" as a line break.
function normalizeForExact(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
}
const allScreenExact = parsed.slides.map((s) => normalizeForExact(s.screenContent)).join('\n')
const allInteractionExact = parsed.slides.map((s) => normalizeForExact(s.interactionDesign)).join('\n')
function present(haystack, needle, exactHaystack) {
  const n = normalizeForMatch(needle)
  if (!n || haystack.includes(n)) return true
  const exact = normalizeForExact(needle)
  return Boolean(exact && exactHaystack && exactHaystack.includes(exact))
}
for (const item of content.items || []) {
  const where = `${item.id} (${item.kind})`
  if (item.kind === 'narration') {
    const text = item.narration || item.text
    if (text && !present(allNarration, text)) {
      errors.push(`${where}: narration text is not present verbatim in any slide's 旁白`)
    }
  } else if (item.kind === 'example') {
    if (item.code && !present(allScreen, item.code, allScreenExact)) {
      errors.push(`${where}: example code is not present in any slide's 屏幕内容`)
    }
    if (item.output && !present(allScreen, item.output, allScreenExact)) {
      errors.push(`${where}: example output is not present in any slide's 屏幕内容`)
    }
  } else if (item.kind === 'quiz') {
    if (item.text && !present(allScreen, item.text, allScreenExact) && !present(allInteraction, item.text, allInteractionExact)) {
      errors.push(`${where}: quiz question is not present in 屏幕内容/交互设计`)
    }
    for (const [i, option] of (item.options || []).entries()) {
      if (!present(allScreen, option.text, allScreenExact) && !present(allInteraction, option.text, allInteractionExact)) {
        errors.push(`${where}: option ${i + 1} "${option.text}" is not present in 屏幕内容/交互设计`)
      }
    }
  } else if (item.kind === 'knowledge' && item.text) {
    if (!present(allScreen, item.text) && !present(allNarration, item.text)) {
      warnings.push(`${where}: knowledge text not found verbatim; confirm it is intentionally paraphrased`)
    }
  } else if (item.kind === 'step') {
    for (const [i, step] of (item.steps || []).entries()) {
      if (!present(allScreen, step) && !present(allNarration, step)) {
        warnings.push(`${where}: step ${i + 1} not found verbatim; confirm coverage`)
      }
    }
  }
}

const covered = required.length - missing.length
const interactionCount = parsed.slides.filter((s) => s.machine?.interaction).length
const planCount = [...declared.values()].filter((d) => d.status !== 'existing').length
const summary = `${parsed.slides.length} slide(s), ${covered}/${required.length} required covered, ${parsed.slides.filter((s) => s.narration).length} narration section(s), ${interactionCount} interaction(s), ${planCount} new/extend component(s)`
if (errors.length) {
  fail('courseware script', errors)
  for (const w of warnings) console.error(`WARN ${w}`)
  process.exit(1)
}
ok('courseware script', summary)
for (const w of warnings) console.log(`WARN ${w}`)
