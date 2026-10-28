#!/usr/bin/env node
// Render review-sections.yml from the structured script outline.
//
// One section per page is a workflow invariant (validateSectionManifest), so
// Node can derive this file mechanically instead of asking a model to repeat it.
import fs from 'node:fs'
import path from 'node:path'
import { readData } from './lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
const outlinePath = opt('--outline')
const outPath = opt('--out')
if (!outlinePath || !outPath) {
  console.error('usage: node render-review-sections.mjs --outline <outline.json> --out <review-sections.yml>')
  process.exit(2)
}
const outline = readData(outlinePath)
const pages = Array.isArray(outline.pages) ? outline.pages : []
if (!pages.length) {
  console.error(`FAIL render review-sections.yml — ${outlinePath} has no pages`)
  process.exit(1)
}
const seen = new Set()
const errors = []
for (const page of pages) {
  if (seen.has(page.id)) errors.push(`duplicate page id ${page.id}`)
  seen.add(page.id)
  if (!String(page.title || '').trim()) errors.push(`page ${page.id} has no title`)
}
if (errors.length) {
  console.error('FAIL render review-sections.yml')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

const lines = [
  '# 逐页渲染审核清单',
  '#',
  '# 由 render-review-sections.mjs 从结构化脚本大纲生成；不要手改。',
  '# 每个 section 恰好一屏；老师逐页审核。',
  'schemaVersion: "1.0"',
  'sections:',
]
for (const page of pages) {
  lines.push(`  - id: ${page.id}`)
  lines.push(`    title: ${JSON.stringify(page.title)}`)
  lines.push(`    slides: [${page.id}]`)
}
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(path.resolve(outPath), `${lines.join('\n')}\n`)
console.log(`OK render review-sections.yml — ${pages.length} page(s) -> ${outPath}`)
