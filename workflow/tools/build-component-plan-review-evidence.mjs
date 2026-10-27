#!/usr/bin/env node
// Build the compact evidence + skeleton for the single-shot component-plan
// self-review. The reviewer sees the validated plan, briefs, registry summary
// and the deterministic check, not the repository.
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
const stylePath = parseFlagValue(args, '--style')
const registryPath = parseFlagValue(args, '--registry', 'registry/index.json')
const scriptDir = scriptPath ? path.dirname(path.resolve(scriptPath)) : ''
const planPath = parseFlagValue(args, '--plan', path.join(scriptDir, 'component-plan.md'))
const briefsDir = parseFlagValue(args, '--briefs', path.join(scriptDir, 'component-briefs'))
const approvalPath = parseFlagValue(
  args,
  '--approval',
  path.join('review', lessonSlug, 'script-approval.json'),
)
const reviewDir = parseFlagValue(args, '--review-dir', path.join('review', lessonSlug))
const evidencePath = parseFlagValue(
  args,
  '--out',
  path.join(reviewDir, 'component-plan-review-evidence.json'),
)
const reviewJson = parseFlagValue(
  args,
  '--review-json',
  path.join(reviewDir, 'self-review-component-plan.json'),
)
const reviewMd = parseFlagValue(
  args,
  '--md',
  path.join(reviewDir, 'self-review-component-plan.md'),
)

if (!lessonSlug || !scriptPath || !stylePath) {
  console.error(
    'usage: node build-component-plan-review-evidence.mjs --lesson-slug <slug> --script <courseware.md> --style <style-pack.manifest.json> [--registry <index.json>] [--plan <component-plan.md>] [--briefs <dir>] [--approval <script-approval.json>] [--review-dir review/<slug>] [--out <evidence.json>] [--review-json <review.json>] [--md <review.md>]',
  )
  process.exit(2)
}

function readText(file) {
  return fs.existsSync(path.resolve(file)) ? fs.readFileSync(path.resolve(file), 'utf8') : ''
}
const registry = readData(registryPath)
const componentIds = Array.isArray(registry.components)
  ? registry.components.map((item) => item.id)
  : Object.keys(registry.components || {})
const briefs = []
if (fs.existsSync(path.resolve(briefsDir))) {
  for (const name of fs.readdirSync(briefsDir).sort()) {
    if (!name.endsWith('.md')) continue
    const file = path.join(briefsDir, name)
    briefs.push({ id: path.basename(name, '.md'), path: file, text: readText(file) })
  }
}
const check = runTool('check-component-plan.mjs', [
  scriptPath,
  stylePath,
  registryPath,
  '--plan',
  planPath,
  '--briefs',
  briefsDir,
  '--approval',
  approvalPath,
])
const checks = [{ name: 'check-component-plan', status: check.status, notes: check.notes }]
const failedChecks = checks.filter((item) => item.status === 'fail')
const artifacts = collectArtifacts([
  planPath,
  ...briefs.map((brief) => brief.path),
  registryPath,
  stylePath,
])
const evidence = {
  schemaVersion: '1.0',
  mode: 'component-plan',
  lessonSlug,
  plan: { path: planPath, text: readText(planPath) },
  briefs,
  registry: { path: registryPath, components: componentIds },
  checks,
}
fs.mkdirSync(path.dirname(path.resolve(evidencePath)), { recursive: true })
fs.writeFileSync(path.resolve(evidencePath), `${JSON.stringify(evidence, null, 2)}\n`)

const checklist = [
  { item: '每个互动需求都有复用检索记录（命令 + 命中）', status: 'n/a' },
  {
    item: '每个缺口简报包含：复用搜索、缺口决策、学习目标/成功标准、交互 FSM、props API、视觉/布局、无障碍、静态替代、测试计划、风险/非目标',
    status: 'n/a',
  },
  { item: '没有私有一次性组件', status: 'n/a' },
  { item: '没有 TODO/TBD/占位内容', status: 'n/a' },
]
const skeleton = {
  stage: 'component-plan',
  artifactPaths: artifacts.map((item) => item.path),
  reviewedArtifacts: artifacts,
  automatedChecks: checks,
  checklist,
  issues: failedChecks.map((item) => ({
    description: `${item.name}: ${item.notes}`,
    severity: 'blocking',
    fixed: false,
  })),
  verdict: 'fail',
  reviewedAt: new Date().toISOString(),
  reviewMeta: { mode: 'component-plan' },
}
writeSelfReview(skeleton, { outJson: reviewJson, outMd: reviewMd })
if (failedChecks.length) {
  console.error(`FAIL component-plan review evidence — ${failedChecks.map((item) => item.name).join(', ')}`)
  process.exit(1)
}
console.log(`OK component-plan review evidence — ${evidencePath}`)
