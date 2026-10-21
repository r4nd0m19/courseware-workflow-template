#!/usr/bin/env node
// Build the compact evidence bundle for the whole-script self-review.
//
// The reviewer needs the per-slide script text and the gate results, not the
// full 70KB+ courseware.md plus every upstream file. This tool parses the
// approved script once, runs the cheap script gates, and writes both:
//   - self-review-script-evidence.json (compact per-slide evidence)
//   - self-review-script.json (skeleton with hashes/checks pre-filled)
// The AI then fills only judgment fields (interaction-first, concepts, checklist).
// Density/segmenting is deliberately left to the rendered page self-review.
import fs from 'node:fs'
import path from 'node:path'
import { readData } from './lib.mjs'
import { parseScript } from './script-lib.mjs'
import {
  artifact,
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
const reviewSectionsPath = parseFlagValue(args, '--review-sections')
const reviewDir = parseFlagValue(args, '--review-dir', `review/${lessonSlug}`)
const evidencePath = parseFlagValue(
  args,
  '--evidence-out',
  path.join(reviewDir, 'self-review-script-evidence.json'),
)
const outPath = parseFlagValue(args, '--out', path.join(reviewDir, 'self-review-script.json'))
const mdPath = parseFlagValue(args, '--md', path.join(reviewDir, 'self-review-script.md'))

if (!lessonSlug || !scriptPath || !contentPath || !conceptsPath) {
  console.error(
    'usage: node build-script-review-evidence.mjs --lesson-slug <slug> --script <courseware.md> [--storyboard <storyboard.yml>] --content <content-pack.json> --style <style-pack.manifest.json> --concepts <concepts.yml> --registry <registry/index.json> --review-sections <review-sections.yml> --review-dir review/<slug> [--evidence-out <json>] [--out <review.json>] [--md <review.md>]',
  )
  process.exit(2)
}

const storyboardExists = Boolean(storyboardPath && fs.existsSync(storyboardPath))
const storyboard = storyboardExists ? readData(storyboardPath) : { slides: [] }
const boardById = new Map((storyboard.slides || []).map((slide) => [slide.id, slide]))
const parsed = parseScript(scriptPath)
const slides = []
for (const slide of parsed.slides) {
  if (slide.machine?.status === 'SKIP') continue
  const board = boardById.get(slide.id) || {}
  slides.push({
    id: slide.id,
    title: slide.headingTitle,
    objectiveId: slide.machine?.objectiveId || board.objectiveId || '',
    objective: board.objective || '',
    contentRefs: slide.machine?.contentRefs || board.contentRefs || [],
    components: slide.machine?.components || board.components || [],
    layout: slide.machine?.layout || board.layout || '',
    status: slide.machine?.status || board.status || '',
    screenContent: slide.screenContent,
    interactionDesign: slide.interactionDesign,
    narration: slide.narration,
    transition: slide.transition,
    interaction: slide.machine?.interaction || board.interaction || null,
    componentPlan: slide.machine?.componentPlan || null,
  })
}

// Cheap, deterministic gates. Expensive render/shell checks already ran in
// previous workflow steps; this bundle only re-reads the script-level facts.
const checks = []
const checkScript = runTool('check-script.mjs', [
  scriptPath,
  contentPath,
  stylePath,
  registryPath,
])
checks.push(checkScript)
const checkConcepts = runTool('check-concepts.mjs', [
  scriptPath,
  contentPath,
  ...(storyboardExists ? [storyboardPath] : []),
  '--concepts',
  conceptsPath,
])
checks.push(checkConcepts)
const quizKeys = runTool('check-quiz-keys.mjs', [
  scriptPath,
  '--content',
  contentPath,
  '--json',
])
checks.push(quizKeys)
let quizJson = null
try {
  quizJson = JSON.parse(quizKeys.stdout)
} catch {
  // The checker prints human-readable text when not asked for JSON; leave it
  // out rather than failing the evidence build.
}

// Density is intentionally absent here: segmenting is judged by the rendered
// page self-review, where the screenshot and the page evidence bundle exist.
// The script review must not duplicate that judgment or pay for its signals.

const feature = readData('.specify/feature.json')
const specPath = path.join(feature.feature_directory, 'spec.md')
const selfStudyAudit = path.join(reviewDir, 'self-study-audit.json')
const selfStudyApply = path.join(reviewDir, 'self-study-apply.json')
const selfStudyExists = fs.existsSync(selfStudyAudit) && fs.existsSync(selfStudyApply)
checks.push({
  name: 'self-study audit + apply',
  status: selfStudyExists ? 'pass' : 'skipped',
  notes: selfStudyExists
    ? 'audit and apply records present; workflow gate checked them'
    : 'no self-study audit/apply records in this run',
})

const failedChecks = checks.filter((check) => check.status === 'fail')
const artifacts = collectArtifacts([
  scriptPath,
  specPath,
  conceptsPath,
  reviewSectionsPath,
  contentPath,
  stylePath,
  registryPath,
  selfStudyExists ? selfStudyAudit : '',
  selfStudyExists ? selfStudyApply : '',
  evidencePath,
])

const evidence = {
  schemaVersion: '1.0',
  lessonSlug,
  script: artifact(scriptPath),
  spec: artifact(specPath),
  slides,
  checks: checks.map(({ stdout, stderr, ...rest }) => rest),
  quizKeys: quizJson,
  selfStudy: selfStudyExists ? summarizeSelfStudy(selfStudyAudit, selfStudyApply) : null,
}
fs.mkdirSync(path.dirname(path.resolve(evidencePath)), { recursive: true })
fs.writeFileSync(path.resolve(evidencePath), `${JSON.stringify(evidence)}\n`)

function summarizeSelfStudy(auditPath, applyPath) {
  try {
    const audit = readData(auditPath)
    const apply = readData(applyPath)
    return {
      auditVerdict: audit.verdict || '',
      pageBudget: audit.pageBudget || null,
      gapCount: Array.isArray(audit.gaps) ? audit.gaps.length : 0,
      supplementCount: Array.isArray(apply.supplements) ? apply.supplements.length : 0,
      applyVerdict: apply.verdict || '',
      changed: Boolean(apply.changed),
    }
  } catch (error) {
    return { error: error.message }
  }
}

const issues = failedChecks.map((check) => ({
  description: `${check.name}: ${check.notes}`,
  severity: 'blocking',
  fixed: false,
}))

const skeleton = {
  stage: 'script',
  artifactPaths: artifacts.map((item) => item.path),
  reviewedArtifacts: artifacts,
  automatedChecks: checks.map(({ stdout, stderr, ...rest }) => rest),
  checklist: [
    { item: '每一屏都有屏幕内容、交互设计、旁白、转场、制作字段', status: 'n/a' },
    { item: '屏幕文字与旁白分开，旁白是逐字稿', status: 'n/a' },
    { item: '每个交互都写清学生动作、成功反馈、错误反馈、完成条件、重置/重试', status: 'n/a' },
    { item: '错误反馈绑定具体误区', status: 'n/a' },
    { item: '每个 watch 屏都有静态替代和教学理由', status: 'n/a' },
    { item: '互动优先：每屏先尝试从内容推出的互动，非 watch 互动有可获得证据', status: 'n/a' },
    { item: '每个 objective 至少有一个非 watch 互动', status: 'n/a' },
    { item: '自动检查全部 pass（check-script / concepts / quiz keys）', status: 'n/a' },
    { item: '自学补充已应用，补丁有标签和依据，最终页数匹配 pageBudget.proposed', status: 'n/a' },
    { item: '无 TODO/TBD/占位内容，无个人信息', status: 'n/a' },
  ],
  issues,
  concepts: [],
  verdict: 'fail',
  reviewedAt: new Date().toISOString(),
}

writeSelfReview(skeleton, { outJson: outPath, outMd: mdPath })

if (failedChecks.length) {
  console.error(
    `FAIL script evidence — ${failedChecks.map((check) => check.name).join(', ')}`,
  )
  process.exit(1)
}
console.log(
  `OK script evidence — ${slides.length} slide(s), ${checks.length} check(s), ${evidencePath}`,
)
