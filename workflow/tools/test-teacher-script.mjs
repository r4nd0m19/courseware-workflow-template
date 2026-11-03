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

// Long evidence must not be cut at an arbitrary character count: the teacher
// needs the full student-action evidence to judge the page.
const longEvidence = '这是一段用于验证老师版脚本不会截断的学生动作证据，'.repeat(8)
const longSource = path.join(tmp, 'long-evidence.md')
fs.writeFileSync(
  longSource,
  fs.readFileSync(source, 'utf8').replace(
    'evidence: "能用“指令按顺序执行”复述程序的含义"',
    `evidence: "${longEvidence}"`,
  ),
)
const longOut = path.join(tmp, 'long-evidence.teacher.md')
const longResult = spawnSync(
  process.execPath,
  [path.join(toolDir, 'render-teacher-script.mjs'), longSource, '--out', longOut],
  { encoding: 'utf8' },
)
const longMarkdown = fs.existsSync(longOut) ? fs.readFileSync(longOut, 'utf8') : ''
check('renders long evidence', longResult.status === 0)
check('does not truncate long evidence', longMarkdown.includes(longEvidence))
check('does not add a truncation marker', !longMarkdown.includes('…'))

// Advisory editorial findings belong in a clearly separated appendix, not in
// the script body.
const editorialPath = path.join(tmp, 'editorial-review.json')
fs.writeFileSync(editorialPath, JSON.stringify({
  stage: 'script-editorial',
  artifactPaths: [source],
  reviewedArtifacts: [{ path: source, sha256: '0'.repeat(64) }],
  summary: '审稿总结',
  findings: [{
    slideId: 'S01',
    dimension: 'code-correctness',
    severity: 'major',
    evidence: '程序是一组指令',
    suggestion: '补一句关于执行顺序的说明。',
  }],
  verdict: 'revise',
  reviewedAt: '2026-11-03T00:00:00Z',
}, null, 2))
const editorialOut = path.join(tmp, 'editorial.teacher.md')
const editorialResult = spawnSync(
  process.execPath,
  [
    path.join(toolDir, 'render-teacher-script.mjs'),
    source,
    '--out',
    editorialOut,
    '--editorial-review',
    editorialPath,
  ],
  { encoding: 'utf8' },
)
const editorialMarkdown = fs.existsSync(editorialOut)
  ? fs.readFileSync(editorialOut, 'utf8')
  : ''
check('renders the editorial appendix', editorialResult.status === 0)
check('editorial appendix has a clear heading', editorialMarkdown.includes('## 编辑审稿建议'))
check('editorial appendix includes the suggestion', editorialMarkdown.includes('补一句关于执行顺序的说明'))
check('editorial appendix leaves the script body intact', editorialMarkdown.includes('### 屏幕内容'))
if (failed) {
  console.error(`${failed} teacher-script test(s) failed`)
  process.exit(1)
}
console.log('OK teacher script view')
