#!/usr/bin/env node
// Regression test for structured Beta convergence triage.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readData } from './lib.mjs'

const tools = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(tools, '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-converge-'))
const script = path.join(tmp, 'courseware.md')
const sections = path.join(tmp, 'review-sections.yml')
const approvals = path.join(tmp, 'page-approvals.json')
const alpha = path.join(tmp, 'self-review-alpha.json')
const screenshots = path.join(tmp, 'screenshots')
const trial = path.join(tmp, 'trial-feedback.md')
const report = path.join(tmp, 'converge-report.md')
const blockedReport = path.join(tmp, 'converge-blocked.md')
const beta = path.join(tmp, 'self-review-beta.json')
const blockedBeta = path.join(tmp, 'self-review-blocked.json')
const mocks = path.join(tmp, 'mocks')
const blockedMocks = path.join(tmp, 'blocked-mocks')

fs.copyFileSync(path.join(root, 'workflow/examples/courseware.example.md'), script)
const scriptHash = crypto.createHash('sha256').update(fs.readFileSync(script)).digest('hex')
fs.mkdirSync(screenshots)
fs.writeFileSync(path.join(screenshots, 'S01.png'), 'fake png')
fs.writeFileSync(path.join(screenshots, 'S02.png'), 'fake png')
fs.writeFileSync(
  sections,
  `schemaVersion: "1.0"\nsections:\n  - id: A\n    title: 导入\n    slides: [S01]\n  - id: B\n    title: 第一个程序\n    slides: [S02]\n`,
)
fs.writeFileSync(
  approvals,
  JSON.stringify({
    schemaVersion: '1.0',
    sections: {
      A: { title: '导入', approvedAt: '2026-10-28T00:00:00Z', slides: { S01: {} } },
      B: { title: '第一个程序', approvedAt: '2026-10-28T00:00:00Z', slides: { S02: {} } },
    },
  }),
)
fs.writeFileSync(
  alpha,
  JSON.stringify({
    stage: 'alpha',
    reviewedArtifacts: [{ path: script, sha256: scriptHash }],
    automatedChecks: [{ name: 'all sections approved and frozen', status: 'pass' }],
    checklist: [{ item: 'alpha aggregate', status: 'pass' }],
    issues: [],
    verdict: 'pass',
    reviewedAt: '2026-10-28T00:00:00Z',
  }),
)
fs.writeFileSync(trial, '试课时 S02 的测验反馈不够具体，学生做错后不知道下一步检查什么。\n')
fs.mkdirSync(mocks)
fs.writeFileSync(
  path.join(mocks, 'converge.json'),
  JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify({
      lesson: 'demo-lesson-01',
      summary: '试课反馈只指出 S02 的反馈文案需要更具体；没有脚本、组件或批准异常。',
      verdict: 'ready',
      findings: [{
        id: 'C01',
        severity: 'minor',
        area: 'interaction',
        source: 'trial-feedback',
        slideId: 'S02',
        evidence: '试课反馈原话：S02 的测验反馈不够具体。',
        decision: '下一轮修订 S02 的错误反馈，补一句可操作的检查提示。',
        owner: 'page',
        status: 'open',
        reopen: false,
      }],
      followUps: ['下一轮脚本修订时处理 S02 反馈文案。'],
    }) }],
  }),
)
fs.mkdirSync(blockedMocks)
fs.writeFileSync(
  path.join(blockedMocks, 'converge.json'),
  JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify({
      lesson: 'demo-lesson-01',
      summary: '试课发现 S02 的测验把错误答案标成正确，属于内容 blocker。',
      verdict: 'blocked',
      findings: [{
        id: 'C01',
        severity: 'blocker',
        area: 'content',
        source: 'trial-feedback',
        slideId: 'S02',
        evidence: '试课反馈原话：S02 的测验把错误答案标成正确（A|B 两种写法都应判错）。',
        decision: '重开 S02，修正答案后完成页面审核。',
        owner: 'content',
        status: 'open',
        reopen: true,
      }],
      followUps: ['重开 S02 及其后页面，重做脚本与页面审核。'],
    }) }],
  }),
)

function run(args) {
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' })
}
function generate({ mockDir, out }) {
  return run([
    path.join(tools, 'generate-converge-report.mjs'),
    '--lesson-slug', 'demo-lesson-01',
    '--lesson', '演示课：程序与输出',
    '--script', script,
    '--sections', sections,
    '--approvals', approvals,
    '--alpha', alpha,
    '--screenshots', screenshots,
    '--trial-feedback', trial,
    '--review-dir', tmp,
    '--out', out,
    '--evidence', path.join(tmp, `${path.basename(out)}.input.json`),
    '--raw', path.join(tmp, `${path.basename(out)}.raw.json`),
    '--report', path.join(tmp, `${path.basename(out)}.report.json`),
    '--mock-dir', mockDir,
    '--max-attempts', '1',
    '--api', 'anthropic-messages',
    '--model', 'mock',
  ])
}

const ready = generate({ mockDir: mocks, out: report })
if (ready.status !== 0) {
  console.error(ready.stdout, ready.stderr)
  process.exit(1)
}
assert.match(fs.readFileSync(report, 'utf8'), /# 收敛报告：演示课：程序与输出/)
assert.match(fs.readFileSync(report, 'utf8'), /\| C01 \| minor \| S02 \|/)
assert.match(fs.readFileSync(report, 'utf8'), /建议进入 Beta/)

const betaReady = run([
  path.join(tools, 'build-self-review-beta.mjs'),
  '--lesson-slug', 'demo-lesson-01',
  '--report', report,
  '--out', beta,
  '--md', path.join(tmp, 'self-review-beta.md'),
])
if (betaReady.status !== 0) {
  console.error(betaReady.stdout, betaReady.stderr)
  process.exit(1)
}
assert.equal(readData(beta).verdict, 'pass')

const blocked = generate({ mockDir: blockedMocks, out: blockedReport })
if (blocked.status !== 0) {
  console.error(blocked.stdout, blocked.stderr)
  process.exit(1)
}
const blockedText = fs.readFileSync(blockedReport, 'utf8')
assert.match(blockedText, /\| C01 \| blocker \| S02 \|/)
assert.match(blockedText, /暂不进入 Beta/)
assert.match(blockedText, /重开 S02，修正答案后完成页面审核/)

const betaBlocked = run([
  path.join(tools, 'build-self-review-beta.mjs'),
  '--lesson-slug', 'demo-lesson-01',
  '--report', blockedReport,
  '--out', blockedBeta,
  '--md', path.join(tmp, 'self-review-blocked.md'),
])
assert.notEqual(betaBlocked.status, 0)
assert.equal(readData(blockedBeta).verdict, 'fail')
assert.equal(
  readData(blockedBeta).automatedChecks.find((check) => check.name === 'unresolved blockers').status,
  'fail',
)

// Without trial feedback the model must not invent findings.
fs.writeFileSync(path.join(tmp, 'empty-trial.md'), '')
const noTrialMockDir = path.join(tmp, 'no-trial-mocks')
fs.mkdirSync(noTrialMockDir)
fs.copyFileSync(path.join(blockedMocks, 'converge.json'), path.join(noTrialMockDir, 'converge.json'))
const noTrial = run([
  path.join(tools, 'generate-converge-report.mjs'),
  '--lesson-slug', 'demo-lesson-01',
  '--lesson', '演示课：程序与输出',
  '--script', script,
  '--sections', sections,
  '--approvals', approvals,
  '--alpha', alpha,
  '--screenshots', screenshots,
  '--trial-feedback', path.join(tmp, 'empty-trial.md'),
  '--review-dir', tmp,
  '--out', path.join(tmp, 'no-trial-report.md'),
  '--evidence', path.join(tmp, 'no-trial-input.json'),
  '--raw', path.join(tmp, 'no-trial-raw.json'),
  '--report', path.join(tmp, 'no-trial-report.json'),
  '--mock-dir', noTrialMockDir,
  '--max-attempts', '1',
  '--api', 'anthropic-messages',
  '--model', 'mock',
])
if (noTrial.status !== 0) {
  console.error(noTrial.stdout, noTrial.stderr)
  process.exit(1)
}
assert.match(fs.readFileSync(path.join(tmp, 'no-trial-report.md'), 'utf8'), /未发现需要处理的证据支持问题/)
assert.equal(readData(path.join(tmp, 'no-trial-report.json')).attempts, 0)
assert.equal(readData(path.join(tmp, 'no-trial-report.json')).deterministic, true)
const noTrialBetaPath = path.join(tmp, 'no-trial-beta.json')
const noTrialBeta = run([
  path.join(tools, 'build-self-review-beta.mjs'),
  '--lesson-slug', 'demo-lesson-01',
  '--report', path.join(tmp, 'no-trial-report.md'),
  '--out', noTrialBetaPath,
  '--md', path.join(tmp, 'no-trial-beta.md'),
])
assert.equal(noTrialBeta.status, 0)
assert.equal(
  readData(noTrialBetaPath).checklist.find((item) => item.item.includes('试用')).status,
  'n/a',
)

console.log('PASS structured convergence triage')
fs.rmSync(tmp, { recursive: true, force: true })
