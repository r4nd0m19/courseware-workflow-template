#!/usr/bin/env node
// Code-orchestrated Beta convergence triage.
//
// Alpha has already aggregated per-page self-reviews and human approvals. This
// step reads that frozen evidence plus any trial/classroom feedback, asks a
// single tool-less model call to classify evidence-backed findings, and renders
// converge-report.md deterministically.
//
// It deliberately does not edit courseware.md, deck.json, components or review
// ledgers. Any edit would invalidate the hash-bound page approvals. A blocker
// stays visible in the report and the deterministic Beta self-review stops the
// run; the page can only be repaired by the normal reopen/review flow.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readData, validateWithSchema } from './lib.mjs'
import { parseScript, hasPlaceholder } from './script-lib.mjs'

const toolsDir = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : fallback
}
function die(message) {
  console.error(`FAIL convergence report — ${message}`)
  process.exit(1)
}
function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.writeFileSync(path.resolve(file), `${JSON.stringify(value, null, 2)}\n`)
}
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
function samePath(a, b) {
  return path.resolve(a) === path.resolve(b)
}
function cell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim()
}
function allStrings(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const item of value) allStrings(item, out)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) allStrings(item, out)
  return out
}

const lessonSlug = opt('--lesson-slug')
const lesson = opt('--lesson', lessonSlug)
const scriptPath = opt('--script')
const sectionsPath = opt('--sections')
const approvalsPath = opt('--approvals')
const alphaPath = opt('--alpha')
const screenshotsDir = opt('--screenshots', `screenshots/${lessonSlug}`)
const reviewDir = opt('--review-dir', `review/${lessonSlug}`)
const trialFeedbackPath = opt('--trial-feedback', path.join(reviewDir, 'trial-feedback.md'))
const outPath = opt('--out', path.join(reviewDir, 'converge-report.md'))
const evidencePath = opt('--evidence', path.join(reviewDir, 'converge-input.json'))
const rawPath = opt('--raw', path.join(reviewDir, 'converge-generation.json'))
const generationReportPath = opt('--report', path.join(reviewDir, 'converge-generation-report.json'))
const singleShotPath = opt('--single-shot', path.join(toolsDir, 'single-shot-generate.mjs'))
const mockDir = opt('--mock-dir')
const maxAttempts = Math.max(1, Number(opt('--max-attempts', '2')) || 2)

if (!lessonSlug || !scriptPath || !sectionsPath || !approvalsPath || !alphaPath) {
  console.error(
    'usage: node generate-converge-report.mjs --lesson-slug <slug> --lesson "<title>" --script <courseware.md> --sections <review-sections.yml> --approvals <page-approvals.json> --alpha <self-review-alpha.json> --screenshots <dir> --review-dir review/<slug> [--trial-feedback <trial-feedback.md>] [--out <converge-report.md>] [--mock-dir <dir>] [model options]',
  )
  process.exit(2)
}
for (const [label, file] of [
  ['script', scriptPath],
  ['review sections', sectionsPath],
  ['page approvals', approvalsPath],
  ['Alpha self-review', alphaPath],
]) {
  if (!fs.existsSync(file)) die(`${label} does not exist: ${file}`)
}

const parsed = parseScript(scriptPath)
const slideIds = new Set(parsed.slides.map((slide) => slide.id))
const slides = parsed.slides.map((slide) => ({
  id: slide.id,
  title: slide.headingTitle,
  objectiveId: slide.machine?.objectiveId || '',
  components: slide.machine?.components || [],
}))

const manifest = readData(sectionsPath)
const sections = Array.isArray(manifest.sections) ? manifest.sections : []
if (!sections.length) die(`${sectionsPath} has no sections`)
const approvals = readData(approvalsPath)
const approvalSections = Array.isArray(approvals.sections)
  ? Object.fromEntries(approvals.sections.map((section) => [section.id, section]))
  : approvals.sections || {}
const missingApprovals = sections
  .filter((section) => !approvalSections[section.id])
  .map((section) => section.id)
if (missingApprovals.length) {
  die(`page approvals are missing section(s): ${missingApprovals.join(', ')}`)
}
const approvedSections = sections.map((section) => ({
  id: section.id,
  slides: section.slides || [],
  approvedAt: approvalSections[section.id]?.approvedAt || '',
}))

const alpha = readData(alphaPath)
if (alpha.stage !== 'alpha') die(`Alpha file has stage ${JSON.stringify(alpha.stage)}, expected "alpha"`)
if (alpha.verdict !== 'pass') die(`Alpha verdict is ${JSON.stringify(alpha.verdict)}, expected "pass"`)
const scriptHash = sha256File(scriptPath)
const reviewedScript = (alpha.reviewedArtifacts || []).find((artifact) =>
  samePath(artifact.path, scriptPath),
)
if (!reviewedScript) die(`Alpha reviewedArtifacts does not bind ${scriptPath}`)
if (String(reviewedScript.sha256).toLowerCase() !== scriptHash) {
  die('Alpha review is stale: its script hash does not match the current courseware.md')
}

const imagePattern = /\.(png|jpe?g|webp)$/i
if (!fs.existsSync(screenshotsDir)) die(`screenshots directory does not exist: ${screenshotsDir}`)
const screenshots = fs.readdirSync(screenshotsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && imagePattern.test(entry.name))
  .map((entry) => entry.name)
  .sort()
if (!screenshots.length) die(`screenshots directory has no images: ${screenshotsDir}`)

const trialTextRaw = readText(trialFeedbackPath)
const MAX_TRIAL_CHARS = 20000
const trialTruncated = trialTextRaw.length > MAX_TRIAL_CHARS
const trialText = trialTruncated
  ? `${trialTextRaw.slice(0, MAX_TRIAL_CHARS)}\n\n[试用反馈已截断，仅保留前 ${MAX_TRIAL_CHARS} 字符]`
  : trialTextRaw
const trialAvailable = Boolean(trialTextRaw.trim())

const alphaChecks = Array.isArray(alpha.automatedChecks) ? alpha.automatedChecks : []
const alphaChecklist = Array.isArray(alpha.checklist) ? alpha.checklist : []
const alphaIssues = Array.isArray(alpha.issues) ? alpha.issues : []
const deterministicChecks = [
  {
    name: 'Alpha whole-deck self-review',
    status: 'pass',
    notes: `${alphaPath}; ${alphaChecks.length} automated check(s), ${alphaIssues.length} issue(s)`,
  },
  {
    name: 'page approval ledger',
    status: 'pass',
    notes: `${sections.length}/${sections.length} section(s) present`,
  },
  {
    name: 'current script binding',
    status: 'pass',
    notes: `${scriptPath}; sha256 ${scriptHash}`,
  },
  {
    name: 'screenshots present',
    status: 'pass',
    notes: `${screenshots.length} image(s) in ${screenshotsDir}`,
  },
]

const evidence = {
  schemaVersion: '1.0',
  mode: 'converge',
  lessonSlug,
  lesson,
  script: {
    path: scriptPath,
    hash: scriptHash,
    slides,
  },
  approvals: {
    path: approvalsPath,
    sections: approvedSections,
  },
  alpha: {
    path: alphaPath,
    verdict: alpha.verdict,
    automatedChecks: alphaChecks,
    checklist: alphaChecklist,
    issues: alphaIssues,
  },
  screenshots: {
    path: screenshotsDir,
    files: screenshots,
  },
  trialFeedback: {
    path: trialFeedbackPath,
    available: trialAvailable,
    truncated: trialTruncated,
    text: trialText,
  },
  deterministicChecks,
  rules: [
    '只根据试用/课堂反馈或 Alpha/批准/流程证据报告问题，不得凭印象新增。',
    '模型看不到截图内容，不得根据文件名判断视觉问题。',
    '没有试用反馈且 Alpha 无问题时，findings 必须为空。',
    '本步骤不修改文件，不能声称已修复、已关闭或已完成。',
    'blocker 只在确有内容错误、互动反馈错误、源码保真失败、无法播放或无障碍阻断时使用。',
    'verdict=blocked 当且仅当存在 status=open 的 blocker。',
    'reopen=true 只用于确实需要重开已批准页面的修复。',
  ],
}
writeJson(evidencePath, evidence)

const FORWARDED_OPTIONS = new Set([
  '--config', '--zcode-config', '--zcode-provider', '--api', '--base-url', '--model',
  '--api-key-env', '--api-key-file', '--max-tokens', '--timeout-ms', '--auth',
])
const modelArgs = []
for (let i = 0; i < args.length; i += 1) {
  if (FORWARDED_OPTIONS.has(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
    modelArgs.push(args[i], args[i + 1])
    i += 1
  }
}
if (!modelArgs.includes('--max-tokens')) modelArgs.push('--max-tokens', '32768')
if (!modelArgs.includes('--timeout-ms')) modelArgs.push('--timeout-ms', '300000')

function mockFile(attempt) {
  if (!mockDir) return ''
  const candidates = attempt > 1
    ? [path.join(mockDir, 'converge-repair.json'), path.join(mockDir, 'converge.json')]
    : [path.join(mockDir, 'converge.json')]
  const found = candidates.find((file) => fs.existsSync(path.resolve(file)))
  if (!found) die(`mock response not found: ${candidates.join(', ')}`)
  return found
}

function callModel(attempt, errors, previous) {
  const currentEvidence = attempt === 1
    ? evidence
    : { ...evidence, repair: { errors, previous } }
  const attemptEvidence = path.join(reviewDir, `converge-input-attempt-${attempt}.json`)
  writeJson(attemptEvidence, currentEvidence)
  const callArgs = [
    singleShotPath,
    '--mode', 'converge',
    '--evidence', attemptEvidence,
    '--out', rawPath,
    ...modelArgs,
  ]
  const mock = mockFile(attempt)
  if (mock) callArgs.push('--mock-response', mock)
  const result = spawnSync(process.execPath, callArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  })
  if (result.error) die(result.error.message)
  if (result.status !== 0) return { error: `${result.stdout || ''}\n${result.stderr || ''}`.trim() }
  try {
    return { raw: readData(rawPath) }
  } catch (error) {
    return { error: `cannot read model output ${rawPath}: ${error.message}` }
  }
}

function validateRaw(raw) {
  const errors = []
  const schema = validateWithSchema(
    fileURLToPath(new URL('../schemas/converge-generation.schema.json', import.meta.url)),
    raw,
  )
  for (const error of schema.errors) errors.push(`schema ${error}`)
  if (schema.errors.length) return errors
  if (raw.lesson !== lessonSlug) errors.push(`lesson ${raw.lesson} != ${lessonSlug}`)
  if (!raw.summary.trim()) errors.push('summary is empty')
  const hasChinese = /[\u4e00-\u9fff]/
  const chineseFields = [
    ['summary', raw.summary],
    ...raw.findings.flatMap((finding) => [
      [`${finding.id}.decision`, finding.decision],
      ...(finding.waiverReason ? [[`${finding.id}.waiverReason`, finding.waiverReason]] : []),
    ]),
    ...raw.followUps.map((item, index) => [`followUps[${index}]`, item]),
  ]
  for (const [label, text] of chineseFields) {
    if (!hasChinese.test(String(text || ''))) {
      errors.push(`${label} must be written in Simplified Chinese`)
    }
  }
  for (const text of allStrings(raw)) {
    if (hasPlaceholder(text) || /占位/.test(text)) {
      errors.push(`output contains a placeholder: ${text.slice(0, 120)}`)
      break
    }
  }

  const ids = new Set()
  for (const finding of raw.findings) {
    if (ids.has(finding.id)) errors.push(`duplicate finding ${finding.id}`)
    ids.add(finding.id)
    if (finding.slideId && !slideIds.has(finding.slideId)) {
      errors.push(`${finding.id} references unknown slide ${finding.slideId}`)
    }
    if (finding.reopen && !finding.slideId) {
      errors.push(`${finding.id} sets reopen without a slideId`)
    }
    if (finding.status === 'waived' && !String(finding.waiverReason || '').trim()) {
      errors.push(`${finding.id} is waived without a waiverReason`)
    }
    if (finding.source === 'trial-feedback' && !trialAvailable) {
      errors.push(`${finding.id} cites trial feedback but none was supplied`)
    }
  }
  if (!trialAvailable && raw.findings.length) {
    errors.push('no trial feedback was supplied; findings must be empty')
  }
  const openBlockers = raw.findings.filter(
    (finding) => finding.severity === 'blocker' && finding.status === 'open',
  )
  if ((raw.verdict === 'blocked') !== (openBlockers.length > 0)) {
    errors.push(
      `verdict must be blocked exactly when an open blocker exists; got ${raw.verdict} with ${openBlockers.length} open blocker(s)`,
    )
  }
  if (raw.verdict === 'blocked' && !raw.followUps.length) {
    errors.push('a blocked verdict needs at least one follow-up action')
  }
  return errors
}

const OWNER_LABELS = {
  page: '页面实现',
  component: '组件制作',
  content: '内容/脚本',
  teacher: '老师确认',
  workflow: '流程处理',
}
const AREA_LABELS = {
  content: '内容',
  interaction: '互动',
  visual: '视觉',
  narration: '旁白',
  component: '组件',
  accessibility: '无障碍',
  other: '其他',
}

function renderReport(raw) {
  const blocked = raw.verdict === 'blocked'
  const lines = [
    `# 收敛报告：${lesson}`,
    '',
    '## 结论',
    '',
    raw.summary.trim(),
    '',
    `- 结论：${blocked ? '暂不进入 Beta：存在未关闭的 blocker' : '建议进入 Beta'}`,
    `- 试用反馈：${trialAvailable ? `已提供（${trialFeedbackPath}）` : '未提供'}`,
    '- 本步骤只做只读收敛，不修改已批准的脚本、屏幕、组件或审核记录；任何内容修订都必须重开页面并重走审核。',
    '',
    '## 问题表',
    '',
    '| ID | 严重级 | 页·屏 | 证据 | 决定 | 负责人 | 状态 |',
    '|---|---|---|---|---|---|---|',
  ]
  if (!raw.findings.length) {
    lines.push('| — | — | — | 未发现需要处理的证据支持问题 | — | — | — |')
  } else {
    for (const finding of raw.findings) {
      const page = finding.slideId || '全课'
      const owner = OWNER_LABELS[finding.owner] || finding.owner
      const status = finding.status === 'open' ? 'open' : `waived（${finding.waiverReason}）`
      lines.push(
        `| ${cell(finding.id)} | ${cell(finding.severity)} | ${cell(page)} | ${cell(finding.evidence)} | ${cell(finding.decision)} | ${cell(owner)} | ${cell(status)} |`,
      )
    }
  }
  lines.push('', '## 已修复与未修复', '')
  lines.push('- 已修复：无。本步骤不写入已批准内容，避免使脚本/截图批准哈希失效。')
  if (!raw.findings.length) {
    lines.push('- 未修复：无。')
  } else {
    for (const finding of raw.findings) {
      const state = finding.status === 'open'
        ? '未关闭'
        : `已豁免：${finding.waiverReason}`
      lines.push(`- ${finding.id}（${finding.severity}，${AREA_LABELS[finding.area] || finding.area}）：${finding.decision}；当前${state}。`)
    }
  }
  lines.push('', '## 闸门状态', '', '| 检查 | 结果 | 说明 |', '|---|---|---|')
  for (const check of deterministicChecks) {
    lines.push(`| ${cell(check.name)} | ${cell(check.status)} | ${cell(check.notes)} |`)
  }
  lines.push('', '## 后续动作', '')
  if (!raw.followUps.length) {
    lines.push('- 无。')
  } else {
    for (const item of raw.followUps) lines.push(`- ${item}`)
  }
  lines.push('')
  return `${lines.join('\n').trimEnd()}\n`
}

// With no trial/classroom feedback, Alpha has already aggregated every page
// review and all deterministic checks. There is nothing new for a model to
// triage; emit the empty report deterministically instead of spending a call.
if (!trialAvailable && alphaIssues.length === 0) {
  const raw = {
    lesson: lessonSlug,
    summary: 'Alpha 自审与页批准均已通过，未提供试用/课堂反馈；没有证据支持的问题需要处理。',
    verdict: 'ready',
    findings: [],
    followUps: ['补充真实试用/课堂反馈后重新运行收敛。'],
  }
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
  fs.writeFileSync(path.resolve(outPath), renderReport(raw))
  writeJson(rawPath, raw)
  writeJson(generationReportPath, {
    schemaVersion: '1.0',
    lessonSlug,
    attempts: 0,
    verdict: raw.verdict,
    findings: 0,
    deterministic: true,
    report: outPath,
  })
  console.log('OK convergence report — no trial feedback; deterministic empty report')
  process.exit(0)
}

if (!mockDir) {
  const config = spawnSync(
    process.execPath,
    [singleShotPath, '--check-config', ...modelArgs],
    { cwd: process.cwd(), stdio: 'inherit' },
  )
  if (config.status !== 0) die(`single-shot config failed (exit ${config.status})`)
}

let raw = null
let errors = []
let attempts = 0
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  attempts = attempt
  const call = callModel(attempt, errors, raw)
  if (call.error) {
    errors = call.error.split(/\r?\n/).filter(Boolean)
  } else {
    raw = call.raw
    errors = validateRaw(raw)
    if (!errors.length) {
      fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
      fs.writeFileSync(path.resolve(outPath), renderReport(raw))
      writeJson(generationReportPath, {
        schemaVersion: '1.0',
        lessonSlug,
        attempts,
        verdict: raw.verdict,
        findings: raw.findings.length,
        report: outPath,
      })
      const blockers = raw.findings.filter(
        (finding) => finding.severity === 'blocker' && finding.status === 'open',
      ).length
      console.log(
        `OK convergence report — ${raw.findings.length} finding(s), ${blockers} open blocker(s), ${attempts} attempt(s)`,
      )
      process.exit(0)
    }
  }
  console.error(`convergence attempt ${attempt} failed:\n${errors.map((error) => `  - ${error}`).join('\n')}`)
}
die(`convergence report is still invalid after ${attempts} attempt(s):\n${errors.map((error) => `  - ${error}`).join('\n')}`)
