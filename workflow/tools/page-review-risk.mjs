#!/usr/bin/env node
// Calibration report for risk-based page review.
//
// This tool does NOT change the workflow. It scores each page from
// deterministic signals and compares the score with the historical page
// self-review issues. The output answers: "if low-risk pages skipped the AI
// review, which past findings would have been missed?"
import fs from 'node:fs'
import path from 'node:path'
import { readData } from './lib.mjs'
import { buildDensityReport } from './density-lib.mjs'
import { readSectionManifest } from './section-lib.mjs'
import { parseFlagValue } from './self-review-lib.mjs'

const args = process.argv.slice(2)
const lessonSlug = parseFlagValue(args, '--lesson-slug')
const scriptPath = parseFlagValue(args, '--script', lessonSlug ? `specs/${lessonSlug}/courseware.md` : '')
const storyboardPath = parseFlagValue(
  args,
  '--storyboard',
  lessonSlug ? `specs/${lessonSlug}/storyboard.yml` : '',
)
const sectionsPath = parseFlagValue(
  args,
  '--sections',
  lessonSlug ? `specs/${lessonSlug}/review-sections.yml` : '',
)
const deckPath = parseFlagValue(args, '--deck', lessonSlug ? `specs/${lessonSlug}/deck.json` : '')
const registryPath = parseFlagValue(args, '--registry', 'registry/index.json')
const conceptsPath = parseFlagValue(
  args,
  '--concepts',
  lessonSlug ? `specs/${lessonSlug}/concepts.yml` : '',
)
const referencePath = parseFlagValue(
  args,
  '--reference-adaptation',
  lessonSlug ? `review/${lessonSlug}/reference-adaptation.json` : '',
)
const reviewDir = parseFlagValue(args, '--review-dir', lessonSlug ? `review/${lessonSlug}` : 'review')
const includeArchiveSections = args.includes('--include-archive-sections')
const jsonOut = args.includes('--json')

if (!lessonSlug || !scriptPath || !storyboardPath || !sectionsPath || !deckPath) {
  console.error(
    'usage: node page-review-risk.mjs --lesson-slug <slug> [--script ... --storyboard ... --sections ... --deck ... --registry ... --concepts ... --reference-adaptation ... --review-dir ...] [--json]',
  )
  process.exit(2)
}

const manifest = readSectionManifest(sectionsPath)
const storyboard = readData(storyboardPath)
const boardById = new Map((storyboard.slides || []).map((slide) => [slide.id, slide]))
const deck = readData(deckPath)
const deckById = new Map((deck.slides || []).map((slide) => [slide.id, slide]))
const registry = fs.existsSync(registryPath) ? readData(registryPath) : { components: [] }
const coreComponents = new Set(
  (registry.components || []).filter((entry) => entry.status === 'core').map((entry) => entry.id),
)
const concepts = fs.existsSync(conceptsPath) ? readData(conceptsPath) : { concepts: [] }
const mapping = fs.existsSync(referencePath) ? readData(referencePath) : { entries: [] }
const density = buildDensityReport(scriptPath, storyboardPath)
const densityById = new Map((density.slides || []).map((slide) => [slide.slideId, slide]))

function historical(sectionId) {
  const candidates = [
    path.join(reviewDir, `self-review-page-${sectionId}.json`),
    path.join(reviewDir, `self-review-page-${sectionId}-components.json`),
  ]
  const issues = []
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    try {
      const review = readData(file)
      issues.push(
        ...(review.issues || []).filter(
          (issue) => !/^共享(文件|组件)/.test(String(issue.description || '')),
        ),
      )
    } catch {
      // ignore unreadable historical files
    }
  }
  if (includeArchiveSections && fs.existsSync('review/archive')) {
    for (const name of fs.readdirSync('review/archive')) {
      if (!/^self-review-section-.*\.json$/.test(name)) continue
      try {
        const review = readData(path.join('review/archive', name))
        issues.push(
          ...(review.issues || []).filter(
            (issue) =>
              !/^共享(文件|组件)/.test(String(issue.description || '')) &&
              String(issue.description || '').includes(sectionId),
          ),
        )
      } catch {
        // ignore unreadable archive files
      }
    }
  }
  return {
    real: issues.length,
    blocking: issues.filter((issue) => issue.severity === 'blocking').length,
    open: issues.filter((issue) => issue.fixed !== true && issue.severity !== 'blocking').length,
    issues: issues.map((issue) => ({
      severity: issue.severity,
      fixed: issue.fixed,
      description: String(issue.description || '').slice(0, 180),
    })),
  }
}

const rows = (manifest.sections || []).map((section) => {
  const slideId = section.slides[0]
  const slide = deckById.get(slideId) || {}
  const board = boardById.get(slideId) || {}
  const signals = densityById.get(slideId)?.signals || {}
  const component = slide.component || board.components?.[0] || ''
  const level = board.interaction?.level || ''
  const type = slide.type || board.type || ''
  const mappingEntries = (mapping.entries || []).filter((entry) =>
    (entry.pages || []).includes(slideId),
  )
  const conceptIntro = (concepts.concepts || []).some(
    (concept) => concept.introducedOn === slideId,
  )
  const customComponent = type === 'blank' && component && !coreComponents.has(component)
  const interactive = Boolean(level && !['watch', 'observe'].includes(level))
  const dense =
    (signals.screenChars || 0) > 350 ||
    (signals.codeLines || 0) > 10 ||
    (signals.contentRefs || 0) > 2 ||
    (signals.tableRows || 0) > 4 ||
    (signals.bulletItems || 0) > 6
  const quiz = type === 'quiz' || component === 'quiz-bank'
  const visual = ['matrix-lab', 'matrix-fill', 'matrix-basics', 'loop-trace', 'code-anatomy'].includes(component)
  const flags = []
  if (customComponent) flags.push('custom-component')
  if (interactive) flags.push('interactive')
  if (dense) flags.push('dense-signals')
  if (quiz) flags.push('quiz')
  if (visual) flags.push('visual')
  if (conceptIntro) flags.push('concept-intro')
  if (mappingEntries.length) flags.push('reference-map')
  const high = customComponent || dense || conceptIntro || mappingEntries.length > 0
  const medium = interactive || quiz || visual
  const risk = high ? 'high' : medium ? 'medium' : 'low'
  const hist = historical(section.id)
  return {
    section: section.id,
    slideId,
    title: slide.title || section.title,
    type,
    component,
    level,
    risk,
    flags,
    signals,
    historical: hist,
    wouldSkip: risk === 'low',
    missedBlocking: risk === 'low' && hist.blocking > 0,
    missedAny: risk === 'low' && hist.real > 0,
  }
})
const summary = {
  pages: rows.length,
  low: rows.filter((row) => row.risk === 'low').length,
  medium: rows.filter((row) => row.risk === 'medium').length,
  high: rows.filter((row) => row.risk === 'high').length,
  skipped: rows.filter((row) => row.wouldSkip).map((row) => row.section),
  missedBlocking: rows.filter((row) => row.missedBlocking).map((row) => row.section),
  missedAny: rows.filter((row) => row.missedAny).map((row) => row.section),
}
const report = { lessonSlug, summary, rows }
if (jsonOut) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  console.log(`Pages: ${summary.pages}; low=${summary.low} medium=${summary.medium} high=${summary.high}`)
  console.log(`Would skip: ${summary.skipped.join(', ') || 'none'}`)
  console.log(`Missed blocking: ${summary.missedBlocking.join(', ') || 'none'}`)
  console.log(`Missed any historical issue: ${summary.missedAny.join(', ') || 'none'}`)
  console.log('')
  console.log('page  risk    flags                              blocking  real  skip')
  for (const row of rows) {
    console.log(
      `${row.section.padEnd(5)} ${row.risk.padEnd(6)} ${(row.flags.join(',') || '-').padEnd(34)} ` +
        `${String(row.historical.blocking).padStart(8)} ${String(row.historical.real).padStart(5)}  ${row.wouldSkip ? 'yes' : 'no'}`,
    )
  }
}
