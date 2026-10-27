#!/usr/bin/env node
// Build the compact evidence + skeleton for the single-shot brief self-review.
// The reviewer gets the spec, content items, style vocabulary, constitution and
// the deterministic input checks; it never explores the repository.
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
const contentPath = parseFlagValue(args, '--content')
const stylePath = parseFlagValue(args, '--style')
const conceptsPath = parseFlagValue(args, '--concepts')
const constitutionPath = parseFlagValue(args, '--constitution', '.specify/memory/constitution.md')
const inputsReviewPath = parseFlagValue(
  args,
  '--inputs-review',
  path.join('review', lessonSlug, 'self-review-inputs.json'),
)
const reviewDir = parseFlagValue(args, '--review-dir', path.join('review', lessonSlug))
const evidencePath = parseFlagValue(args, '--out', path.join(reviewDir, 'brief-review-evidence.json'))
const reviewJson = parseFlagValue(args, '--review-json', path.join(reviewDir, 'self-review-brief.json'))
const reviewMd = parseFlagValue(args, '--md', path.join(reviewDir, 'self-review-brief.md'))

if (!lessonSlug || !contentPath || !stylePath || !conceptsPath) {
  console.error(
    'usage: node build-brief-review-evidence.mjs --lesson-slug <slug> --content <content-pack.json> --style <style-pack.manifest.json> --concepts <concepts.yml> [--constitution <file>] [--inputs-review <self-review-inputs.json>] [--review-dir review/<slug>] [--out <evidence.json>] [--review-json <review.json>] [--md <review.md>]',
  )
  process.exit(2)
}

const feature = readData('.specify/feature.json')
const specPath = path.join(feature.feature_directory, 'spec.md')
function readText(file) {
  return fs.existsSync(path.resolve(file)) ? fs.readFileSync(path.resolve(file), 'utf8') : ''
}
function styleVocabulary(style) {
  const ids = (value) => Array.isArray(value) ? value.map((item) => item.id || item.name || item) : Object.keys(value || {})
  return {
    components: ids(style.components),
    layouts: ids(style.layouts),
  }
}

const content = readData(contentPath)
const style = readData(stylePath)
const inputsReview = fs.existsSync(path.resolve(inputsReviewPath)) ? readData(inputsReviewPath) : null
let checks = Array.isArray(inputsReview?.automatedChecks)
  ? inputsReview.automatedChecks.map(({ name, status, notes }) => ({ name, status, notes }))
  : []
if (!checks.length) {
  const result = runTool('check-concepts.mjs', ['--ledger-only', contentPath, '--concepts', conceptsPath])
  checks = [{ name: 'check-concepts ledger', status: result.status, notes: result.notes }]
}
const failedChecks = checks.filter((check) => check.status === 'fail')
const artifacts = collectArtifacts([
  specPath,
  conceptsPath,
  contentPath,
  stylePath,
  constitutionPath,
  inputsReviewPath,
])
const evidence = {
  schemaVersion: '1.0',
  mode: 'brief',
  lessonSlug,
  spec: { path: specPath, text: readText(specPath) },
  concepts: { path: conceptsPath, text: readText(conceptsPath) },
  content: {
    path: contentPath,
    items: (content.items || []).map((item) => ({
      id: item.id,
      title: item.title,
      kind: item.kind,
      required: item.required,
      reviewed: item.reviewed,
      text: item.text,
    })),
  },
  style: { path: stylePath, ...styleVocabulary(style) },
  constitution: { path: constitutionPath, text: readText(constitutionPath) },
  checks,
}
fs.mkdirSync(path.dirname(path.resolve(evidencePath)), { recursive: true })
fs.writeFileSync(path.resolve(evidencePath), `${JSON.stringify(evidence, null, 2)}\n`)

const checklist = [
  { item: '目标同时包含学习动作与概念', status: 'n/a' },
  { item: '误区有来源，并在评估/反馈中被处理', status: 'n/a' },
  { item: '评估证据出现在需要它的活动之前', status: 'n/a' },
  { item: '每个 required 内容项都有覆盖映射', status: 'n/a' },
  { item: '没有自造参考内容；开放问题/豁免可见', status: 'n/a' },
  {
    item: '核心概念台账完整：定义、引入页、mustAppear 短语、可观察证据、sourceRefs',
    status: 'n/a',
  },
  { item: '概念不只存在于旁白或代码声明中', status: 'n/a' },
]
const skeleton = {
  stage: 'brief',
  artifactPaths: artifacts.map((item) => item.path),
  reviewedArtifacts: artifacts,
  automatedChecks: checks,
  checklist,
  issues: failedChecks.map((check) => ({
    description: `${check.name}: ${check.notes}`,
    severity: 'blocking',
    fixed: false,
  })),
  verdict: 'fail',
  reviewedAt: new Date().toISOString(),
  reviewMeta: { mode: 'brief' },
}
writeSelfReview(skeleton, { outJson: reviewJson, outMd: reviewMd })
if (failedChecks.length) {
  console.error(`FAIL brief review evidence — ${failedChecks.map((check) => check.name).join(', ')}`)
  process.exit(1)
}
console.log(`OK brief review evidence — ${evidencePath}`)
