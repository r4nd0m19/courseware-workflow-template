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
const positional = args.find((arg) => !arg.startsWith('--'))
const outIndex = args.indexOf('--out')
const outPath = outIndex >= 0 ? args[outIndex + 1] : ''
if (!positional) {
  console.error(
    'usage: node render-teacher-script.mjs <courseware.md> --out review/<lesson>/courseware.teacher.md',
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
  const shortEvidence =
    evidence.length > 160 ? `${evidence.slice(0, 157).trimEnd()}…` : evidence
  if (!action && !evidence) return ''
  const parts = []
  if (interaction.level === 'watch') {
    parts.push(action || '观察')
  } else if (action || level) {
    parts.push(`${action || '学习'}${level ? `（${level}）` : ''}`)
  }
  if (shortEvidence) {
    parts.push(
      `${interaction.level === 'watch' ? '看到什么算理解' : '做出来算会'}：${shortEvidence}`,
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
const markdown = `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd()}\n`
const target = outPath || positional.replace(/\.md$/i, '.teacher.md')
fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true })
fs.writeFileSync(path.resolve(target), markdown)
console.log(`OK teacher script ${target} — ${parsed.slides.length} slide(s)`)
