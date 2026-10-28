#!/usr/bin/env node
// Render the human-readable courseware.md from structured outline + page JSON.
//
// The model never writes this file. Node owns every heading, label, code fence
// and machine YAML block so parseScript() sees the same contract every time.
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { readData } from './lib.mjs'
import { cleanOneLine, renderSlideBlock } from './script-render-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
function die(message) {
  console.error(`FAIL render courseware.md — ${message}`)
  process.exit(1)
}
const inputPath = opt('--input')
const outlinePath = opt('--outline')
const pagesDir = opt('--pages-dir')
const input = inputPath && fs.existsSync(path.resolve(inputPath)) ? readData(inputPath) : null
const outPath = opt('--out', input?.outputs?.courseware || '')
if (!inputPath || !outlinePath || !pagesDir || !outPath) {
  console.error(
    'usage: node render-courseware-md.mjs --input <script-input.json> --outline <outline.json> --pages-dir <dir> --out <courseware.md>',
  )
  process.exit(2)
}

if (!input) die(`cannot read ${inputPath}`)
const outline = readData(outlinePath)
if (!Array.isArray(outline.pages) || !outline.pages.length) die(`${outlinePath} has no pages`)

function pageFile(id) {
  return path.join(pagesDir, `${id}.json`)
}
function renderOverview(overview) {
  const objectives = (overview.objectives || []).map((objective) => `${objective.id} ${objective.text}`).join('；')
  const misconceptions = (overview.misconceptions || [])
    .map((misconception) => `${misconception.id} ${misconception.text}`)
    .join('；')
  return [
    '## 本课概览',
    '',
    `- **学习者 / 先修**：${cleanOneLine(overview.learners)}`,
    `- **教学目标**：${cleanOneLine(objectives)}`,
    `- **常见误区**：${cleanOneLine(misconceptions)}`,
    `- **课堂节奏**：${cleanOneLine(overview.pace)}`,
    `- **组件策略**：${cleanOneLine(overview.componentStrategy)}`,
  ].join('\n')
}

const frontmatter = {
  lesson: input.lessonSlug,
  title: outline.title,
  contentPack: input.content?.path || '',
  stylePack: input.style?.path || '',
  componentRegistry: input.registry?.path || 'registry/index.json',
  audience: outline.audience,
  duration: outline.duration,
  status: 'DRAFT',
  scriptVersion: '0.1',
}

const blocks = [
  '---',
  YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd(),
  '---',
  '',
  `# 课件脚本：${outline.title}`,
  '',
  '> 这是生成课件前的**人类可读唯一内容源**。老师直接修改本文件；`storyboard.yml` 由本文件生成，不手改。',
  '> 老师审核时看自动生成的老师版脚本（只含屏幕内容、旁白、转场和一行“学生要做”摘要）；交互设计与制作字段留在本文件里供检查工具使用。',
  '> 规则：屏幕内容与旁白分开；交互写清动作、反馈、完成条件；旁白写逐字稿；不允许 TODO/待定。',
  '> 概念：`concepts.yml` 是核心概念的唯一台账。每个概念必须在 `introducedOn` 页的**屏幕内容**里写出术语、定义和全部 `mustAppear` 短语。',
  '> 一页一个教学单元；不允许滚动条。',
  '',
  renderOverview(outline.overview),
  '',
]

for (const outlinePage of outline.pages) {
  const pagePath = pageFile(outlinePage.id)
  if (!fs.existsSync(pagePath)) die(`missing page JSON: ${pagePath}`)
  const page = readData(pagePath)
  if (page.id !== outlinePage.id) die(`${pagePath}: page.id ${page.id} != ${outlinePage.id}`)
  if (page.title !== outlinePage.title) die(`${pagePath}: page.title does not match outline`)
  blocks.push(renderSlideBlock(outlinePage, page), '')
}

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(path.resolve(outPath), `${blocks.join('\n').trimEnd()}\n`)
console.log(`OK render courseware.md — ${outline.pages.length} page(s) -> ${outPath}`)
