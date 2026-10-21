#!/usr/bin/env node
// Validate the per-lesson reference adaptation map.
//
// The map is generated once per lesson from the reference shell source and the
// approved lesson script. Page self-reviews consume it instead of re-reading
// the same reference source on every page.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readData, validateWithSchema, fail, ok } from './lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const mappingPath = args.find((arg) => !arg.startsWith('--'))
const storyboardPath = opt('--storyboard')
const scriptPath = opt('--script')
const shellPath = opt('--shell')
const lessonSlug = opt('--lesson-slug')

if (!mappingPath) {
  console.error(
    'usage: node check-reference-adaptation.mjs <review/<lesson>/reference-adaptation.json> --storyboard <storyboard.yml> [--script <courseware.md>] [--shell <shell-dir>] [--lesson-slug <slug>]',
  )
  process.exit(2)
}

let data
try {
  data = readData(mappingPath)
} catch (error) {
  fail(`reference adaptation ${mappingPath}`, [`cannot read: ${error.message}`])
  process.exit(1)
}

const { ok: schemaOk, errors: schemaErrors } = validateWithSchema(
  fileURLToPath(new URL('../schemas/reference-adaptation.schema.json', import.meta.url)),
  data,
)
if (!schemaOk) {
  fail(`reference adaptation schema ${mappingPath}`, schemaErrors)
  process.exit(1)
}

const problems = []
if (lessonSlug && data.lesson !== lessonSlug) {
  problems.push(`lesson is ${data.lesson}, expected ${lessonSlug}`)
}
if (!fs.existsSync(path.resolve(data.referenceSource))) {
  problems.push(`referenceSource not found: ${data.referenceSource}`)
}
if (scriptPath && !fs.existsSync(path.resolve(scriptPath))) {
  problems.push(`script not found: ${scriptPath}`)
}

let activeSlides = new Set()
if (storyboardPath) {
  try {
    const storyboard = readData(storyboardPath)
    activeSlides = new Set(
      (storyboard.slides || [])
        .filter((slide) => slide.status !== 'SKIP')
        .map((slide) => slide.id),
    )
  } catch (error) {
    problems.push(`cannot read storyboard ${storyboardPath}: ${error.message}`)
  }
}

const ids = new Set()
let replaceCount = 0
let allowCount = 0
const coveredPages = new Set()
for (const entry of data.entries) {
  if (ids.has(entry.id)) problems.push(`duplicate entry id ${entry.id}`)
  ids.add(entry.id)
  if (!entry.reference.trim()) problems.push(`${entry.id}: empty reference`)
  if (!entry.lesson.trim()) problems.push(`${entry.id}: empty lesson replacement`)
  if (!entry.evidence.trim()) problems.push(`${entry.id}: empty evidence`)
  if (entry.residue === 'replace') {
    replaceCount += 1
    const normalizedReference = entry.reference.replace(/\s+/g, '')
    const normalizedLesson = entry.lesson.replace(/\s+/g, '')
    if (normalizedReference === normalizedLesson && !String(entry.lessonText || '').trim()) {
      problems.push(
        `${entry.id}: residue=replace but lesson replacement is identical to the reference; mark it allow or give a distinct lessonText`,
      )
    }
  } else {
    allowCount += 1
  }
  for (const page of entry.pages) {
    if (activeSlides.size && !activeSlides.has(page)) {
      problems.push(`${entry.id}: page ${page} is not an active slide in the storyboard`)
    }
    coveredPages.add(page)
  }
}
if (replaceCount === 0) {
  problems.push('no entry is marked residue=replace; the map does not actually replace anything')
}

for (const item of data.unmapped || []) {
  if (item.residue === 'replace' && item.reference.trim().length < 2) {
    problems.push(`unmapped replace entry is too short to scan safely: ${JSON.stringify(item.reference)}`)
  }
}

if (problems.length) fail(`reference adaptation ${mappingPath}`, problems)
else
  ok(
    `reference adaptation ${mappingPath}`,
    `${data.entries.length} entries (${replaceCount} replace, ${allowCount} allow), ${coveredPages.size} page(s) covered`,
  )
if (problems.length) process.exit(1)
