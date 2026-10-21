#!/usr/bin/env node
// Render a self-review Markdown file from its JSON. The JSON is the source of
// truth; this keeps the human-readable review in sync and saves the reviewing
// model from writing the same prose twice.
import fs from 'node:fs'
import path from 'node:path'
import { readData } from './lib.mjs'
import { renderSelfReviewMarkdown, relativePath } from './self-review-lib.mjs'

const args = process.argv.slice(2)
const jsonPath = args.find((arg) => !arg.startsWith('--'))
const outIndex = args.indexOf('--out')
const outPath = outIndex >= 0 ? args[outIndex + 1] : ''
const screenshotIndex = args.indexOf('--screenshots')
const screenshotDir = screenshotIndex >= 0 ? args[screenshotIndex + 1] : ''
const slidesIndex = args.indexOf('--slides')
const onlySlides = slidesIndex >= 0
  ? new Set(
      String(args[slidesIndex + 1] || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )
  : null

if (!jsonPath) {
  console.error('usage: node render-self-review-md.mjs <review/self-review-*.json> [--out <review/self-review-*.md>] [--screenshots <dir>] [--slides S02B,S02C]')
  process.exit(2)
}

let review
try {
  review = readData(jsonPath)
} catch (error) {
  console.error(`FAIL cannot read ${jsonPath}: ${error.message}`)
  process.exit(1)
}

const mdPath = outPath || jsonPath.replace(/\.json$/i, '.md')
const screenshotPaths = []
if (screenshotDir && fs.existsSync(screenshotDir)) {
  for (const name of fs.readdirSync(screenshotDir)) {
    if (!name.endsWith('.png')) continue
    if (onlySlides && !onlySlides.has(name.slice(0, -4))) continue
    screenshotPaths.push(relativePath(path.join(screenshotDir, name)))
  }
}
fs.mkdirSync(path.dirname(path.resolve(mdPath)), { recursive: true })
fs.writeFileSync(path.resolve(mdPath), renderSelfReviewMarkdown(review, { screenshotPaths }))
console.log(`OK rendered ${mdPath}`)
