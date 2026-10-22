#!/usr/bin/env node
// Build one page's evidence bundle for the AI self-review. The shell gates have
// already run; this tool reruns the cheap checks, captures their results and
// the screenshot metadata, and writes one JSON so the self-review prompt does
// not have to re-run commands or read the whole script/storyboard/deck.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readData } from './lib.mjs'
import { parseScript } from './script-lib.mjs'
import { readSectionManifest, sectionById } from './section-lib.mjs'
import { requireProductionRun } from './review-guard.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
function flag(name) {
  return args.includes(name)
}
const manual = flag('--manual')
requireProductionRun({ tool: 'build-page-evidence', manual })

const lessonSlug = opt('--lesson-slug')
const scriptPath = opt('--script')
const contentPath = opt('--content')
const storyboardPath = opt('--storyboard')
const sectionsPath = opt('--sections')
const sectionId = opt('--section')
const deckPath = opt('--deck')
const screenshotsDir = opt('--screenshots')
const url = opt('--url')
const conceptsPath = opt('--concepts')
const narrationPath = opt('--narration')
const audioRoot = opt('--audio-root')
const outPath = opt(
  '--out',
  path.join('review', lessonSlug || 'lesson', `page-evidence-${sectionId || 'page'}.json`),
)
const reviewJson = opt(
  '--review-json',
  path.join('review', lessonSlug, `self-review-page-${sectionId}.json`),
)
const reviewMd = opt(
  '--review-md',
  path.join('review', lessonSlug, `self-review-page-${sectionId}.md`),
)
const referenceSource = opt('--reference-source')
const referenceAdaptationPath = opt(
  '--reference-adaptation',
  path.join('review', lessonSlug, 'reference-adaptation.json'),
)

if (
  !lessonSlug ||
  !scriptPath ||
  !contentPath ||
  !storyboardPath ||
  !sectionsPath ||
  !sectionId ||
  !deckPath ||
  !screenshotsDir ||
  !url
) {
  console.error(
    'usage: node build-page-evidence.mjs --lesson-slug <slug> --script <courseware.md> --content <content-pack.json> --storyboard <storyboard.yml> --sections <review-sections.yml> --section <id> --deck <deck.json> --screenshots <dir> --url <deck-url> [--concepts <file>] [--narration <file>] [--audio-root <dir>] [--out <file>] [--review-json <file>] [--review-md <file>] [--manual]',
  )
  process.exit(2)
}

const manifest = readSectionManifest(sectionsPath)
const section = sectionById(manifest, sectionId)
if (!section) {
  console.error(`FAIL page evidence — section ${sectionId} is not declared in ${sectionsPath}`)
  process.exit(2)
}
const storyboard = readData(storyboardPath)
const ordered = (storyboard.slides || []).filter((s) => s.status !== 'SKIP')
const start = ordered.findIndex((s) => s.id === section.slides[0])
if (start < 0) {
  console.error(`FAIL page evidence — first slide ${section.slides[0]} is not in ${storyboardPath}`)
  process.exit(2)
}
const slideIds = section.slides.join(',')
const toolsDir = path.dirname(fileURLToPath(import.meta.url))

function summarize(stdout, stderr) {
  const parsed = parseJson(String(stdout || '').trim())
  if (parsed) {
    if (parsed.ok === false) {
      const problems = parsed.problems || parsed.errors || []
      return `failed: ${problems.slice(0, 2).join('; ') || 'see check output'}`
    }
    if (Array.isArray(parsed.reports)) {
      const missing = parsed.reports.reduce((sum, report) => sum + (report.missing?.length || 0), 0)
      const coverage = parsed.reports
        .map((report) => report.proseCoverage)
        .filter((value) => typeof value === 'number')
      return `${parsed.reports.length} slide(s), ${missing} missing high-signal string(s)${
        coverage.length ? `, prose coverage ${Math.min(...coverage).toFixed(2)}` : ''
      }`
    }
    if (Array.isArray(parsed.slides)) return `${parsed.slides.length} slide(s)`
    if (Array.isArray(parsed.questions)) return `${parsed.questions.length} question(s)`
    if (Array.isArray(parsed.checks)) return `${parsed.checks.length} check(s)`
    return 'ok'
  }
  const lines = `${stdout || ''}\n${stderr || ''}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.length ? lines[lines.length - 1].slice(0, 300) : ''
}

function run(tool, toolArgs) {
  const result = spawnSync(process.execPath, [path.join(toolsDir, tool), ...toolArgs], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const ok = result.status === 0
  return {
    name: tool.replace(/\.mjs$/, ''),
    status: ok ? 'pass' : 'fail',
    exitCode: result.status,
    summary: summarize(result.stdout, result.stderr),
    error: ok ? '' : String(result.stderr || result.stdout || '').slice(0, 2000).trim(),
    stdout: String(result.stdout || ''),
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const checks = []
const density = run('density-report.mjs', [scriptPath, storyboardPath, '--slides', slideIds, '--json'])
checks.push(density)
const densityJson = parseJson(density.stdout)

const concepts = run('check-concepts.mjs', [
  scriptPath,
  contentPath,
  storyboardPath,
  '--concepts',
  conceptsPath,
  '--slides',
  slideIds,
])
checks.push(concepts)

checks.push(run('check-quiz-keys.mjs', [deckPath, '--slides', slideIds, '--json']))

if (narrationPath) {
  checks.push(
    run('check-narration.mjs', [
      scriptPath,
      narrationPath,
      ...(audioRoot ? ['--audio-root', audioRoot] : []),
      '--only',
      slideIds,
    ]),
  )
}

checks.push(
  run('check-overflow.mjs', [
    url,
    '--start',
    String(start),
    '--pages',
    String(section.slides.length),
  ]),
)

checks.push(
  run('check-overlap.mjs', [
    url,
    '--slides',
    slideIds,
    '--storyboard',
    storyboardPath,
    '--json',
    ...(manual ? ['--manual'] : []),
  ]),
)

checks.push(
  run('check-rendered-section.mjs', [
    '--sections',
    sectionsPath,
    '--storyboard',
    storyboardPath,
    '--section',
    sectionId,
    '--screenshots',
    screenshotsDir,
    '--deck',
    deckPath,
    ...(manual ? ['--manual'] : []),
  ]),
)

// Per-lesson reference map + deterministic residue scan. The map is generated
// once after the storyboard is projected; the page review only confirms deltas.
let referenceAdaptation = null
if (fs.existsSync(referenceAdaptationPath)) {
  try {
    const mapping = readData(referenceAdaptationPath)
    referenceAdaptation = {
      path: referenceAdaptationPath,
      entries: (mapping.entries || [])
        .filter((entry) => (entry.pages || []).some((id) => section.slides.includes(id)))
        .map(({ id, reference, lesson, residue }) => ({ id, reference, lesson, residue })),
    }
  } catch (error) {
    checks.push({
      name: 'check-reference-residue',
      status: 'fail',
      summary: `cannot read ${referenceAdaptationPath}: ${error.message}`,
      error: error.message,
    })
  }
} else {
  checks.push({
    name: 'reference adaptation map',
    status: 'fail',
    summary: `missing ${referenceAdaptationPath}; run build-reference-adaptation before the page loop`,
    error: `missing ${referenceAdaptationPath}`,
  })
}

// High-signal rendered text is deterministic. The page self-review no longer
// judges verbatim screen text; it only reviews visual/interaction semantics.
checks.push(
  run('check-rendered-text.mjs', [
    '--url',
    url,
    '--deck',
    deckPath,
    '--storyboard',
    storyboardPath,
    '--slides',
    slideIds,
    '--concepts',
    conceptsPath,
    '--reference-adaptation',
    referenceAdaptationPath,
    '--json',
    ...(manual ? ['--manual'] : []),
  ]),
)

const screenshots = section.slides.map((id) => ({
  slideId: id,
  png: path.join(screenshotsDir, `${id}.png`),
}))

const failed = checks.filter((check) => check.status !== 'pass')
const publicChecks = checks.map(({ name, status, summary }) => ({ name, status, summary }))

// The reviewer needs the page's script text, not the whole courseware.md.
// Ship the parsed fields with the evidence so the page review is a single-file
// read plus the screenshot.
const parsedScript = parseScript(scriptPath)
const scriptById = new Map(parsedScript.slides.map((slide) => [slide.id, slide]))
const boardById = new Map((storyboard.slides || []).map((slide) => [slide.id, slide]))
const scriptSlides = section.slides.map((id) => {
  const slide = scriptById.get(id)
  if (!slide) return { id, missing: true }
  const board = boardById.get(id) || {}
  const machine = slide.machine || {}
  // Compact: the reviewer needs the interaction contract, not the whole
  // machine block (which duplicates components/layout/concept fields).
  return {
    id: slide.id,
    title: slide.headingTitle,
    screenContent: slide.screenContent,
    interactionDesign: slide.interactionDesign,
    narration: slide.narration,
    transition: slide.transition,
    interaction: machine.interaction || board.interaction || null,
    componentPlan: machine.componentPlan || null,
  }
})
let relatedConcepts = []
if (conceptsPath && fs.existsSync(conceptsPath)) {
  try {
    const ledger = readData(conceptsPath)
    const slideIds = new Set(section.slides)
    relatedConcepts = (ledger.concepts || []).filter((concept) =>
      [concept.introducedOn, ...(concept.reinforcedOn || []), ...(concept.assessedOn || [])].some(
        (id) => slideIds.has(id),
      ),
    )
  } catch {
    relatedConcepts = []
  }
}

// Deterministic concept and reference checks are authoritative. Pre-fill their
// review entries so the page AI does not duplicate the judgment; the AI only
// handles density semantic units, interaction evidence, visual semantics and
// placeholder/personal-data checks.
const conceptEntries = relatedConcepts.map((concept) => ({
  conceptId: concept.id,
  verdict: concepts.status === 'pass' ? 'pass' : 'gap',
  evidence:
    concepts.status === 'pass'
      ? 'deterministic check-concepts passed for this page; mustAppear phrases verified'
      : 'deterministic check-concepts failed; see automatedChecks',
  slideIds: [...section.slides],
}))
const mappedIds = (referenceAdaptation?.entries || []).map((entry) => entry.id)
const referenceAdaptationSummary = referenceAdaptation
  ? `确定性参考适配：本页映射 ${mappedIds.length ? mappedIds.join('、') : '无'}；check-reference-residue 结果见 automatedChecks。如发现未映射的参考课可见内容，请在 issues 中记为 blocking。`
  : '参考适配映射缺失或无效；见 automatedChecks/issues。'

const evidence = {
  schemaVersion: '1.0',
  lessonSlug,
  section: {
    id: section.id,
    title: section.title,
    slides: section.slides,
    start,
    count: section.slides.length,
  },
  script: scriptPath,
  storyboard: storyboardPath,
  deck: deckPath,
  screenshotsDir,
  reviewJson,
  reviewMd,
  referenceAdaptation,
  scriptSlides,
  density: densityJson,
  screenshots,
  checks: publicChecks,
  verdict: failed.length ? 'fail' : 'pass',
  generatedAt: new Date().toISOString(),
}
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n')

function relative(file) {
  return path.relative(process.cwd(), path.resolve(file)).split(path.sep).join('/')
}
function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex')
}
const reviewedArtifacts = []
for (const file of [
  scriptPath,
  storyboardPath,
  deckPath,
  outPath,
  referenceAdaptationPath,
]) {
  if (fs.existsSync(path.resolve(file))) {
    reviewedArtifacts.push({ path: relative(file), sha256: hashFile(file) })
  }
}
for (const screenshot of screenshots) {
  if (fs.existsSync(path.resolve(screenshot.png))) {
    reviewedArtifacts.push({ path: relative(screenshot.png), sha256: hashFile(screenshot.png) })
  }
}
const densityEntries = (Array.isArray(densityJson?.slides) ? densityJson.slides : []).map(
  (entry) => ({
    slideId: entry.slideId || section.slides[0],
    semanticUnits: [],
    signals: entry.signals || {},
    verdict: 'fail',
    notes: '',
  }),
)
const skeleton = {
  stage: `page-${sectionId}`,
  artifactPaths: reviewedArtifacts.map((artifact) => artifact.path),
  reviewedArtifacts,
  density: densityEntries,
  concepts: conceptEntries,
  automatedChecks: publicChecks.map((check) => ({
    name: check.name,
    status: check.status,
    notes: check.summary,
  })),
  checklist: [
    { item: 'interaction produces the declared evidence (not just watch/next)', status: 'n/a' },
    {
      item: 'visual layout and interaction are understandable; no obvious crowding or misread',
      status: 'n/a',
    },
    {
      item: 'staged component behavior matches its brief (only if components are listed)',
      status: 'n/a',
    },
    { item: 'no placeholder, no personal data', status: 'n/a' },
  ],
  issues: [],
  referenceAdaptation: referenceAdaptationSummary,
  verdict: 'fail',
  reviewedAt: new Date().toISOString(),
}
fs.mkdirSync(path.dirname(path.resolve(reviewJson)), { recursive: true })
fs.writeFileSync(reviewJson, JSON.stringify(skeleton, null, 2) + '\n')

// The Markdown review is rendered from the JSON after the AI fills it
// (render-self-review-md.mjs). Keeping the skeleton JSON as the only AI output
// avoids writing the same review twice and keeps hashes machine-owned.

if (failed.length) {
  console.error(`FAIL page evidence — ${failed.map((check) => check.name).join(', ')}`)
  process.exit(1)
}
console.log(`OK page evidence — ${outPath}`)
