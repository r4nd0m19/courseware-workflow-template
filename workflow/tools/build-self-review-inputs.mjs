#!/usr/bin/env node
// Deterministic self-review for the inputs stage.
//
// The workflow has already run the input gates (content schema, style pack,
// source fidelity, shell preview, registry). This tool turns those results
// plus the content-pack-specific rules into the same self-review JSON/MD that
// the old AI prompt produced, without spawning another model.
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
const styleFullPath = parseFlagValue(args, '--style-full')
const styleFreezePath = parseFlagValue(args, '--style-freeze')
const sourcePath = parseFlagValue(args, '--source')
const fidelityPath = parseFlagValue(args, '--fidelity')
const registryPath = parseFlagValue(args, '--registry', 'registry/index.json')
const shellOk = parseFlagValue(args, '--shell-ok')
const shellReview = parseFlagValue(args, '--shell-review')
const outPath = parseFlagValue(args, '--out', `review/${lessonSlug}/self-review-inputs.json`)
const mdPath = parseFlagValue(args, '--md', `review/${lessonSlug}/self-review-inputs.md`)

if (!lessonSlug || !contentPath) {
  console.error(
    'usage: node build-self-review-inputs.mjs --lesson-slug <slug> --content <content-pack.json> --style <style-pack.manifest.json> --style-full <style-pack.full.json> --style-freeze <style-pack.freeze.json> --source <SOURCE.json> --fidelity <fidelity.json> --registry <registry/index.json> --shell-ok true|false [--shell-review <review/shells/<slug>/shell-preview.md>] --out <review.json> --md <review.md>',
  )
  process.exit(2)
}

const automatedChecks = []
const issues = []
const checklist = []
const addCheck = (name, status, notes) => automatedChecks.push({ name, status, notes })
const addIssue = (description, severity = 'blocking') =>
  issues.push({ description, severity, fixed: false })

// ---- content pack schema + semantic rules ----
const schemaCheck = runTool('validate-json.mjs', [
  'workflow/schemas/content-pack.schema.json',
  contentPath,
])
addCheck('content pack schema', schemaCheck.status, schemaCheck.notes)
if (schemaCheck.status !== 'pass') addIssue(`content pack schema failed: ${schemaCheck.notes}`)

let content = null
try {
  content = readData(contentPath)
} catch (error) {
  addIssue(`cannot read content pack ${contentPath}: ${error.message}`)
}

const contentProblems = []
if (content) {
  for (const item of content.items || []) {
    if (item.reviewStatus !== 'reviewed') {
      contentProblems.push(`${item.id || '(no id)'} is not reviewed (reviewStatus=${item.reviewStatus || 'missing'})`)
    }
    if (item.sensitivity === 'personal') {
      contentProblems.push(`${item.id || '(no id)'} is marked personal`)
    }
    if (item.kind === 'quiz') {
      const options = Array.isArray(item.options) ? item.options : []
      const correct = options.filter((option) => option.correct === true)
      if (correct.length !== 1) {
        contentProblems.push(`${item.id || '(no id)'} has ${correct.length} correct options (expected 1)`)
      }
      for (const [index, option] of options.entries()) {
        if (!String(option.feedback || '').trim()) {
          contentProblems.push(`${item.id || '(no id)'} option ${index + 1} has no feedback`)
        }
      }
    }
  }
}
addCheck(
  'content pack review + quiz feedback',
  contentProblems.length ? 'fail' : 'pass',
  contentProblems.length ? contentProblems.join('; ') : 'all items reviewed; one correct option and per-option feedback',
)
for (const problem of contentProblems) addIssue(problem)

checklist.push({
  item: '内容包全部条目已复核，无 draft/personal 条目',
  status: contentProblems.some((p) => p.includes('not reviewed') || p.includes('personal')) ? 'fail' : 'pass',
  notes: '由 build-self-review-inputs 直接检查 content pack',
})
checklist.push({
  item: '每道选择题恰好一个正确项，每个选项都有反馈',
  status: contentProblems.some((p) => p.includes('correct option') || p.includes('feedback')) ? 'fail' : 'pass',
  notes: '由 build-self-review-inputs 直接检查 content pack',
})
checklist.push({
  item: 'required 内容条目未被删除',
  status: 'n/a',
  notes: '由后续 check-coverage 对脚本/分镜执行',
})

// ---- style pack / source fidelity / registry ----
const styleCheck = runTool('validate-style-pack.mjs', [
  styleFullPath,
  '--check-baselines',
  '--freeze',
  styleFreezePath,
])
addCheck('style pack full + freeze', styleCheck.status, styleCheck.notes)
if (styleCheck.status !== 'pass') addIssue(`style pack failed: ${styleCheck.notes}`)

const sourceCheck = runTool('check-source-fidelity.mjs', [
  '--source',
  sourcePath,
  '--fidelity',
  fidelityPath,
  '--source-only',
])
addCheck('source fidelity', sourceCheck.status, sourceCheck.notes)
if (sourceCheck.status !== 'pass') addIssue(`source fidelity failed: ${sourceCheck.notes}`)

const registryCheck = runTool('check-registry.mjs', [
  registryPath,
  '--style-pack',
  stylePath,
  '--project-root',
  '.',
])
addCheck('component registry', registryCheck.status, registryCheck.notes)
if (registryCheck.status !== 'pass') addIssue(`registry failed: ${registryCheck.notes}`)

checklist.push({
  item: '风格包已冻结且基线存在，参考源码哈希未变',
  status: styleCheck.status === 'pass' && sourceCheck.status === 'pass' ? 'pass' : 'fail',
  notes: 'validate-style-pack --check-baselines --freeze + check-source-fidelity --source-only',
})
checklist.push({
  item: '组件注册表通过校验，无课件级样式覆盖',
  status: registryCheck.status,
  notes: 'check-registry --style-pack',
})

// ---- shell preview ----
const shellReviewExists = shellReview && fs.existsSync(shellReview)
const shellPass = String(shellOk).toLowerCase() === 'true' && shellReviewExists
addCheck(
  'shell preview',
  shellPass ? 'pass' : 'fail',
  shellPass
    ? `validate-shell ok; review file ${shellReview}`
    : `validate-shell ok=${shellOk || 'missing'}; review file ${shellReview || 'missing'}`,
)
if (!shellPass) addIssue('shell preview did not pass or its review file is missing')
checklist.push({
  item: '壳包校验通过，预览 deck 覆盖全部原生类型且主要互动可用',
  status: shellPass ? 'pass' : 'fail',
  notes: 'validate-shell --serve-preview --json',
})

// ---- verdict ----
const failed = automatedChecks.filter((check) => check.status === 'fail')
const verdict = failed.length === 0 ? 'pass' : 'fail'
const artifacts = collectArtifacts([
  contentPath,
  stylePath,
  styleFullPath,
  styleFreezePath,
  sourcePath,
  fidelityPath,
  registryPath,
  shellReview,
])

writeSelfReview(
  {
    stage: 'inputs',
    artifactPaths: artifacts.map((item) => item.path),
    reviewedArtifacts: artifacts,
    automatedChecks,
    checklist,
    issues,
    verdict,
    reviewedAt: new Date().toISOString(),
    autoGenerated: true,
  },
  { outJson: outPath, outMd: mdPath },
)

// A compact, teacher-readable index of the content pack. The JSON remains the
// source of truth; this table makes the human gate scannable without opening
// the raw content pack.
if (content && Array.isArray(content.items)) {
  const lines = [
    '',
    '## 内容包条目',
    '',
    '| ID | 类型 | 标题 | 复核 | 敏感度 | 选择题 |',
    '|---|---|---|---|---|---|',
  ]
  for (const item of content.items) {
    const quiz = item.kind === 'quiz'
      ? `${(item.options || []).filter((option) => option.correct).length} 正确 / ${(item.options || []).length} 项`
      : ''
    lines.push(
      `| ${item.id || ''} | ${item.kind || ''} | ${String(item.title || '').replace(/\|/g, '\\|')} | ${item.reviewStatus || 'missing'} | ${item.sensitivity || ''} | ${quiz} |`,
    )
  }
  fs.appendFileSync(path.resolve(mdPath), `${lines.join('\n')}\n`)
}

if (verdict !== 'pass') {
  console.error(`FAIL self-review inputs — ${failed.map((check) => check.name).join(', ')}`)
  process.exit(1)
}
console.log(`OK self-review inputs — ${automatedChecks.length} automated checks, ${issues.length} issue(s)`)
