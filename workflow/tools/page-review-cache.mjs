#!/usr/bin/env node
// Reuse a page AI self-review when the page-specific inputs are unchanged.
//
// The cache stores the final review JSON and a key over the page's script,
// density signals, reference mapping, deterministic check summaries, PNG and
// AI-image bytes, staged component bytes, deck slide and registry. Shared-file
// changes do NOT invalidate the AI judgment: the cached judgment fields are
// merged into the fresh skeleton so reviewedArtifacts/automatedChecks stay
// current.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readData } from './lib.mjs'
import { parseFlagValue } from './self-review-lib.mjs'
import { readStagedComponents } from './page-review-lib.mjs'

const CACHE_FORMAT = 'page-review-v2'
const args = process.argv.slice(2)
const mode = parseFlagValue(args, '--mode')
const lessonSlug = parseFlagValue(args, '--lesson-slug')
const section = parseFlagValue(args, '--section')
const evidencePath = parseFlagValue(args, '--evidence')
const deckPath = parseFlagValue(args, '--deck')
const registryPath = parseFlagValue(args, '--registry', 'registry/index.json')
const stagingDir = parseFlagValue(args, '--staging', 'registry/staging')
const unregistered = String(parseFlagValue(args, '--unregistered') || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)
const cacheDir = parseFlagValue(args, '--cache-dir', `review/${lessonSlug}/page-review-cache`)
const reviewJson = parseFlagValue(args, '--review-json')
const jsonOut = args.includes('--json')

if (!mode || !lessonSlug || !section || !evidencePath || !deckPath || !reviewJson) {
  console.error(
    'usage: node page-review-cache.mjs --mode check|store --lesson-slug <slug> --section <id> --evidence <page-evidence.json> --deck <deck.json> --review-json <self-review-page.json> --cache-dir <dir> [--registry <index.json>] [--staging <dir>] [--unregistered <id,id>] [--json]',
  )
  process.exit(2)
}

function sha256File(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  } catch {
    return ''
  }
}

function keyFor(evidence, staged) {
  const deck = readData(deckPath)
  const deckById = new Map((deck.slides || []).map((slide) => [slide.id, slide]))
  const deckSlides = (evidence.section?.slides || []).map((id) => deckById.get(id) || { id, missing: true })
  const payload = {
    format: CACHE_FORMAT,
    section,
    scriptSlides: evidence.scriptSlides || [],
    density: evidence.density || null,
    referenceAdaptation: evidence.referenceAdaptation || null,
    checks: (evidence.checks || []).map(({ name, status, summary }) => ({ name, status, summary })),
    screenshots: (evidence.screenshots || []).map((shot) => ({
      slideId: shot.slideId,
      sha256: sha256File(shot.png),
      aiImageSha256: sha256File(shot.aiImage),
    })),
    stagedComponents: staged.artifacts,
    deckSlides,
    registrySha256: sha256File(registryPath),
  }
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

const cacheFile = path.join(cacheDir, `${section}.json`)
const evidence = readData(evidencePath)
let staged = { summaries: [], artifacts: [] }
try {
  staged = readStagedComponents({ stagingDir, ids: unregistered, root: process.cwd() })
} catch (error) {
  console.error(`FAIL page review cache — ${error.message}`)
  process.exit(1)
}
const key = keyFor(evidence, staged)

function emit(result) {
  if (jsonOut) process.stdout.write(`${JSON.stringify(result)}\n`)
  else {
    console.log(
      `${result.reuse ? 'REUSE' : 'MISS'} ${section} key=${key.slice(0, 12)} ${result.reason || ''}`,
    )
  }
}

if (mode === 'check') {
  if (!fs.existsSync(cacheFile)) {
    emit({ reuse: false, key, cacheFile, reason: 'no cache entry' })
    process.exit(0)
  }
  let cached
  try {
    cached = readData(cacheFile)
  } catch (error) {
    emit({ reuse: false, key, cacheFile, reason: `cannot read cache: ${error.message}` })
    process.exit(0)
  }
  if (cached.key !== key) {
    emit({ reuse: false, key, cacheFile, reason: 'page inputs changed' })
    process.exit(0)
  }
  const review = cached.review
  if (!review || review.verdict !== 'pass') {
    emit({ reuse: false, key, cacheFile, reason: 'cached review is not pass' })
    process.exit(0)
  }
  let skeleton
  try {
    skeleton = readData(reviewJson)
  } catch (error) {
    emit({ reuse: false, key, cacheFile, reason: `cannot read skeleton: ${error.message}` })
    process.exit(0)
  }
  const oldDensity = new Map((review.density || []).map((entry) => [entry.slideId, entry]))
  let mergeable = true
  const density = (skeleton.density || []).map((entry) => {
    const old = oldDensity.get(entry.slideId)
    if (!old || !Array.isArray(old.semanticUnits) || !old.semanticUnits.length) {
      mergeable = false
      return entry
    }
    return {
      ...entry,
      semanticUnits: old.semanticUnits,
      verdict: old.verdict || 'fail',
      notes: old.notes || '',
    }
  })
  const oldChecklist = new Map((review.checklist || []).map((item) => [item.item, item]))
  const checklist = (skeleton.checklist || []).map((item) => {
    const old = oldChecklist.get(item.item)
    if (!old) {
      mergeable = false
      return item
    }
    return { ...item, status: old.status, notes: old.notes }
  })
  if (!mergeable) {
    emit({ reuse: false, key, cacheFile, reason: 'cached review shape is incomplete' })
    process.exit(0)
  }
  const seenArtifacts = new Set()
  const reviewedArtifacts = []
  for (const artifact of [...(skeleton.reviewedArtifacts || []), ...staged.artifacts]) {
    if (!artifact?.path || !artifact?.sha256 || seenArtifacts.has(artifact.path)) continue
    seenArtifacts.add(artifact.path)
    reviewedArtifacts.push(artifact)
  }
  const artifactPaths = [
    ...new Set([
      ...(skeleton.artifactPaths || []),
      ...reviewedArtifacts.map((artifact) => artifact.path),
    ]),
  ]
  const merged = {
    ...skeleton,
    artifactPaths,
    reviewedArtifacts,
    density,
    checklist,
    issues: (review.issues || []).filter(
      (issue) => !/^共享(文件|组件)/.test(String(issue.description || '')),
    ),
    referenceAdaptation: review.referenceAdaptation || skeleton.referenceAdaptation,
    verdict: review.verdict,
    reviewedAt: new Date().toISOString(),
    ...(review.reviewMeta
      ? { reviewMeta: { ...review.reviewMeta, cached: true } }
      : {}),
  }
  fs.mkdirSync(path.dirname(path.resolve(reviewJson)), { recursive: true })
  fs.writeFileSync(path.resolve(reviewJson), `${JSON.stringify(merged, null, 2)}\n`)
  emit({ reuse: true, key, cacheFile, reason: 'reused AI judgment fields; refreshed hashes' })
  process.exit(0)
}

if (mode === 'store') {
  let review
  try {
    review = readData(reviewJson)
  } catch (error) {
    console.error(`cannot read review JSON ${reviewJson}: ${error.message}`)
    process.exit(1)
  }
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(
    path.resolve(cacheFile),
    `${JSON.stringify(
      {
        schemaVersion: '1.0',
        format: CACHE_FORMAT,
        lesson: lessonSlug,
        section,
        key,
        storedAt: new Date().toISOString(),
        review,
      },
      null,
      2,
    )}\n`,
  )
  emit({ reuse: true, key, cacheFile, reason: 'stored' })
  process.exit(0)
}

console.error(`unknown mode: ${mode}`)
process.exit(2)
