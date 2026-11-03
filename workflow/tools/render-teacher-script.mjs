#!/usr/bin/env node
// Render the teacher-facing view of a courseware script.
//
// The source of truth stays specs/<lesson>/courseware.md: it contains the
// interaction design and the machine fields that every parser/gate needs. This
// view keeps only what a teacher needs to approve the lesson content:
//   - per-screen objective / purpose
//   - screen content
//   - one-line student action summary
//   - narration
//   - transition
// It is generated deterministically, so the teacher-facing file can never drift
// from the approved source.
import fs from 'node:fs'
import path from 'node:path'
import { parseScript } from './script-lib.mjs'

const args = process.argv.slice(2)
const valueOptions = new Set(['--out', '--editorial-review'])
let positional = ''
for (let i = 0; i < args.length; i += 1) {
  if (valueOptions.has(args[i])) {
    i += 1
    continue
  }
  if (!args[i].startsWith('--')) {
    positional = args[i]
    break
  }
}
const outIndex = args.indexOf('--out')
const outPath = outIndex >= 0 ? args[outIndex + 1] : ''
const editorialIndex = args.indexOf('--editorial-review')
const editorialPath = editorialIndex >= 0 ? args[editorialIndex + 1] : ''
if (!positional) {
  console.error(
    'usage: node render-teacher-script.mjs <courseware.md> --out review/<lesson>/courseware.teacher.md [--editorial-review review/<lesson>/script-editorial-review.json]',
  )
  process.exit(2)
}

const LEVEL_LABELS = {
  watch: '观看',
  answer: '作答',
  modify: '修改',
  construct: '构造',
  explain: '解释',
}
const ACTION_LABELS = {
  observe: '观察',
  locate: '定位',
  label: '标注',
  predict: '预测',
  trace: '追踪',
  convert: '转换',
  classify: '分类',
  construct: '构造',
  modify: '修改',
  explain: '解释',
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function interactionSummary(machine) {
  const interaction = machine?.interaction
  if (!interaction) return ''
  const action = ACTION_LABELS[interaction.learningAction] || text(interaction.learningAction)
  const level = LEVEL_LABELS[interaction.level] || text(interaction.level)
  const evidence = text(interaction.evidence).replace(/\s+/g, ' ')
  if (!action && !evidence) return ''
  const parts = []
  if (interaction.level === 'watch') {
    parts.push(action || '观察')
  } else if (action || level) {
    parts.push(`${action || '学习'}${level ? `（${level}）` : ''}`)
  }
  if (evidence) {
    parts.push(
      `${interaction.level === 'watch' ? '看到什么算理解' : '做出来算会'}：${evidence}`,
    )
  }
  return parts.join('；')
}

function narrationMarkdown(narration) {
  const lines = String(narration || '').split(/\r?\n/)
  const out = []
  for (const line of lines) {
    if (!line.trim()) {
      out.push('>')
    } else {
      out.push(`> ${line}`)
    }
  }
  return out.join('\n').trim() || '>'
}

function slideMarkdown(slide) {
  const lines = []
  lines.push(`## ${slide.id} · ${slide.headingTitle}`, '')
  if (slide.objectiveLine) lines.push(`**对应目标**：${slide.objectiveLine}`, '')
  if (slide.purposeLine) lines.push(`**本屏作用**：${slide.purposeLine}`, '')

  lines.push('### 屏幕内容', '', slide.screenContent || '', '')

  const summary = interactionSummary(slide.machine)
  if (summary) lines.push(`> **学生要做**：${summary}`, '')

  lines.push('### 旁白', '', narrationMarkdown(slide.narration), '')
  if (slide.transition) lines.push('### 转场', '', slide.transition, '')
  return lines.join('\n').trimEnd()
}

const EDITORIAL_SEVERITY = {
  blocking: '严重',
  major: '建议',
  minor: '提示',
}
const EDITORIAL_DIMENSION = {
  'code-correctness': '代码正确性',
  'cross-reference': '跨页引用',
  'terminology-sequencing': '术语顺序',
  'answer-leakage': '答案泄露',
  'objective-alignment': '目标与证据',
  language: '语言',
  'practice-coverage': '练习覆盖',
  consistency: '一致性',
  other: '其他',
}

function readEditorialReview(file) {
  if (!file || !fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    console.error(`WARN cannot read editorial review ${file}: ${error.message}`)
    return null
  }
}

function editorialMarkdown(review) {
  const findings = Array.isArray(review.findings) ? review.findings : []
  const lines = [
    '---',
    '',
    '## 编辑审稿建议（供参考，不改变上面的脚本）',
    '',
  ]
  if (!findings.length) {
    lines.push('> 自动审稿没有发现需要修改的问题；这不替代您的判断。')
    return lines.join('\n')
  }
  lines.push(
    '> 这些是自动审稿给出的改进建议。若您认为某条需要改，请在审核时选择“不通过，需要改”。',
    '',
  )
  for (const severity of ['blocking', 'major', 'minor']) {
    const group = findings.filter((finding) => finding.severity === severity)
    if (!group.length) continue
    lines.push(`### ${EDITORIAL_SEVERITY[severity] || severity}`, '')
    for (const finding of group) {
      const dimension = EDITORIAL_DIMENSION[finding.dimension] || finding.dimension
      lines.push(
        `- **${finding.slideId} · ${dimension}**：${finding.suggestion}（依据：${finding.evidence}）`,
      )
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

const parsed = parseScript(path.resolve(positional))
const title = text(parsed.frontmatter.title) || path.basename(positional, '.md')
const lines = [
  `# ${title}`,
  '',
  '> 这是给老师看的脚本。每页显示屏幕内容、旁白和转场，并用一句话说明学生要做什么。',
  '> 完整的互动说明和制作数据保留在原始脚本中，由检查工具自动校验；本文件自动生成，请勿手改。',
  '',
]
for (const slide of parsed.slides) {
  lines.push(slideMarkdown(slide), '')
}
const editorial = readEditorialReview(editorialPath)
if (editorial) lines.push('', editorialMarkdown(editorial), '')
const markdown = `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd()}\n`
const target = outPath || positional.replace(/\.md$/i, '.teacher.md')
fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true })
fs.writeFileSync(path.resolve(target), markdown)
console.log(`OK teacher script ${target} — ${parsed.slides.length} slide(s)`)
