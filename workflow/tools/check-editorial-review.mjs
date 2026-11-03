#!/usr/bin/env node
// Gate the independent script editorial review.
//
// Only `blocking` findings stop the workflow. Major/minor findings are
// advisory and are appended to the teacher-facing script. The review is bound
// to the exact bytes it read; an edit to the script (or the spec/concepts
// evidence) makes the review stale and must not be treated as current.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readData, validateWithSchema } from './lib.mjs'
import { parseScript } from './script-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
function flag(name) {
  return args.includes(name)
}
function fail(message, code = 1) {
  console.error(`FAIL editorial review — ${message}`)
  process.exit(code)
}
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}
function severityLabel(value) {
  return { blocking: '严重', major: '建议', minor: '提示' }[value] || value
}
function dimensionLabel(value) {
  return {
    'code-correctness': '代码正确性',
    'cross-reference': '跨页引用',
    'terminology-sequencing': '术语顺序',
    'answer-leakage': '答案泄露',
    'objective-alignment': '目标与证据',
    language: '语言',
    'practice-coverage': '练习覆盖',
    consistency: '一致性',
    other: '其他',
  }[value] || value
}

const valueOptions = new Set(['--script', '--fix-brief'])
let reviewPath = ''
for (let i = 0; i < args.length; i += 1) {
  if (valueOptions.has(args[i])) {
    i += 1
    continue
  }
  if (!args[i].startsWith('--')) {
    reviewPath = args[i]
    break
  }
}
const scriptPath = opt('--script')
const fixBriefPath = opt('--fix-brief')
const jsonOut = flag('--json')
if (!reviewPath || !scriptPath) {
  console.error(
    'usage: node check-editorial-review.mjs <script-editorial-review.json> --script <courseware.md> [--fix-brief <file>] [--json]',
  )
  process.exit(2)
}

let review
try {
  review = readData(reviewPath)
} catch (error) {
  fail(`cannot read ${reviewPath}: ${error.message}`)
}
const schemaPath = fileURLToPath(
  new URL('../schemas/editorial-review.schema.json', import.meta.url),
)
const { ok, errors } = validateWithSchema(schemaPath, review)
if (!ok) fail(`schema ${reviewPath}: ${errors.join('; ')}`)

const problems = []
const warnings = []
const findings = Array.isArray(review.findings) ? review.findings : []
const blocking = findings.filter((finding) => finding.severity === 'blocking')
if (blocking.length) {
  problems.push(`${blocking.length} blocking finding(s) must be fixed before the teacher gate`)
}

let slides = []
try {
  slides = parseScript(path.resolve(scriptPath)).slides
} catch (error) {
  problems.push(`cannot parse script ${scriptPath}: ${error.message}`)
}
const slideById = new Map(slides.map((slide) => [slide.id, slide]))
for (const finding of findings) {
  if (!slideById.has(finding.slideId)) {
    problems.push(`finding references unknown slide ${finding.slideId}`)
    continue
  }
  const slide = slideById.get(finding.slideId)
  const haystack = normalize([
    slide.screenContent,
    slide.interactionDesign,
    slide.narration,
    slide.transition,
  ].join('\n'))
  if (!haystack.includes(normalize(finding.evidence))) {
    warnings.push(
      `${finding.slideId}: quoted evidence was not found verbatim in the slide text; verify it manually`,
    )
  }
}

const root = process.cwd()
const resolvedScript = path.resolve(scriptPath)
const boundScript = review.reviewedArtifacts.find(
  (artifact) => path.resolve(artifact.path) === resolvedScript,
)
if (!boundScript) {
  problems.push('review does not bind the current script hash')
} else {
  const actual = sha256File(resolvedScript)
  if (actual !== boundScript.sha256.toLowerCase()) {
    problems.push(
      `stale review: ${scriptPath} changed after this review ` +
        `(reviewed ${boundScript.sha256.slice(0, 12)}…, now ${actual.slice(0, 12)}…); rerun the editorial review`,
    )
  }
}
for (const artifact of review.reviewedArtifacts) {
  if (path.resolve(artifact.path) === resolvedScript) continue
  const absolute = path.isAbsolute(artifact.path)
    ? artifact.path
    : path.resolve(root, artifact.path)
  if (!fs.existsSync(absolute)) {
    problems.push(`reviewed artifact not found: ${artifact.path}`)
    continue
  }
  const actual = sha256File(absolute)
  if (actual !== artifact.sha256.toLowerCase()) {
    problems.push(
      `stale review: ${artifact.path} changed after this review; rerun the editorial review`,
    )
  }
}

function writeFixBrief() {
  if (!fixBriefPath) return
  const lines = [
    '# 脚本编辑审稿修复清单',
    '',
    `- 审阅文件：${reviewPath}`,
    `- 结论：${review.verdict}`,
    `- 严重问题：${blocking.length}`,
    '',
  ]
  if (problems.length) {
    lines.push('## 必须先处理', '')
    for (const problem of problems) lines.push(`- ${problem}`)
    lines.push('')
  }
  if (blocking.length) {
    lines.push('## 严重问题', '')
    for (const finding of blocking) {
      lines.push(
        `### ${finding.slideId} · ${dimensionLabel(finding.dimension)}`,
        '',
        `**原文**：${finding.evidence}`,
        '',
        `**建议**：${finding.suggestion}`,
        '',
      )
    }
  }
  fs.mkdirSync(path.dirname(path.resolve(fixBriefPath)), { recursive: true })
  fs.writeFileSync(path.resolve(fixBriefPath), `${lines.join('\n').trimEnd()}\n`)
}

const result = {
  ok: problems.length === 0,
  review: reviewPath,
  verdict: review.verdict,
  findings: findings.length,
  blocking: blocking.length,
  major: findings.filter((finding) => finding.severity === 'major').length,
  minor: findings.filter((finding) => finding.severity === 'minor').length,
  warnings,
  problems,
}
if (jsonOut) process.stdout.write(`${JSON.stringify(result)}\n`)
if (problems.length) {
  writeFixBrief()
  fail(problems.join('; '))
}
if (warnings.length) {
  console.warn(`WARN editorial review — ${warnings.length} quote(s) not found verbatim; verify manually`)
}
console.log(
  `OK editorial review — ${findings.length} finding(s), 0 blocking, ` +
    `${findings.filter((finding) => finding.severity === 'major').length} major, ` +
    `${findings.filter((finding) => finding.severity === 'minor').length} minor`,
)
