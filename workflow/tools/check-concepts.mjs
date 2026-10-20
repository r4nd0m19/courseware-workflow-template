#!/usr/bin/env node
// Blocking concept-coverage gate.
//
// A content item can be "covered" while the concept it names is never
// explained on screen. This gate makes the concept ledger (next to the
// courseware script, concepts.yml by default) the source of truth:
//   - every concept names the slide that introduces it;
//   - that slide's 屏幕内容 must contain the concept term and every
//     mustAppear phrase (punctuation/whitespace normalized);
//   - reinforced/assessed slides must exist and must not precede introduction;
//   - sourceRefs, when present, must exist in the content pack and be
//     referenced by the introducing slide.
//
// The ledger is intentionally human-readable. The definition is for the
// teacher and the self-review; mustAppear is the mechanical contract.
import fs from 'node:fs'
import path from 'node:path'
import { readData, validateWithSchema, fail, ok } from './lib.mjs'
import { parseScript, normalizeForMatch } from './script-lib.mjs'

const args = process.argv.slice(2)
const options = { concepts: '', slides: null, ledgerOnly: false }
const positionals = []
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--concepts') {
    options.concepts = args[i + 1] || ''
    i += 1
  } else if (arg === '--ledger-only') {
    options.ledgerOnly = true
  } else if (arg === '--slides') {
    options.slides = new Set(
      String(args[i + 1] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    i += 1
  } else if (arg.startsWith('--')) {
    console.error(`unknown option ${arg}`)
    process.exit(2)
  } else {
    positionals.push(arg)
  }
}

const [scriptPath, contentPath, storyboardPath] = positionals
const ledgerOnly = options.ledgerOnly
if (ledgerOnly ? !scriptPath || !options.concepts : !scriptPath || !contentPath) {
  console.error(`usage: node check-concepts.mjs <courseware.md> <content-pack.json> [storyboard.yml] [options]
       node check-concepts.mjs --ledger-only <content-pack.json> --concepts <file>

Options:
  --concepts <file>   concept ledger (default: concepts.yml next to courseware.md)
  --slides S02A,S03   only check concepts introduced/reinforced/assessed on these slides
  --ledger-only       validate the ledger and its content refs before the script exists

Checks that each core concept is actually defined on its introducing slide's
屏幕内容, not merely referenced by a content item.
`)
  process.exit(2)
}

const resolvedScriptPath = ledgerOnly ? null : scriptPath
const resolvedContentPath = ledgerOnly ? scriptPath : contentPath
const resolvedStoryboardPath = ledgerOnly ? null : storyboardPath

const ledgerPath = options.concepts
  ? path.resolve(options.concepts)
  : path.join(path.dirname(path.resolve(resolvedScriptPath)), 'concepts.yml')
if (!fs.existsSync(ledgerPath)) {
  console.error(`FAIL concept coverage\n  concept ledger not found: ${ledgerPath}`)
  process.exit(1)
}

let ledger
try {
  ledger = readData(ledgerPath)
} catch (err) {
  console.error(`FAIL concept coverage\n  cannot read ${ledgerPath}: ${err.message}`)
  process.exit(1)
}

const errors = []
const schemaCheck = validateWithSchema(
  new URL('../schemas/concepts.schema.json', import.meta.url).pathname,
  ledger,
)
for (const e of schemaCheck.errors) errors.push(`ledger ${e}`)
if (errors.length) {
  fail('concept coverage', errors)
  process.exit(1)
}

let content
let storyboard = null
let parsed = null
try {
  content = readData(resolvedContentPath)
  if (!ledgerOnly) {
    parsed = parseScript(resolvedScriptPath)
    if (resolvedStoryboardPath) storyboard = readData(resolvedStoryboardPath)
  }
} catch (err) {
  console.error(`FAIL concept coverage\n  ${err.message}`)
  process.exit(1)
}

if (parsed?.frontmatter.lesson && ledger.lesson !== parsed.frontmatter.lesson) {
  errors.push(
    `ledger lesson "${ledger.lesson}" does not match script lesson "${parsed.frontmatter.lesson}"`,
  )
}

const contentItems = new Map((content.items || []).map((item) => [item.id, item]))
const scriptSlides = new Map((parsed?.slides || []).map((slide) => [slide.id, slide]))
const slideOrder = new Map((parsed?.slides || []).map((slide, index) => [slide.id, index]))
const storyboardSlides = storyboard
  ? new Map((storyboard.slides || []).map((slide) => [slide.id, slide]))
  : null

const seenIds = new Set()
const inScope = []
for (const concept of ledger.concepts) {
  const where = concept.id
  if (seenIds.has(concept.id)) errors.push(`${where}: duplicate concept id`)
  seenIds.add(concept.id)

  if (!ledgerOnly) {
    if (!scriptSlides.get(concept.introducedOn)) {
      errors.push(`${where}: introducedOn ${concept.introducedOn} is not a slide in the script`)
    }
    if (storyboardSlides) {
      const storySlide = storyboardSlides.get(concept.introducedOn)
      if (!storySlide) {
        errors.push(`${where}: introducedOn ${concept.introducedOn} is not in the storyboard`)
      } else if (storySlide.status === 'SKIP') {
        errors.push(`${where}: introducedOn ${concept.introducedOn} is SKIP`)
      } else if (concept.sourceRefs?.length) {
        const refs = new Set(storySlide.contentRefs || [])
        const missingRefs = concept.sourceRefs.filter((ref) => !refs.has(ref))
        if (missingRefs.length) {
          errors.push(
            `${where}: introducing slide ${concept.introducedOn} does not reference sourceRefs ${missingRefs.join(', ')}`,
          )
        }
      }
    }
  }

  for (const ref of concept.sourceRefs || []) {
    if (!contentItems.has(ref)) {
      errors.push(`${where}: sourceRef ${ref} does not exist in the content pack`)
    }
  }

  const related = ledgerOnly
    ? []
    : [concept.introducedOn, ...(concept.reinforcedOn || []), ...(concept.assessedOn || [])]
  if (!ledgerOnly) {
    for (const slideId of new Set(related)) {
      if (!scriptSlides.has(slideId)) {
        errors.push(`${where}: slide ${slideId} is not in the script`)
        continue
      }
      if (storyboardSlides && !storyboardSlides.has(slideId)) {
        errors.push(`${where}: slide ${slideId} is not in the storyboard`)
        continue
      }
      if (storyboardSlides && storyboardSlides.get(slideId).status === 'SKIP') {
        errors.push(`${where}: slide ${slideId} is SKIP`)
      }
    }

    const introducedOrder = slideOrder.get(concept.introducedOn)
    for (const slideId of [...(concept.reinforcedOn || []), ...(concept.assessedOn || [])]) {
      const order = slideOrder.get(slideId)
      if (introducedOrder != null && order != null && order < introducedOrder) {
        errors.push(`${where}: slide ${slideId} precedes introduction ${concept.introducedOn}`)
      }
    }

    const targetSlide = scriptSlides.get(concept.introducedOn)
    if (targetSlide) {
      const screen = normalizeForMatch(targetSlide.screenContent)
      const term = normalizeForMatch(concept.term)
      if (!term || !screen.includes(term)) {
        errors.push(
          `${where}: introducing slide ${concept.introducedOn} 屏幕内容 does not contain term "${concept.term}"`,
        )
      }
      for (const phrase of concept.mustAppear) {
        const needle = normalizeForMatch(phrase)
        if (!needle || !screen.includes(needle)) {
          errors.push(
            `${where}: introducing slide ${concept.introducedOn} 屏幕内容 is missing required phrase "${phrase}"`,
          )
        }
      }
    }
  }

  const scopedSlides = ledgerOnly
    ? []
    : options.slides
      ? related.filter((id) => options.slides.has(id))
      : related
  if (ledgerOnly || !options.slides || scopedSlides.length) {
    inScope.push({ concept, slides: [...new Set(scopedSlides)] })
  }
}

const checked = inScope.length
const scopeLabel = ledgerOnly
  ? 'ledger-only'
  : options.slides
    ? [...options.slides].join(',')
    : 'all slides'
const summary = ledgerOnly
  ? `${ledger.concepts.length} concept(s) in ledger, schema and source refs valid (ledger-only)`
  : `${ledger.concepts.length} concept(s) in ledger, ${checked} in scope, ${scopeLabel}`

if (errors.length) {
  fail('concept coverage', errors)
  process.exit(1)
}
ok('concept coverage', summary)
