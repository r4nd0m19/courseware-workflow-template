#!/usr/bin/env node
// Repeatable benchmark for the page self-review pipeline.
//
// This measures the deterministic part of a page review (evidence bundle,
// screenshots, JSON skeleton, Markdown render) against a running site. It does
// not call an AI model; use workflow-timing.mjs on a real run for the AI step.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { readData } from './lib.mjs'
import { serveDir } from './shell-lib.mjs'
import { parseFlagValue, toolDir } from './self-review-lib.mjs'

const args = process.argv.slice(2)
const lessonSlug = parseFlagValue(args, '--lesson-slug')
const scriptPath = parseFlagValue(
  args,
  '--script',
  lessonSlug ? `specs/${lessonSlug}/courseware.md` : '',
)
const contentPath = parseFlagValue(args, '--content')
const storyboardPath = parseFlagValue(
  args,
  '--storyboard',
  lessonSlug ? `specs/${lessonSlug}/storyboard.yml` : '',
)
const sectionsPath = parseFlagValue(
  args,
  '--sections',
  lessonSlug ? `specs/${lessonSlug}/review-sections.yml` : '',
)
const deckPath = parseFlagValue(args, '--deck', lessonSlug ? `specs/${lessonSlug}/deck.json` : '')
const conceptsPath = parseFlagValue(
  args,
  '--concepts',
  lessonSlug ? `specs/${lessonSlug}/concepts.yml` : '',
)
const screenshotsDir = parseFlagValue(args, '--screenshots', `screenshots/${lessonSlug}`)
const narrationPath = parseFlagValue(args, '--narration')
const audioRoot = parseFlagValue(args, '--audio-root')
const shell = parseFlagValue(args, '--shell', 'branch-choice')
const referenceSource = parseFlagValue(args, '--reference-source', `shells/${shell}/source/lesson.js`)
const referenceAdaptation = parseFlagValue(
  args,
  '--reference-adaptation',
  `review/${lessonSlug}/reference-adaptation.json`,
)
const siteDir = parseFlagValue(args, '--site-dir')
const explicitUrl = parseFlagValue(args, '--url')
const sectionFilter = parseFlagValue(args, '--section')
const repeat = Math.max(1, Number(parseFlagValue(args, '--repeat', '1')) || 1)
const jsonOut = args.includes('--json')
const outFile = parseFlagValue(args, '--out')

if (!lessonSlug || !scriptPath || !contentPath || !storyboardPath || !sectionsPath || !deckPath || !conceptsPath) {
  console.error(
    'usage: node bench-page-review.mjs --lesson-slug <slug> --content <content-pack.json> [options]',
  )
  console.error(
    'defaults: --script specs/<slug>/courseware.md --storyboard specs/<slug>/storyboard.yml --sections specs/<slug>/review-sections.yml --deck specs/<slug>/deck.json --concepts specs/<slug>/concepts.yml',
  )
  console.error(
    'options: --screenshots <dir> --narration <json> --audio-root <dir> --shell <id> --reference-source <file> --reference-adaptation <json> --site-dir <dir> --url <url> --section <id> --repeat <n> --json --out <file>',
  )
  process.exit(2)
}

// Async spawn is required: the benchmark hosts the static server in this
// process, so a synchronous child would block the event loop and the child's
// Playwright requests would hang.
function timed(tool, toolArgs) {
  return new Promise((resolve) => {
    const started = performance.now()
    const child = spawn(process.execPath, [path.join(toolDir, tool), ...toolArgs], {
      cwd: process.cwd(),
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      if (stdout.length < 32 * 1024 * 1024) stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 32 * 1024 * 1024) stderr += chunk
    })
    child.on('error', (error) => {
      resolve({
        durationMs: performance.now() - started,
        status: -1,
        stdout,
        stderr: String(error.message || error),
      })
    })
    child.on('close', (status) => {
      resolve({
        durationMs: performance.now() - started,
        status,
        stdout,
        stderr,
      })
    })
  })
}

function fileSize(file) {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

function pagePromptBytes() {
  try {
    const workflow = readData('workflow/workflows/courseware-production.yml')
    const walk = (steps) => {
      for (const step of steps || []) {
        if (step.id === 'self-review-page' && step.prompt) return step.prompt
        for (const key of ['steps', 'then', 'else']) {
          const found = walk(step[key])
          if (found) return found
        }
      }
      return null
    }
    return Buffer.byteLength(walk(workflow.steps) || '', 'utf8')
  } catch {
    return 0
  }
}

const manifest = readData(sectionsPath)
let sections = manifest.sections || []
if (sectionFilter) {
  const wanted = new Set(sectionFilter.split(',').map((id) => id.trim()).filter(Boolean))
  sections = sections.filter((section) => wanted.has(section.id))
}
if (!sections.length) {
  console.error('no sections selected')
  process.exit(2)
}

let server = null
let url = explicitUrl
if (!url) {
  const dir = siteDir || (fs.existsSync(`site/${lessonSlug}`) ? `site/${lessonSlug}` : 'prototype/shell-site')
  if (!fs.existsSync(dir)) {
    console.error(`site dir not found: ${dir}; pass --site-dir or --url`)
    process.exit(2)
  }
  server = await serveDir(dir, 0)
  url = server.url
}

const promptBytes = pagePromptBytes()
const results = []
try {
  for (let round = 1; round <= repeat; round += 1) {
    for (const section of sections) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-page-bench-'))
      const evidencePath = path.join(tmp, `page-evidence-${section.id}.json`)
      const reviewJson = path.join(tmp, `self-review-page-${section.id}.json`)
      const reviewMd = path.join(tmp, `self-review-page-${section.id}.md`)
      const common = [
        '--manual',
        '--lesson-slug', lessonSlug,
        '--script', scriptPath,
        '--content', contentPath,
        '--storyboard', storyboardPath,
        '--sections', sectionsPath,
        '--section', section.id,
        '--deck', deckPath,
        '--screenshots', screenshotsDir,
        '--url', url,
        '--concepts', conceptsPath,
        '--reference-source', referenceSource,
        '--reference-adaptation', referenceAdaptation,
        '--out', evidencePath,
        '--review-json', reviewJson,
        '--review-md', reviewMd,
      ]
      if (narrationPath) common.push('--narration', narrationPath)
      if (audioRoot) common.push('--audio-root', audioRoot)

      const evidence = await timed('build-page-evidence.mjs', common)
      const render = await timed('render-self-review-md.mjs', [reviewJson, '--out', reviewMd])
      let evidenceJson = null
      try {
        evidenceJson = readData(evidencePath)
      } catch {
        evidenceJson = null
      }
      const screenshotBytes = (evidenceJson?.screenshots || []).reduce(
        (sum, shot) => sum + fileSize(shot.png),
        0,
      )
      const aiImageBytes = (evidenceJson?.screenshots || []).reduce(
        (sum, shot) => sum + fileSize(shot.aiImage || ''),
        0,
      )
      const evidenceBytes = fileSize(evidencePath)
      const skeletonBytes = fileSize(reviewJson)
      results.push({
        round,
        section: section.id,
        title: section.title,
        slides: section.slides,
        evidenceSeconds: Number((evidence.durationMs / 1000).toFixed(3)),
        evidenceStatus: evidence.status === 0 ? 'pass' : 'fail',
        evidenceBytes,
        skeletonBytes,
        screenshotBytes,
        aiImageBytes,
        renderMs: Number(render.durationMs.toFixed(1)),
        renderStatus: render.status === 0 ? 'pass' : 'fail',
        checks: (evidenceJson?.checks || []).map((check) => ({
          name: check.name,
          status: check.status,
          durationMs: check.durationMs || 0,
        })),
        evidenceFile: evidencePath,
        error: evidence.status === 0 ? '' : String(evidence.stderr || '').slice(0, 500),
      })
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }
} finally {
  if (server) await server.close()
}

const bySection = new Map()
for (const result of results) {
  const list = bySection.get(result.section) || []
  list.push(result)
  bySection.set(result.section, list)
}
const summary = [...bySection.entries()].map(([section, runs]) => {
  const avg = (key) => runs.reduce((sum, run) => sum + run[key], 0) / runs.length
  return {
    section,
    title: runs[0].title,
    runs: runs.length,
    evidenceSecondsAvg: Number(avg('evidenceSeconds').toFixed(3)),
    evidenceSecondsMax: Number(Math.max(...runs.map((run) => run.evidenceSeconds)).toFixed(3)),
    evidenceBytesAvg: Math.round(avg('evidenceBytes')),
    skeletonBytesAvg: Math.round(avg('skeletonBytes')),
    screenshotBytesAvg: Math.round(avg('screenshotBytes')),
    aiImageBytesAvg: Math.round(avg('aiImageBytes')),
    renderMsAvg: Number(avg('renderMs').toFixed(1)),
    passRate: runs.filter((run) => run.evidenceStatus === 'pass').length / runs.length,
  }
})
const overall = {
  promptBytes,
  pages: summary.length,
  runs: results.length,
  evidenceSecondsAvg:
    results.reduce((sum, run) => sum + run.evidenceSeconds, 0) / results.length,
  estimatedTextTokensAvg:
    (results.reduce((sum, run) => sum + run.evidenceBytes + run.skeletonBytes, 0) /
      results.length +
      promptBytes) /
    4,
}
const checkTotals = new Map()
for (const result of results) {
  for (const check of result.checks) {
    const row = checkTotals.get(check.name) || { name: check.name, runs: 0, totalMs: 0, maxMs: 0 }
    row.runs += 1
    row.totalMs += check.durationMs
    row.maxMs = Math.max(row.maxMs, check.durationMs)
    checkTotals.set(check.name, row)
  }
}
const slowestChecks = [...checkTotals.values()]
  .map((row) => ({
    name: row.name,
    runs: row.runs,
    avgMs: Math.round(row.totalMs / row.runs),
    maxMs: row.maxMs,
  }))
  .sort((a, b) => b.avgMs - a.avgMs)
const report = { url, lessonSlug, repeat, promptBytes, overall, summary, slowestChecks, results }

if (outFile) fs.writeFileSync(path.resolve(outFile), `${JSON.stringify(report, null, 2)}\n`)
if (jsonOut) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  console.log(`URL: ${url}`)
  console.log(`Prompt bytes: ${promptBytes}; pages: ${summary.length}; runs: ${results.length}`)
  console.log('')
  console.log('section  evidence_s  evidence_KB  skeleton_KB  screenshot_KB  render_ms  pass')
  for (const row of summary) {
    console.log(
      `${row.section.padEnd(7)}  ${row.evidenceSecondsAvg.toFixed(2).padStart(10)}  ` +
        `${(row.evidenceBytesAvg / 1024).toFixed(1).padStart(11)}  ` +
        `${(row.skeletonBytesAvg / 1024).toFixed(1).padStart(11)}  ` +
        `${(row.screenshotBytesAvg / 1024).toFixed(1).padStart(13)}  ` +
        `${row.renderMsAvg.toFixed(1).padStart(9)}  ${(row.passRate * 100).toFixed(0)}%`,
    )
  }
  console.log('')
  const aiImageAvg =
    summary.reduce((sum, row) => sum + row.aiImageBytesAvg, 0) / Math.max(1, summary.length)
  console.log(
    `Average evidence: ${overall.evidenceSecondsAvg.toFixed(2)} s/page; ` +
      `AI image: ${(aiImageAvg / 1024).toFixed(1)} KB/page; ` +
      `estimated text tokens: ${Math.round(overall.estimatedTextTokensAvg)}/page`,
  )
  console.log('')
  console.log('slowest deterministic checks:')
  for (const check of slowestChecks.slice(0, 6)) {
    console.log(`  ${check.name.padEnd(22)} avg ${String(check.avgMs).padStart(5)} ms  max ${String(check.maxMs).padStart(5)} ms`)
  }
  console.log('')
  console.log('AI self-review is not measured here; use workflow-timing.mjs on a real run.')
  if (outFile) console.log(`Report: ${path.resolve(outFile)}`)
}
