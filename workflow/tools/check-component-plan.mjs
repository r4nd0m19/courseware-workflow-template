#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { readData, validateWithSchema, fail, ok } from './lib.mjs'
import { assertScriptApproved, DEFAULT_SCRIPT_APPROVAL } from './approval-lib.mjs'
import {
  parseScript,
  parseMarkdownSections,
  canonicalHeading,
  findSection,
  parseTableRows,
  hasPlaceholder,
} from './script-lib.mjs'

const rawArgs = process.argv.slice(2)
const options = { plan: '', briefs: '', approval: DEFAULT_SCRIPT_APPROVAL }
const positionals = []
for (let i = 0; i < rawArgs.length; i += 1) {
  const arg = rawArgs[i]
  if (arg === '--plan') {
    options.plan = rawArgs[i + 1] || ''
    i += 1
  } else if (arg === '--briefs') {
    options.briefs = rawArgs[i + 1] || ''
    i += 1
  } else if (arg === '--approval') {
    options.approval = rawArgs[i + 1] || ''
    i += 1
  } else if (arg.startsWith('--')) {
    console.error(`unknown option ${arg}`)
    process.exit(2)
  } else {
    positionals.push(arg)
  }
}

const [scriptPath, stylePath, registryArg] = positionals
if (!scriptPath || !stylePath) {
  console.error(
    'usage: node check-component-plan.mjs <courseware.md> <style-pack-manifest.json> [component-registry.json] [--plan component-plan.md] [--briefs component-briefs] [--approval review/script-approval.json]',
  )
  process.exit(2)
}

const scriptDir = path.dirname(path.resolve(scriptPath))
const planPath = options.plan
  ? path.resolve(options.plan)
  : path.join(scriptDir, 'component-plan.md')
const briefsDir = options.briefs
  ? path.resolve(options.briefs)
  : path.join(scriptDir, 'component-briefs')

const errors = []
const warnings = []

let parsed
try {
  parsed = parseScript(scriptPath)
} catch (err) {
  console.error(`FAIL courseware script parse — ${err.message}`)
  process.exit(1)
}

try {
  assertScriptApproved(scriptPath, { approvalPath: options.approval })
} catch (err) {
  console.error(`FAIL component plan — ${err.message}`)
  process.exit(1)
}

const style = readData(stylePath)
const styleCheck = validateWithSchema(
  fileURLToPath(new URL('../schemas/style-pack-manifest.schema.json', import.meta.url)),
  style,
)
for (const e of styleCheck.errors) errors.push(`style pack ${e}`)

let registry = null
if (registryArg && registryArg.trim()) {
  const p = path.resolve(registryArg)
  if (fs.existsSync(p)) {
    registry = readData(p)
    const rc = validateWithSchema(
      fileURLToPath(new URL('../schemas/component-registry.schema.json', import.meta.url)),
      registry,
    )
    for (const e of rc.errors) errors.push(`component registry ${e}`)
  } else {
    warnings.push(`component registry ${registryArg} not found; using style pack only`)
  }
}
if (errors.length) {
  fail('component plan schema', errors)
  process.exit(1)
}

const registered = new Map()
const generated = new Set()
for (const c of style.components || []) {
  // `kind: generated` style-pack entries are design vocabulary only; the
  // implementation must come from the registry (see check-vocabulary).
  if (c.kind === 'generated') {
    generated.add(c.id)
    continue
  }
  registered.set(c.id, { source: 'style-pack', status: c.status })
}
for (const c of registry?.components || []) {
  if (!registered.has(c.id)) registered.set(c.id, { source: 'registry', status: c.status })
}

if (!fs.existsSync(planPath)) {
  fail('component plan', [`${planPath} not found; run speckit.component-plan first`])
  process.exit(1)
}
const plan = fs.readFileSync(planPath, 'utf8')
if (hasPlaceholder(plan)) {
  errors.push(`${planPath}: contains a placeholder (TODO/TBD/待定/[NEEDS CLARIFICATION])`)
}

const planSections = parseMarkdownSections(plan)
function sectionByHeadings(markdownSections, names) {
  const wanted = new Set(names.map(canonicalHeading))
  return markdownSections.find((s) => wanted.has(s.canonical))
}
const reuse = sectionByHeadings(planSections, ['复用检索'])
const gap = sectionByHeadings(planSections, ['缺口', '组件缺口'])
const mapping = sectionByHeadings(planSections, ['复用映射'])
for (const [label, section] of [
  ['复用检索', reuse],
  ['缺口', gap],
  ['复用映射', mapping],
]) {
  if (!section) errors.push(`${planPath}: missing section「${label}」`)
}
const reuseRows = reuse ? parseTableRows(reuse.body).slice(1).filter((r) => r.length) : []
if (reuse && reuseRows.length === 0) {
  errors.push(`${planPath}: 「复用检索」表至少需要一行检索记录`)
}
const gapRows = gap ? parseTableRows(gap.body).slice(1).filter((r) => r.length) : []
const gapText = gapRows.flat().join(' ')

const used = new Set()
const declarations = new Map()
for (const slide of parsed.slides) {
  const m = slide.machine
  if (!m) continue
  for (const c of m.components || []) used.add(c)
  for (const item of m.componentPlan || []) {
    const previous = declarations.get(item.id)
    const duplicate =
      previous &&
      (previous.slide === slide.id ||
        previous.status === 'new' ||
        previous.status === 'extend' ||
        item.status === 'new' ||
        item.status === 'extend')
    if (duplicate) {
      warnings.push(`${slide.id}: componentPlan ${item.id} declared more than once`)
    }
    declarations.set(item.id, { ...item, slide: slide.id })
  }
}

const requiredBriefSections = [
  ['复用检索'],
  ['缺口与决定', '缺口'],
  ['学习目标与成功标准'],
  ['交互状态机'],
  ['Props API', 'Props'],
  ['视觉状态与布局约束'],
  ['无障碍'],
  ['静态降级'],
  ['测试计划'],
  ['风险与非目标'],
  ['审核'],
]

function resolveBriefPath(item) {
  const raw = item.brief || `component-briefs/${item.id}.md`
  if (path.isAbsolute(raw)) return raw
  const fromScript = path.resolve(scriptDir, raw)
  if (fs.existsSync(fromScript)) return fromScript
  const fromBriefs = path.resolve(briefsDir, path.basename(raw))
  return fromBriefs
}

for (const [id, item] of declarations) {
  if (item.status === 'existing' || item.status === 'reference-verbatim') {
    if (!registered.has(id)) {
      errors.push(
        generated.has(id)
          ? `${item.slide}: ${id} declared ${item.status}, but it is a generated style-pack entry with no bundled implementation; register it core first`
          : `${item.slide}: ${id} declared ${item.status}, but it is not in the style pack or registry`,
      )
    }
    continue
  }
  if (item.status === 'new' && registered.has(id)) {
    errors.push(`${item.slide}: ${id} declared new, but it is already registered; use existing/extend`)
  }
  if (item.status === 'extend' && !registered.has(id)) {
    errors.push(`${item.slide}: ${id} declared extend, but no registered component exists; use new`)
  }
  if (!gapRows.some((row) => row.includes(id) || row.some((c) => c.includes(id)))) {
    errors.push(`${planPath}: 「缺口」表没有记录 ${id}（${item.status}）`)
  }
  const briefPath = resolveBriefPath(item)
  if (!fs.existsSync(briefPath)) {
    errors.push(`${item.slide}: component brief for ${id} not found at ${briefPath}`)
    continue
  }
  const brief = fs.readFileSync(briefPath, 'utf8')
  if (hasPlaceholder(brief)) {
    errors.push(`${briefPath}: contains a placeholder (TODO/TBD/待定/[NEEDS CLARIFICATION])`)
  }
  const briefSections = parseMarkdownSections(brief)
  const missing = requiredBriefSections.filter(
    (names) => !briefSections.some((s) => names.some((n) => s.canonical === canonicalHeading(n))),
  )
  if (missing.length) {
    errors.push(`${briefPath}: missing section(s) ${missing.map((n) => n.join(' / ')).join(', ')}`)
  }
  const fsm = sectionByHeadings(briefSections, ['交互状态机'])
  if (!fsm || !fsm.body.trim()) {
    errors.push(`${briefPath}: 「交互状态机」is empty`)
  } else if (!/\|/.test(fsm.body) && !/状态.*事件|事件.*状态|transition/i.test(fsm.body)) {
    errors.push(`${briefPath}: 「交互状态机」needs a state/event/transition table`)
  }
  const props = sectionByHeadings(briefSections, ['Props API', 'Props'])
  if (!props || !props.body.trim()) {
    errors.push(`${briefPath}: 「Props API」is empty`)
  } else if (!/propsSchema|additionalProperties|属性|Prop/i.test(props.body)) {
    errors.push(`${briefPath}: 「Props API」needs a props schema or table`)
  }
  for (const name of ['无障碍', '静态降级', '测试计划']) {
    const s = sectionByHeadings(briefSections, [name])
    if (!s || !s.body.trim()) errors.push(`${briefPath}: 「${name}」is empty`)
  }
}

for (const c of used) {
  if (registered.has(c)) continue
  const d = declarations.get(c)
  if (!d) errors.push(`component "${c}" is used but neither registered nor declared in componentPlan`)
  else if (d.status === 'existing' || d.status === 'reference-verbatim') {
    errors.push(
      generated.has(c)
        ? `component "${c}" is declared ${d.status} but it is a generated style-pack entry with no bundled implementation; register it core first`
        : `component "${c}" is declared ${d.status} but is not in the style pack or registry`,
    )
  }
}

for (const id of declarations.keys()) {
  if (!used.has(id)) warnings.push(`componentPlan ${id} is declared but not used by any slide`)
}

const newCount = [...declarations.values()].filter((d) => !['existing', 'reference-verbatim'].includes(d.status)).length
const summary = `${reuseRows.length} reuse search row(s), ${gapRows.length} gap row(s), ${newCount} new/extend component(s), ${used.size} component(s) used`
if (errors.length) {
  fail('component plan', errors)
  for (const w of warnings) console.error(`WARN ${w}`)
  process.exit(1)
}
ok('component plan', summary)
for (const w of warnings) console.log(`WARN ${w}`)
