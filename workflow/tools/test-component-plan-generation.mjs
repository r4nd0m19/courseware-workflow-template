#!/usr/bin/env node
// Regression test for the structured component plan renderer + gate.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const tools = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(tools, '../..')
const examples = path.join(root, 'workflow/examples')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-component-plan-'))
const runs = path.join(tmp, '.specify/workflows/runs')
const script = path.join(tmp, 'courseware.md')
const approval = path.join(tmp, 'script-approval.json')
const plan = path.join(tmp, 'component-plan.md')
const briefs = path.join(tmp, 'component-briefs')
const mocks = path.join(tmp, 'mocks')
const review = path.join(tmp, 'review')
process.env.COURSEWARE_WORKFLOW_RUNS_DIR = runs
fs.mkdirSync(mocks)
fs.mkdirSync(path.join(runs, 'smoke'), { recursive: true })
fs.writeFileSync(
  path.join(runs, 'smoke', 'state.json'),
  JSON.stringify({
    run_id: 'smoke',
    workflow_id: 'courseware-production',
    status: 'completed',
    step_results: {
      'review-script': { type: 'gate', status: 'completed', output: { choice: 'approve', options: ['approve', 'reject'] } },
    },
  }),
)
fs.copyFileSync(path.join(examples, 'courseware.component.example.md'), script)
const approve = spawnSync(process.execPath, [
  path.join(tools, 'approve-script.mjs'),
  script,
  '--approved-by', 'smoke',
  '--gate-choice', 'approve',
  '--run-id', 'smoke',
  '--out', approval,
  '--manual',
], { encoding: 'utf8', cwd: root })
if (approve.status !== 0) {
  console.error(approve.stdout, approve.stderr)
  process.exit(1)
}
const briefMarkdown = fs.readFileSync(path.join(examples, 'component-briefs/edge-sum-lab.md'), 'utf8').trimEnd() + '\n\n## 参考源码对照\n\n- 参考 matrix-lab 的矩阵、面板与反馈视觉；行为为新写。\n'
const raw = {
  lesson: 'demo-component-lesson',
  reuseSearch: [{
    slideId: 'S01',
    demand: '点击矩阵边缘格子并累计求和',
    registry: {
      query: 'matrix edge sum',
      tags: 'matrix,edge',
      level: 'modify',
      matches: [{ id: 'matrix-lab', version: '1.0.0', satisfied: false, reason: '只能高亮单元格，没有累计与错误反馈' }],
    },
  }],
  gaps: [{
    id: 'edge-sum-lab',
    slideIds: ['S01'],
    learningAction: 'modify',
    level: 'modify',
    whyExisting: 'matrix-lab 只高亮，没有求和状态、提交与漏选反馈',
    decision: 'new',
    brief: 'component-briefs/edge-sum-lab.md',
  }],
  mapping: [{ slideId: 'S01', demand: '点击边缘格子并累计求和', component: 'edge-sum-lab', source: 'new' }],
  risks: ['状态机遗漏换行'],
  nonGoals: ['不做任意尺寸矩阵'],
  briefs: [{ id: 'edge-sum-lab', markdown: briefMarkdown }],
}
fs.writeFileSync(
  path.join(mocks, 'component-plan.json'),
  JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(raw) }] }),
)
const result = spawnSync(process.execPath, [
  path.join(tools, 'generate-component-plan.mjs'),
  '--lesson-slug', 'demo-component-lesson',
  '--lesson', '演示组件课',
  '--script', script,
  '--style', path.join(examples, 'style-pack.example.json'),
  '--registry', path.join(examples, 'registry/index.json'),
  '--approval', approval,
  '--plan', plan,
  '--briefs', briefs,
  '--review-dir', review,
  '--mock-dir', mocks,
  '--max-attempts', '1',
  '--api', 'anthropic-messages',
  '--model', 'mock',
], { encoding: 'utf8', cwd: root })
if (result.status !== 0) {
  console.error(result.stdout, result.stderr)
  process.exit(1)
}
assert.ok(fs.existsSync(plan))
assert.match(fs.readFileSync(plan, 'utf8'), /## 2\. 缺口/)
assert.ok(fs.existsSync(path.join(briefs, 'edge-sum-lab.md')))
assert.match(fs.readFileSync(plan, 'utf8'), /edge-sum-lab/)
console.log('PASS structured component plan generation')
fs.rmSync(tmp, { recursive: true, force: true })
