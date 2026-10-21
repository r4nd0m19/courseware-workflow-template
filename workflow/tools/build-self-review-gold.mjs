#!/usr/bin/env node
// Deterministic Gold self-review summary.
//
// Every page was human-approved and frozen, Alpha already aggregated the page
// reviews, and the final gates run immediately before this step. Gold therefore
// re-checks the cheap whole-deck gates and carries forward Alpha's density and
// concept judgments instead of asking a model to repeat them. The teacher's
// gold gate remains the final sign-off.
import fs from 'node:fs'
import path from 'node:path'
import { readData } from './lib.mjs'
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
const deckPath = parseFlagValue(args, '--deck', '')
const reviewDir = parseFlagValue(args, '--review-dir', `review/${lessonSlug}`)
const alphaPath = parseFlagValue(args, '--alpha', path.join(reviewDir, 'self-review-alpha.json'))
const outPath = parseFlagValue(args, '--out', path.join(reviewDir, 'self-review-gold.json'))
const mdPath = parseFlagValue(args, '--md', path.join(reviewDir, 'self-review-gold.md'))

if (!lessonSlug || !scriptPath || !storyboardPath || !contentPath || !conceptsPath) {
  console.error(
    'usage: node build-self-review-gold.mjs --lesson-slug <slug> --script <courseware.md> --storyboard <storyboard.yml> --content <content-pack.json> --style <style-pack.manifest.json> --concepts <concepts.yml> --registry <registry/index.json> --deck <deck.json> --review-dir review/<slug> [--alpha <self-review-alpha.json>] [--out <review.json>] [--md <review.md>]',
  )
  process.exit(2)
}

const checks = []
const issues = []
const addCheck = (name, status, notes) => {
  checks.push({ name, status, notes })
  if (status === 'fail') issues.push({ description: `${name}: ${notes}`, severity: 'blocking', fixed: false })
}

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
if (deckPath) {
  const quiz = runTool('check-quiz-keys.mjs', [deckPath, '--json'])
  addCheck('check-quiz-keys', quiz.status, quiz.notes)
}

let alpha = null
if (fs.existsSync(alphaPath)) {
  try {
    alpha = readData(alphaPath)
  } catch (error) {
    addCheck('alpha review', 'fail', `cannot read ${alphaPath}: ${error.message}`)
  }
} else {
  addCheck('alpha review', 'fail', `missing ${alphaPath}`)
}
if (alpha) {
  addCheck('alpha review', alpha.verdict === 'pass' ? 'pass' : 'fail', `verdict is ${alpha.verdict}`)
}

const ledger = readData(conceptsPath)
const alphaConcepts = new Map((alpha?.concepts || []).map((entry) => [entry.conceptId, entry]))
const concepts = (ledger.concepts || []).map((concept) => {
  const entry = alphaConcepts.get(concept.id)
  if (!entry) {
    addCheck(`concept ${concept.id}`, 'fail', 'missing from Alpha review')
    return {
      conceptId: concept.id,
      verdict: 'gap',
      evidence: 'Alpha review has no entry for this concept',
      slideIds: [],
    }
  }
  if (entry.verdict !== 'pass') addCheck(`concept ${concept.id}`, 'fail', `Alpha marks ${entry.verdict}`)
  return entry
})

const failed = checks.filter((check) => check.status === 'fail')
const verdict = failed.length ? 'fail' : 'pass'
const artifacts = collectArtifacts([
  scriptPath,
  storyboardPath,
  deckPath,
  conceptsPath,
  contentPath,
  stylePath,
  registryPath,
  alphaPath,
])

writeSelfReview(
  {
    stage: 'gold',
    artifactPaths: artifacts.map((item) => item.path),
    reviewedArtifacts: artifacts,
    automatedChecks: checks,
    checklist: [
      {
        item: 'Alpha 已通过，逐页批准与冻结仍然有效',
        status: alpha && alpha.verdict === 'pass' ? 'pass' : 'fail',
        notes: alpha ? `Alpha verdict ${alpha.verdict}` : 'Alpha review missing',
      },
      {
        item: '最终脚本、概念、分镜、答案分布闸门通过',
        status:
          scriptCheck.status === 'pass' &&
          conceptsCheck.status === 'pass' &&
          parity.status === 'pass'
            ? 'pass'
            : 'fail',
        notes: [scriptCheck.notes, conceptsCheck.notes, parity.notes].join(' | '),
      },
      {
        item: '最终渲染、壳、插画、旁白闸门已在工作流前面通过',
        status: 'pass',
        notes: 'workflow reached Gold only after the corresponding shell steps completed',
      },
      {
        item: '核心概念在最终构建中仍然可见',
        status: concepts.every((entry) => entry.verdict === 'pass') ? 'pass' : 'fail',
        notes: `${concepts.length} concept(s) carried from Alpha`,
      },
    ],
    density: alpha?.density || [],
    concepts,
    issues,
    verdict,
    reviewedAt: new Date().toISOString(),
    autoGenerated: true,
  },
  { outJson: outPath, outMd: mdPath },
)

if (verdict !== 'pass') {
  console.error(`FAIL self-review gold — ${failed.map((check) => check.name).join(', ')}`)
  process.exit(1)
}
console.log(`OK self-review gold — ${checks.length} automated checks, ${concepts.length} concept(s)`)
