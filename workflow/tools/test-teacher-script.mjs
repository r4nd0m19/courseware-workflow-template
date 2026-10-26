#!/usr/bin/env node
// Regression test for the teacher-facing script view. The view must contain
// the lesson content but none of the machine-only sections.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const toolDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(toolDir, '..', '..')
const source = path.join(root, 'workflow/examples/courseware.example.md')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-teacher-script-'))
const out = path.join(tmp, 'courseware.teacher.md')
const result = spawnSync(
  process.execPath,
  [path.join(toolDir, 'render-teacher-script.mjs'), source, '--out', out],
  { encoding: 'utf8' },
)
let failed = 0
function check(name, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`)
  if (!condition) failed += 1
}
check('renderer exits 0', result.status === 0)
let markdown = ''
try {
  markdown = fs.readFileSync(out, 'utf8')
} catch {
  // reported by the content checks below
}
check('includes the lesson title', markdown.startsWith('# 演示课'))
check('includes screen content', markdown.includes('### 屏幕内容'))
check('includes narration', markdown.includes('### 旁白'))
check('includes transition', markdown.includes('### 转场'))
check('includes a one-line student action', markdown.includes('> **学生要做**：'))
check('omits the interaction-design section', !markdown.includes('### 交互设计'))
check('omits the machine-fields section', !markdown.includes('### 制作字段'))
check('omits interaction YAML', !markdown.includes('interaction:'))
check('omits componentPlan YAML', !markdown.includes('componentPlan:'))
if (failed) {
  console.error(`${failed} teacher-script test(s) failed`)
  process.exit(1)
}
console.log('OK teacher script view')
