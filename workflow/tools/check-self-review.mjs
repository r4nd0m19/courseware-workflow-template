#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { readData, validateWithSchema, fail, ok } from './lib.mjs'
import { buildDensityReport, compareSignals, readSlideIds } from './density-lib.mjs'

const args = process.argv.slice(2)
const options = { script: '', storyboard: '', slides: null, root: process.cwd(), concepts: '' }
const positionals = []
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--script') {
    options.script = args[i + 1] || ''
    i += 1
  } else if (arg === '--storyboard') {
    options.storyboard = args[i + 1] || ''
    i += 1
  } else if (arg === '--slides') {
    options.slides = readSlideIds(args[i + 1] || '')
    i += 1
  } else if (arg === '--root') {
    options.root = args[i + 1] || ''
    i += 1
  } else if (arg === '--concepts') {
    options.concepts = args[i + 1] || ''
    i += 1
  } else if (arg.startsWith('--')) {
    console.error(`unknown option ${arg}`)
    process.exit(2)
  } else {
    positionals.push(arg)
  }
}

const file = positionals[0]
if (!file) {
  console.error(`usage: node check-self-review.mjs <review/self-review-<stage>.json> [options]

Options:
  --script <courseware.md>    enforce the per-screen density report against this script
  --storyboard <file>         storyboard used for contentRefs in the density report
  --slides S04,S05,S06        require density entries only for these slides (default: all)
  --root <dir>                project root for reviewedArtifacts paths (default: cwd)
  --concepts <file>           require a per-concept verdict for the concept ledger
`)
  process.exit(2)
}

let data
try {
  data = readData(file)
} catch (e) {
  console.error(`FAIL self-review: cannot read ${file}: ${e.message}`)
  process.exit(1)
}

const { ok: valid, errors } = validateWithSchema(
  fileURLToPath(new URL('../schemas/self-review.schema.json', import.meta.url)),
  data,
)
if (!valid) {
  fail(`self-review schema ${file}`, errors)
  process.exit(1)
}

const problems = []
if (data.verdict !== 'pass') problems.push(`verdict is ${data.verdict}`)
for (const c of data.automatedChecks) {
  if (c.status === 'fail') problems.push(`automated check failed: ${c.name}`)
}
for (const c of data.checklist) {
  if (c.status === 'fail') problems.push(`self-review checklist failed: ${c.item}`)
}
for (const issue of data.issues) {
  if (issue.severity === 'blocking' && issue.fixed !== true) {
    problems.push(`unfixed blocking issue: ${issue.description}`)
  }
}

// ---- freshness: the review vouches for exact bytes, not "some version" ----
const root = path.resolve(options.root || process.cwd())
const reviewDir = path.dirname(path.resolve(file))
function resolveArtifact(rel) {
  const candidates = path.isAbsolute(rel)
    ? [rel]
    : [path.resolve(root, rel), path.resolve(reviewDir, '..', rel)]
  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}
for (const artifact of data.reviewedArtifacts) {
  const absolute = resolveArtifact(artifact.path)
  if (!absolute) {
    problems.push(`reviewed artifact not found: ${artifact.path}`)
    continue
  }
  let actual
  try {
    actual = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')
  } catch (err) {
    problems.push(`cannot hash reviewed artifact ${artifact.path}: ${err.message}`)
    continue
  }
  if (actual !== artifact.sha256.toLowerCase()) {
    problems.push(
      `stale review: ${artifact.path} changed after this review ` +
        `(reviewed ${artifact.sha256.slice(0, 12)}…, now ${actual.slice(0, 12)}…); ` +
        're-run the review on the current artifact',
    )
  }
}

// ---- density: objective signals + declared semantic units ----
let densitySummary = ''
if (options.storyboard && !options.script) {
  problems.push('--storyboard requires --script for the density gate')
} else if (options.script) {
  if (!Array.isArray(data.density) || data.density.length === 0) {
    problems.push(
      'density report is required: run density-report.mjs and record one entry per screen',
    )
  } else {
    let report
    try {
      report = buildDensityReport(options.script, options.storyboard || null)
    } catch (err) {
      problems.push(`cannot build density report: ${err.message}`)
    }
    if (report) {
      const byId = new Map(report.slides.map((slide) => [slide.slideId, slide]))
      const entries = new Map()
      for (const entry of data.density) {
        if (entries.has(entry.slideId)) {
          problems.push(`density report lists slide ${entry.slideId} more than once`)
        }
        entries.set(entry.slideId, entry)
        if (!byId.has(entry.slideId)) {
          problems.push(`density report references unknown slide ${entry.slideId}`)
        }
      }

      const required = options.slides || report.slides.map((slide) => slide.slideId)
      const missing = required.filter((id) => !entries.has(id))
      if (missing.length) {
        problems.push(`density report is missing screen(s): ${missing.join(', ')}`)
      }

      let units = 0
      let exceptions = 0
      for (const [id, entry] of entries) {
        const slide = byId.get(id)
        if (!slide) continue
        units += entry.semanticUnits.length
        if (entry.verdict === 'exception') exceptions += 1
        const diffs = compareSignals(entry.signals, slide.signals)
        if (diffs.length) {
          problems.push(
            `density signals for ${id} do not match the current script/storyboard: ${diffs.join('; ')}`,
          )
        }
        if (entry.semanticUnits.length > 1 && entry.verdict !== 'exception') {
          problems.push(
            `${id} declares ${entry.semanticUnits.length} semantic units but verdict is ` +
              `'${entry.verdict}'; split the screen or mark it 'exception' with a written reason`,
          )
        }
        if (entry.verdict === 'exception' && !String(entry.notes || '').trim()) {
          problems.push(`${id} is marked exception but has no notes explaining why`)
        }
        if (entry.verdict === 'fail') {
          problems.push(`${id} density verdict is fail; split or revise the screen before review`)
        }
      }
      densitySummary = `; density: ${required.length} screen(s), ${units} unit(s), ${exceptions} exception(s)`
    }
  }
}

// ---- concepts: the review must address every core concept in scope ----
let conceptSummary = ''
if (options.concepts) {
  let ledger
  try {
    ledger = readData(options.concepts)
  } catch (err) {
    problems.push(`cannot read concept ledger ${options.concepts}: ${err.message}`)
  }
  if (ledger) {
    const known = new Set((ledger.concepts || []).map((c) => c.id))
    const scope = options.slides ? new Set(options.slides) : null
    const required = (ledger.concepts || []).filter((concept) => {
      if (!scope) return true
      return [concept.introducedOn, ...(concept.reinforcedOn || []), ...(concept.assessedOn || [])].some(
        (id) => scope.has(id),
      )
    })
    const entries = new Map()
    for (const entry of data.concepts || []) {
      if (!known.has(entry.conceptId)) {
        problems.push(`concept review references unknown concept ${entry.conceptId}`)
        continue
      }
      if (entries.has(entry.conceptId)) {
        problems.push(`concept review lists ${entry.conceptId} more than once`)
      }
      entries.set(entry.conceptId, entry)
    }
    for (const concept of required) {
      const entry = entries.get(concept.id)
      if (!entry) {
        problems.push(`concept review is missing ${concept.id} (${concept.term})`)
        continue
      }
      if (entry.verdict !== 'pass') {
        problems.push(`concept review marks ${concept.id} as ${entry.verdict}`)
      }
      const slides = Array.isArray(entry.slideIds) ? new Set(entry.slideIds) : new Set()
      const inScopeRelated = [
        concept.introducedOn,
        ...(concept.reinforcedOn || []),
        ...(concept.assessedOn || []),
      ].filter((id) => !scope || scope.has(id))
      if (!inScopeRelated.some((id) => slides.has(id))) {
        problems.push(
          `concept review ${concept.id} must cite at least one in-scope slide (${inScopeRelated.join(', ')})`,
        )
      }
      if ((!scope || scope.has(concept.introducedOn)) && !slides.has(concept.introducedOn)) {
        problems.push(
          `concept review ${concept.id} must cite its introducing slide ${concept.introducedOn}`,
        )
      }
    }
    const missing = required.filter((concept) => !entries.has(concept.id))
    conceptSummary = `; concepts: ${required.length - missing.length}/${required.length}`
  }
}

if (problems.length) fail(`self-review ${file}`, problems)
else
  ok(
    `self-review ${file}`,
    `${data.stage}: ${data.automatedChecks.length} automated checks, ${data.issues.length} issue(s)${densitySummary}${conceptSummary}`,
  )
if (problems.length) process.exit(1)
