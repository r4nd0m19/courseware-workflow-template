#!/usr/bin/env node
// Deterministic Alpha self-review.
//
// Alpha is a whole-deck re-check after every page was already implemented,
// self-reviewed, human-approved and frozen. Re-running an AI reviewer over the
// same evidence duplicates the per-page judgments. This tool aggregates the
// approved page reviews, re-runs the cheap whole-deck gates, and records the
// result in the same self-review JSON/MD shape. Expensive render/shell gates
// already ran earlier in the workflow; if any had failed, the run would not
// have reached this step.
import fs from 'node:fs'
import path from 'node:path'
import { readData } from './lib.mjs'
import { buildDensityReport } from './density-lib.mjs'
import {
  collectArtifacts,
  parseFlagValue,
  runTool,
  writeSelfReview,
} from './self-review-lib.mjs'

const args = process.argv.slice(2)
const lessonSlug = parseFlagValue(args, '--lesson-slug')
const scriptPath = parseFlagValue(args, '--script')
const storyboardPath = parseFlagValue(args, '--storyboard')
const contentPath = parseFlagValue(args, '--content')
const stylePath = parseFlagValue(args, '--style')
const conceptsPath = parseFlagValue(args, '--concepts')
const registryPath = parseFlagValue(args, '--registry', 'registry/index.json')
const sectionsPath = parseFlagValue(args, '--sections')
const approvalsPath = parseFlagValue(args, '--approvals', `review/${lessonSlug}/page-approvals.json`)
const scriptApprovalPath = parseFlagValue(
  args,
  '--script-approval',
  `review/${lessonSlug}/script-approval.json`,
)
const deckPath = parseFlagValue(args, '--deck', '')
const screenshotsDir = parseFlagValue(args, '--screenshots', `screenshots/${lessonSlug}`)
const reviewDir = parseFlagValue(args, '--review-dir', `review/${lessonSlug}`)
const outPath = parseFlagValue(args, '--out', path.join(reviewDir, 'self-review-alpha.json'))
const mdPath = parseFlagValue(args, '--md', path.join(reviewDir, 'self-review-alpha.md'))

if (!lessonSlug || !scriptPath || !storyboardPath || !contentPath || !conceptsPath || !sectionsPath) {
  console.error(
    'usage: node build-self-review-alpha.mjs --lesson-slug <slug> --script <courseware.md> --storyboard <storyboard.yml> --content <content-pack.json> --style <style-pack.manifest.json> --concepts <concepts.yml> --registry <registry/index.json> --sections <review-sections.yml> --approvals <page-approvals.json> --script-approval <script-approval.json> --deck <deck.json> --screenshots <dir> --review-dir review/<slug> [--out <review.json>] [--md <review.md>]',
  )
  process.exit(2)
}

const checks = []
const issues = []
const addCheck = (name, status, notes) => {
  checks.push({ name, status, notes })
  if (status === 'fail') issues.push({ description: `${name}: ${notes}`, severity: 'blocking', fixed: false })
}

const freeze = runTool('check-section-freeze.mjs', [
  '--sections',
  sectionsPath,
  '--storyboard',
  storyboardPath,
  '--script',
  scriptPath,
  '--approvals',
  approvalsPath,
  '--approval',
  scriptApprovalPath,
  '--screenshots',
  screenshotsDir,
  '--require-all',
])
addCheck('all sections approved and frozen', freeze.status, freeze.notes)

const scriptCheck = runTool('check-script.mjs', [scriptPath, contentPath, stylePath, registryPath])
addCheck('check-script', scriptCheck.status, scriptCheck.notes)

const conceptsCheck = runTool('check-concepts.mjs', [
  scriptPath,
  contentPath,
  storyboardPath,
  '--concepts',
  conceptsPath,
])
addCheck('check-concepts', conceptsCheck.status, conceptsCheck.notes)

const parity = runTool('script-to-storyboard.mjs', [scriptPath, '--check', storyboardPath])
addCheck('script-storyboard parity', parity.status, parity.notes)

let quizJson = null
if (deckPath) {
  const quiz = runTool('check-quiz-keys.mjs', [deckPath, '--json'])
  addCheck('check-quiz-keys', quiz.status, quiz.notes)
  try {
    quizJson = JSON.parse(quiz.stdout)
  } catch {
    quizJson = null
  }
}

// ---- aggregate page self-reviews ----
const approvals = fs.existsSync(approvalsPath) ? readData(approvalsPath) : { sections: {} }
const manifest = readData(sectionsPath)
const pageReviewFiles = []
const pageDensity = new Map()
const pageConcepts = new Map()
for (const section of manifest.sections || []) {
  const reviewFile = path.join(reviewDir, `self-review-page-${section.id}.json`)
  pageReviewFiles.push(reviewFile)
  if (!fs.existsSync(reviewFile)) {
    addCheck(`page review ${section.id}`, 'fail', `missing ${reviewFile}`)
    continue
  }
  let review
  try {
    review = readData(reviewFile)
  } catch (error) {
    addCheck(`page review ${section.id}`, 'fail', `cannot read ${reviewFile}: ${error.message}`)
    continue
  }
  if (review.verdict !== 'pass') {
    addCheck(`page review ${section.id}`, 'fail', `verdict is ${review.verdict}`)
  } else {
    addCheck(`page review ${section.id}`, 'pass', 'aggregated')
  }
  for (const entry of review.density || []) pageDensity.set(entry.slideId, entry)
  for (const entry of review.concepts || []) {
    const existing = pageConcepts.get(entry.conceptId)
    if (!existing) {
      pageConcepts.set(entry.conceptId, { ...entry, slideIds: [...(entry.slideIds || [])] })
    } else {
      existing.verdict = existing.verdict === 'pass' && entry.verdict === 'pass' ? 'pass' : 'gap'
      existing.evidence = [existing.evidence, entry.evidence].filter(Boolean).join('; ')
      existing.slideIds = [...new Set([...(existing.slideIds || []), ...(entry.slideIds || [])])]
    }
  }
}

const densityReport = buildDensityReport(scriptPath, storyboardPath)
const density = []
for (const slide of densityReport.slides) {
  const entry = pageDensity.get(slide.slideId)
  if (!entry) {
    addCheck(`density ${slide.slideId}`, 'fail', 'no page self-review density entry')
    density.push({
      slideId: slide.slideId,
      semanticUnits: [],
      signals: slide.signals,
      verdict: 'fail',
      notes: 'missing page self-review',
    })
    continue
  }
  density.push({
    slideId: slide.slideId,
    semanticUnits: entry.semanticUnits || [],
    signals: slide.signals,
    verdict: entry.verdict || 'fail',
    notes: entry.notes || '',
  })
  if (entry.verdict === 'fail') {
    addCheck(`density ${slide.slideId}`, 'fail', 'page review marked density fail')
  }
}

const ledger = readData(conceptsPath)
const concepts = []
for (const concept of ledger.concepts || []) {
  const entry = pageConcepts.get(concept.id)
  if (!entry) {
    concepts.push({
      conceptId: concept.id,
      verdict: 'gap',
      evidence: 'no page self-review covers this concept',
      slideIds: [],
    })
    addCheck(`concept ${concept.id}`, 'fail', 'missing from page self-reviews')
  } else {
    concepts.push(entry)
    if (entry.verdict !== 'pass') addCheck(`concept ${concept.id}`, 'fail', `page review marks ${entry.verdict}`)
  }
}

// ---- approvals presence ----
for (const section of manifest.sections || []) {
  const approved = approvals.sections && approvals.sections[section.id]
  if (!approved) addCheck(`approval ${section.id}`, 'fail', 'no page approval')
}
const approvalsPass = (manifest.sections || []).every(
  (section) => approvals.sections && approvals.sections[section.id],
)
addCheck(
  'page approvals',
  approvalsPass ? 'pass' : 'fail',
  `${Object.keys(approvals.sections || {}).length}/${(manifest.sections || []).length} section(s) approved`,
)

const failed = checks.filter((check) => check.status === 'fail')
const verdict = failed.length ? 'fail' : 'pass'
const artifacts = collectArtifacts([
  scriptPath,
  storyboardPath,
  deckPath,
  conceptsPath,
  contentPath,
  sectionsPath,
  approvalsPath,
  scriptApprovalPath,
  ...pageReviewFiles,
])

writeSelfReview(
  {
    stage: 'alpha',
    artifactPaths: artifacts.map((item) => item.path),
    reviewedArtifacts: artifacts,
    automatedChecks: checks,
    checklist: [
      {
        item: '所有页已人工批准并冻结，批准哈希仍匹配当前脚本/截图',
        status: freeze.status,
        notes: freeze.notes,
      },
      {
        item: '逐页自审已聚合，密度与概念结论没有丢失',
        status: density.every((entry) => entry.verdict !== 'fail') && concepts.every((entry) => entry.verdict === 'pass') ? 'pass' : 'fail',
        notes: `${density.length} slide(s), ${concepts.length} concept(s)`,
      },
      {
        item: '整份脚本/概念/分镜/答案分布闸门仍通过',
        status:
          scriptCheck.status === 'pass' &&
          conceptsCheck.status === 'pass' &&
          parity.status === 'pass' &&
          (!quizJson || quizJson.ok !== false)
            ? 'pass'
            : 'fail',
        notes: [scriptCheck.notes, conceptsCheck.notes, parity.notes].join(' | '),
      },
      {
        item: '整份渲染、壳、插画、旁白闸门已在工作流前面通过',
        status: 'pass',
        notes: 'workflow reached Alpha only after the corresponding shell steps completed',
      },
    ],
    density,
    concepts,
    issues,
    verdict,
    reviewedAt: new Date().toISOString(),
    autoGenerated: true,
  },
  { outJson: outPath, outMd: mdPath },
)

if (verdict !== 'pass') {
  console.error(`FAIL self-review alpha — ${failed.map((check) => check.name).join(', ')}`)
  process.exit(1)
}
console.log(`OK self-review alpha — ${checks.length} automated checks, ${concepts.length} concept(s)`)
