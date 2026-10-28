#!/usr/bin/env node
// Deterministic Beta self-review summary.
//
// Beta is a trial-feedback convergence stage. The semantic work (triage,
// severity, ownership) happens in speckit.converge and in the teacher's
// review-beta gate; this tool only turns the converge report into the standard
// self-review artifact and flags obvious unresolved blockers.
import fs from 'node:fs'
import path from 'node:path'
import {
  collectArtifacts,
  parseFlagValue,
  writeSelfReview,
} from './self-review-lib.mjs'

const args = process.argv.slice(2)
const lessonSlug = parseFlagValue(args, '--lesson-slug')
const reportPath = parseFlagValue(
  args,
  '--report',
  `review/${lessonSlug}/converge-report.md`,
)
const outPath = parseFlagValue(args, '--out', `review/${lessonSlug}/self-review-beta.json`)
const mdPath = parseFlagValue(args, '--md', `review/${lessonSlug}/self-review-beta.md`)

if (!lessonSlug) {
  console.error(
    'usage: node build-self-review-beta.mjs --lesson-slug <slug> [--report <converge-report.md>] [--out <review.json>] [--md <review.md>]',
  )
  process.exit(2)
}

const issues = []
const checks = []
const checklist = []
const reportExists = fs.existsSync(reportPath)
const report = reportExists ? fs.readFileSync(reportPath, 'utf8') : ''

checks.push({
  name: 'converge report',
  status: reportExists ? 'pass' : 'fail',
  notes: reportExists ? reportPath : `missing ${reportPath}`,
})
if (!reportExists) {
  issues.push({
    description: `converge report is missing: ${reportPath}`,
    severity: 'blocking',
    fixed: false,
  })
}

const RESOLVED_STATUS = /^(waived|fixed|closed|已修复|已关闭|关闭|完成)/i
const OPEN_STATUS = /^(open|未关闭|待处理)/i

// Structured reports put the status in the last table cell. Check it before
// falling back to prose scanning, so a decision that happens to contain
// "完成" cannot hide an open blocker.
function rowCells(line) {
  const cells = []
  let current = ''
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '\\' && line[index + 1] === '|') {
      current += '|'
      index += 1
    } else if (char === '|') {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells.slice(1, -1)
}
function rowIsResolved(line) {
  const content = rowCells(line)
  const status = content[content.length - 1] || ''
  if (RESOLVED_STATUS.test(status)) return true
  if (OPEN_STATUS.test(status)) return false
  return /已修复|fixed|closed|waived|关闭|完成/i.test(line)
}
function structuredSeverity(line) {
  const content = rowCells(line)
  const second = (content[1] || '').toLowerCase()
  return /^(blocker|major|minor)$/.test(second) ? second : ''
}

const unresolved = []
if (reportExists) {
  for (const [index, line] of report.split(/\r?\n/).entries()) {
    const trimmed = line.trim()
    // Only scan table rows. Prose such as "没有未修复的 blocker" must not be
    // mistaken for an unresolved row.
    if (!trimmed.startsWith('|')) continue
    const severity = structuredSeverity(trimmed)
    if (severity) {
      if (severity !== 'blocker') continue
      if (rowIsResolved(trimmed)) continue
      unresolved.push(`line ${index + 1}: ${trimmed}`)
      continue
    }
    // Legacy free-form reports: keep the old broad scan.
    if (!/\bblocker\b/i.test(trimmed) && !/未修复|未关闭/.test(trimmed)) continue
    if (rowIsResolved(trimmed)) continue
    unresolved.push(`line ${index + 1}: ${trimmed}`)
  }
}
checks.push({
  name: 'unresolved blockers',
  status: unresolved.length ? 'fail' : 'pass',
  notes: unresolved.length ? unresolved.join('; ') : 'no unresolved blocker rows detected',
})
for (const line of unresolved) {
  issues.push({ description: line, severity: 'blocking', fixed: false })
}

const hasTrialEvidence = /试用反馈[：:]\s*已提供/.test(report) ||
  (/试课|试用|trial|学生|课堂/i.test(report) && !/试用反馈[：:]\s*未提供/.test(report))
const hasIssueTable = /严重|severity/i.test(report) && /负责人|owner/i.test(report)
checklist.push({
  item: '收敛报告存在，问题有证据、分级和归属',
  status: reportExists ? (hasIssueTable ? 'pass' : 'n/a') : 'fail',
  notes: reportExists
    ? hasIssueTable
      ? `${reportPath}; severity/owner columns detected`
      : `${reportPath}; no severity/owner table detected (human gate decides)`
    : '报告缺失',
})
checklist.push({
  item: '没有未修复的 blocker',
  status: unresolved.length ? 'fail' : 'pass',
  notes: unresolved.length ? `${unresolved.length} unresolved row(s)` : 'deterministic scan',
})
checklist.push({
  item: '试用/课堂证据已记录',
  status: hasTrialEvidence ? 'pass' : 'n/a',
  notes: hasTrialEvidence ? '报告提到试用/课堂证据' : '报告未提到；由老师 review-beta 判断',
})

const verdict = issues.some((issue) => issue.severity === 'blocking') ? 'fail' : 'pass'
const artifacts = collectArtifacts([reportPath])

writeSelfReview(
  {
    stage: 'beta',
    artifactPaths: artifacts.map((item) => item.path),
    reviewedArtifacts: artifacts,
    automatedChecks: checks,
    checklist,
    issues,
    verdict,
    reviewedAt: new Date().toISOString(),
    autoGenerated: true,
  },
  { outJson: outPath, outMd: mdPath },
)

if (verdict !== 'pass') {
  console.error(`FAIL self-review beta — ${issues.map((issue) => issue.description).join('; ')}`)
  process.exit(1)
}
console.log(`OK self-review beta — ${checks.length} automated checks`)
