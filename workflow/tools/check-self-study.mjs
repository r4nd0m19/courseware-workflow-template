#!/usr/bin/env node
// Gate for the self-study sufficiency audit.
//
// The audit answers one question: can a student learn this lesson without a
// teacher? It must cover all rubric dimensions, tie every gap to real slides,
// state the page impact, and (when supplements are proposed) ship a complete
// revised script whose supplement blocks are labelled and traceable.
//
// This tool never edits the script. apply-self-study-audit.mjs does that only
// after the human gate.
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { readData, validateWithSchema } from './lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
function flag(name) { return args.includes(name) }

const auditPath = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--script') && !(i > 0 && args[i - 1] === '--proposal'))
const scriptPath = opt('--script')
const proposalPath = opt('--proposal') || (scriptPath ? path.join(path.dirname(path.resolve(scriptPath)), 'courseware.self-study.md') : '')
const jsonOut = flag('--json')
if (!auditPath || !scriptPath) {
  console.error('usage: node check-self-study.mjs <review/self-study-audit.json> --script <courseware.md> [--proposal <courseware.self-study.md>] [--json]')
  process.exit(2)
}

const errors = []
const warnings = []
let data
try {
  data = readData(auditPath)
} catch (error) {
  console.error(`FAIL self-study audit: cannot read ${auditPath}: ${error.message}`)
  process.exit(1)
}
const schemaCheck = validateWithSchema(
  fileURLToPath(new URL('../schemas/self-study-audit.schema.json', import.meta.url)),
  data,
)
for (const error of schemaCheck.errors) errors.push(`schema ${error}`)

if (!fs.existsSync(scriptPath)) {
  errors.push(`script not found: ${scriptPath}`)
}
const scriptSource = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : ''
const scriptSha = scriptSource
  ? crypto.createHash('sha256').update(scriptSource).digest('hex')
  : ''
if (scriptSha && data.script?.sha256 !== scriptSha) {
  errors.push(`script sha256 ${data.script?.sha256 || '(missing)'} does not match ${scriptPath} (${scriptSha}); re-run the audit on the current script`)
}

const slideIds = [...scriptSource.matchAll(/^##\s+(S\d+[A-Z]?)\s*·/gm)].map((m) => m[1])
if (slideIds.length && data.script?.slides !== slideIds.length) {
  errors.push(`audit records ${data.script?.slides} slides but the script has ${slideIds.length}`)
}
const slideSet = new Set(slideIds)

// Rubric ids are fixed by the schema; also require each exactly once.
const rubricIds = (data.rubric || []).map((r) => r.id)
const expectedRubric = [
  'objectives',
  'prerequisites',
  'explanation',
  'worked-examples',
  'practice',
  'feedback',
  'misconceptions',
  'navigation',
  'accessibility',
  'self-regulation',
]
for (const id of expectedRubric) {
  if (rubricIds.filter((value) => value === id).length !== 1) {
    errors.push(`rubric dimension ${id} must appear exactly once`)
  }
}
for (const id of rubricIds) {
  if (!expectedRubric.includes(id)) errors.push(`unknown rubric dimension ${id}`)
}

// Every gap must point at real slides and a gap dimension must agree with the
// rubric verdict.
const gapIds = new Set()
const gapsByDimension = new Map()
for (const gap of data.gaps || []) {
  if (gapIds.has(gap.id)) errors.push(`duplicate gap id ${gap.id}`)
  gapIds.add(gap.id)
  gapsByDimension.set(gap.dimension, (gapsByDimension.get(gap.dimension) || 0) + 1)
  if (!gap.slideIds?.length) errors.push(`${gap.id}: slideIds must not be empty`)
  for (const id of gap.slideIds || []) {
    if (slideSet.size && !slideSet.has(id)) errors.push(`${gap.id}: unknown slide ${id}`)
  }
}
for (const rubric of data.rubric || []) {
  if (rubric.verdict === 'gap' && !gapsByDimension.get(rubric.id)) {
    errors.push(`rubric ${rubric.id} is marked gap but no gap references that dimension`)
  }
  if (rubric.verdict === 'pass' && gapsByDimension.get(rubric.id)) {
    warnings.push(`rubric ${rubric.id} is marked pass but ${gapsByDimension.get(rubric.id)} gap(s) reference it`)
  }
}

// Every non-SKIP slide must be assessed exactly once, and the screen table must
// agree with the gap table in both directions.
const screenIds = new Set()
const screensByGap = new Map()
const objectiveIds = new Set((data.objectives || []).map((o) => o.id))
for (const screen of data.screens || []) {
  if (screenIds.has(screen.id)) errors.push(`duplicate screen assessment ${screen.id}`)
  screenIds.add(screen.id)
  if (slideSet.size && !slideSet.has(screen.id)) errors.push(`screen assessment references unknown slide ${screen.id}`)
  for (const objectiveId of screen.objectiveIds || []) {
    if (!objectiveIds.has(objectiveId)) errors.push(`screen ${screen.id}: unknown objective ${objectiveId}`)
  }
  for (const gapId of screen.gapIds || []) {
    if (!gapIds.has(gapId)) {
      errors.push(`screen ${screen.id}: unknown gap ${gapId}`)
      continue
    }
    screensByGap.set(gapId, (screensByGap.get(gapId) || 0) + 1)
    const gap = (data.gaps || []).find((g) => g.id === gapId)
    if (gap && !gap.slideIds.includes(screen.id)) {
      errors.push(`screen ${screen.id} cites ${gapId}, but that gap does not list ${screen.id}`)
    }
  }
  if (screen.status === 'gap' && !(screen.gapIds || []).length) {
    errors.push(`screen ${screen.id} is marked gap but cites no gap id`)
  }
}
if (slideIds.length && (screenIds.size !== slideIds.length || slideIds.some((id) => !screenIds.has(id)))) {
  errors.push(`screen assessments must cover every slide exactly once (script ${slideIds.length}, assessed ${screenIds.size})`)
}
for (const gap of data.gaps || []) {
  if (!screensByGap.get(gap.id)) errors.push(`gap ${gap.id} is not cited by any screen assessment`)
}
for (const objective of data.objectives || []) {
  for (const id of objective.slides || []) {
    const screen = (data.screens || []).find((s) => s.id === id)
    if (!screen) errors.push(`objective ${objective.id}: unknown slide ${id}`)
    else if (!screen.objectiveIds.includes(objective.id)) {
      errors.push(`objective ${objective.id}: slide ${id} does not list ${objective.id} in its objectiveIds`)
    }
  }
}

// Verdict consistency.
const blocking = (data.gaps || []).filter((gap) => gap.severity === 'blocking')
if (data.verdict === 'sufficient' && blocking.length) {
  errors.push('verdict is sufficient but blocking gaps exist')
}
if (data.verdict === 'insufficient' && !blocking.length) {
  errors.push('verdict is insufficient but no gap has severity blocking')
}

// Page budget is explicit; the workflow never expands the page count silently.
const budget = data.pageBudget || {}
const impact = (data.gaps || []).reduce((sum, gap) => sum + (Number(gap.pageImpact) || 0), 0)
if (budget.current !== slideIds.length && slideIds.length) {
  errors.push(`pageBudget.current ${budget.current} != script slides ${slideIds.length}`)
}
if (budget.proposed !== budget.current + impact) {
  errors.push(`pageBudget.proposed ${budget.proposed} != current ${budget.current} + pageImpact ${impact}`)
}
const exceeds = budget.proposed > budget.declared
if (budget.exceedsDeclaredBudget !== exceeds) {
  errors.push(`pageBudget.exceedsDeclaredBudget must be ${exceeds}`)
}
const expectedDecision = exceeds ? 'teacher-approval-required' : 'within-budget'
if (budget.decision !== expectedDecision) {
  errors.push(`pageBudget.decision must be ${expectedDecision}`)
}

const addedIds = new Set()
for (const addition of data.pageAdditions || []) {
  if (slideSet.has(addition.id)) errors.push(`page addition ${addition.id} already exists in the script`)
  if (addedIds.has(addition.id)) errors.push(`duplicate page addition ${addition.id}`)
  addedIds.add(addition.id)
  if (!gapIds.has(addition.gapId)) errors.push(`page addition ${addition.id}: unknown gap ${addition.gapId}`)
}
for (const addition of data.pageAdditions || []) {
  if (!slideSet.has(addition.afterSlide) && !addedIds.has(addition.afterSlide)) {
    errors.push(`page addition ${addition.id}: afterSlide ${addition.afterSlide} does not exist`)
  }
}

// Supplements: every blocking gap must have one; every supplement must point
// back to a gap and use the mandated label.
const supplementIds = new Set()
for (const supplement of data.supplements || []) {
  if (supplementIds.has(supplement.id)) errors.push(`duplicate supplement id ${supplement.id}`)
  supplementIds.add(supplement.id)
  if (!gapIds.has(supplement.gapId)) errors.push(`supplement ${supplement.id}: unknown gap ${supplement.gapId}`)
  for (const id of supplement.targetSlides || []) {
    if (slideSet.size && !slideSet.has(id) && !addedIds.has(id)) errors.push(`supplement ${supplement.id}: unknown slide ${id}`)
  }
}
if (data.verdict === 'insufficient') {
  for (const gap of blocking) {
    if (!(data.supplements || []).some((s) => s.gapId === gap.id)) {
      errors.push(`blocking gap ${gap.id} has no supplement; add one or reclassify it with a written rationale`)
    }
  }
}
for (const id of (data.contentPack?.unreferenced || [])) {
  errors.push(`required content item ${id} is not referenced by the script`)
}

// A proposal is required whenever supplements or new pages exist. It must be
// the full script (no slides deleted), contain the new pages, and carry one
// labelled, delimited block per supplement.
const supplements = data.supplements || []
const pageAdditions = budget.proposed !== budget.current
const needsProposal = supplements.length > 0 || pageAdditions
if (needsProposal && !proposalPath) {
  errors.push('supplements or new pages exist but --proposal was not provided; write courseware.self-study.md')
}
if (proposalPath && needsProposal) {
  if (!fs.existsSync(proposalPath)) {
    errors.push(`proposal not found: ${proposalPath}`)
  } else {
    const proposal = fs.readFileSync(proposalPath, 'utf8')
    if (!/^---\r?\n/.test(proposal)) errors.push('proposal must be a complete courseware.md (frontmatter missing)')
    const proposalSlides = [...proposal.matchAll(/^##\s+(S\d+[A-Z]?)\s*·/gm)].map((m) => m[1])
    for (const id of slideIds) {
      if (!proposalSlides.includes(id)) errors.push(`proposal removed or renamed slide ${id}`)
    }
    if (new Set(proposalSlides).size !== proposalSlides.length) errors.push('proposal contains duplicate slide ids')
    if (proposalSlides.length !== budget.proposed) {
      errors.push(`proposal has ${proposalSlides.length} slides but pageBudget.proposed is ${budget.proposed}`)
    }
    for (const addition of data.pageAdditions || []) {
      if (!proposalSlides.includes(addition.id)) errors.push(`proposal is missing page addition ${addition.id}`)
    }
    for (const supplement of supplements) {
      const open = `<!-- self-study-supplement:${supplement.id} -->`
      const close = `<!-- /self-study-supplement:${supplement.id} -->`
      const start = proposal.indexOf(open)
      const end = proposal.indexOf(close)
      if (start < 0 || end < 0 || end < start) {
        errors.push(`proposal is missing the delimited block for supplement ${supplement.id}`)
        continue
      }
      const block = proposal.slice(start + open.length, end)
      if (!block.includes('自学补充')) errors.push(`supplement ${supplement.id} block must be labelled 自学补充`)
      if (!block.includes(supplement.basis)) errors.push(`supplement ${supplement.id} block must cite its basis: ${supplement.basis}`)
    }
  }
}

const report = {
  ok: errors.length === 0,
  verdict: data.verdict,
  lesson: data.lesson,
  slides: slideIds.length,
  gaps: (data.gaps || []).length,
  blocking: blocking.length,
  supplements: supplements.length,
  pageBudget: { declared: budget.declared, current: budget.current, proposed: budget.proposed },
  warnings,
  errors,
}
if (jsonOut) console.log(JSON.stringify(report, null, 2))
else {
  console.log(report.ok ? `OK self-study audit ${data.lesson}` : `FAIL self-study audit ${data.lesson}`)
  console.log(`   verdict: ${data.verdict} (${blocking.length} blocking, ${(data.gaps || []).length} total gap(s))`)
  console.log(`   pages: ${budget.current} -> ${budget.proposed} (declared ${budget.declared})`)
  console.log(`   supplements: ${supplements.length}`)
  for (const warning of warnings) console.error(`  warning: ${warning}`)
  for (const error of errors) console.error(`  - ${error}`)
}
process.exit(report.ok ? 0 : 1)
