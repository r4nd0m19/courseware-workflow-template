#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import pixelmatch from 'pixelmatch'
import pngjs from 'pngjs'

const { PNG } = pngjs

const args = process.argv.slice(2)
const currentDir = args.find((a) => !a.startsWith('--'))
function opt(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
if (!currentDir) {
  console.error(`usage: node check-baseline.mjs <screenshots-dir> [options]

Options:
  --baseline <dir>          baseline screenshots (omit to skip)
  --include <ids>           comma-separated slide ids to compare
  --threshold <0-1>         pixelmatch color threshold (default: 0.1)
  --max-diff-ratio <0-1>    max differing pixel ratio (default: 0.002)
`)
  process.exit(2)
}

const baselineDir = opt('--baseline', '')
const include = new Set(
  opt('--include', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)
const threshold = Number(opt('--threshold', '0.1'))
const maxDiffRatio = Number(opt('--max-diff-ratio', '0.002'))

if (!baselineDir) {
  console.log('no baseline provided; screenshot baseline gate skipped')
  process.exit(0)
}
if (!fs.existsSync(baselineDir)) {
  console.error(`baseline dir not found: ${baselineDir}`)
  process.exit(2)
}
if (!fs.existsSync(currentDir)) {
  console.error(`current screenshots dir not found: ${currentDir}`)
  process.exit(2)
}

const diffDir = path.join(currentDir, 'diffs')
fs.mkdirSync(diffDir, { recursive: true })
const baselineFiles = fs
  .readdirSync(baselineDir)
  .filter((f) => f.toLowerCase().endsWith('.png'))
  .filter((f) => !include.size || include.has(f.replace(/\.png$/i, '')))
  .sort()
if (!baselineFiles.length) {
  console.error(
    include.size
      ? `no PNG baselines for included slides in ${baselineDir}`
      : `no PNG baselines in ${baselineDir}`,
  )
  process.exit(2)
}

const results = []
const errors = []
const warnings = []

for (const name of baselineFiles) {
  const basePath = path.join(baselineDir, name)
  const curPath = path.join(currentDir, name)
  if (!fs.existsSync(curPath)) {
    errors.push(`missing current screenshot: ${name}`)
    continue
  }
  const base = PNG.sync.read(fs.readFileSync(basePath))
  const cur = PNG.sync.read(fs.readFileSync(curPath))
  if (base.width !== cur.width || base.height !== cur.height) {
    errors.push(
      `size mismatch ${name}: baseline ${base.width}x${base.height}, current ${cur.width}x${cur.height}`,
    )
    continue
  }
  const diff = new PNG({ width: base.width, height: base.height })
  const diffPixels = pixelmatch(
    base.data,
    cur.data,
    diff.data,
    base.width,
    base.height,
    { threshold },
  )
  const ratio = diffPixels / (base.width * base.height)
  const pass = ratio <= maxDiffRatio
  if (!pass) {
    fs.writeFileSync(path.join(diffDir, name), PNG.sync.write(diff))
    errors.push(
      `diff ${name}: ${(ratio * 100).toFixed(3)}% > ${(maxDiffRatio * 100).toFixed(3)}%`,
    )
  }
  results.push({
    file: name,
    width: base.width,
    height: base.height,
    diffPixels,
    ratio,
    pass,
    diff: pass ? null : `diffs/${name}`,
  })
}

const baselineSet = new Set(baselineFiles)
for (const f of fs.readdirSync(currentDir)) {
  if (
    f.toLowerCase().endsWith('.png') &&
    !baselineSet.has(f) &&
    (!include.size || include.has(f.replace(/\.png$/i, '')))
  ) {
    warnings.push(`no baseline for current screenshot: ${f}`)
  }
}

const report = {
  baselineDir,
  currentDir,
  threshold,
  maxDiffRatio,
  totalBaselines: baselineFiles.length,
  results,
  errors,
  warnings,
}
fs.writeFileSync(
  path.join(currentDir, 'baseline-report.json'),
  JSON.stringify(report, null, 2),
)

console.log(
  `baseline: ${results.filter((r) => r.pass).length}/${baselineFiles.length} pass`,
)
for (const w of warnings) console.warn(`WARN ${w}`)
for (const e of errors) console.error(`FAIL ${e}`)
if (errors.length) process.exit(1)
