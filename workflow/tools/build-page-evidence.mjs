#!/usr/bin/env node
// Build one page's evidence bundle for the AI self-review. The shell gates have
// already run; this tool reruns the cheap checks, captures their results and
// the screenshot metadata, and writes one JSON so the self-review prompt does
// not have to re-run commands or read the whole script/storyboard/deck.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readData } from './lib.mjs'
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
    'usage: node build-page-evidence.mjs --lesson-slug <slug> --script <courseware.md> --content <content-pack.json> --storyboard <storyboard.yml> --sections <review-sections.yml> --section <id> --deck <deck.json> --screenshots <dir> --url <deck-url> [--concepts <file>] [--narration <file>] [--audio-root <dir>] [--out <file>] [--manual]',
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

function run(tool, toolArgs) {
  const result = spawnSync(process.execPath, [path.join(toolsDir, tool), ...toolArgs], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return {
    name: tool.replace(/\.mjs$/, ''),
    status: result.status === 0 ? 'pass' : 'fail',
    exitCode: result.status,
    stdout: String(result.stdout || '').slice(0, 20000).trim(),
    stderr: String(result.stderr || '').slice(0, 8000).trim(),
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

const quiz = run('check-quiz-keys.mjs', [deckPath, '--slides', slideIds, '--json'])
checks.push(quiz)
const quizJson = parseJson(quiz.stdout)

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

const overlap = run('check-overlap.mjs', [
  url,
  '--slides',
  slideIds,
  '--storyboard',
  storyboardPath,
  '--json',
  ...(manual ? ['--manual'] : []),
])
checks.push(overlap)
const overlapJson = parseJson(overlap.stdout)

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

const screenshots = section.slides.map((id) => {
  const metadataPath = path.join(screenshotsDir, `${id}.json`)
  return {
    slideId: id,
    metadata: fs.existsSync(metadataPath) ? readData(metadataPath) : null,
    png: path.join(screenshotsDir, `${id}.png`),
    pngExists: fs.existsSync(path.join(screenshotsDir, `${id}.png`)),
  }
})

const failed = checks.filter((check) => check.status !== 'pass')
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
  density: densityJson,
  quizKeys: quizJson,
  overlap: overlapJson,
  screenshots,
  checks,
  verdict: failed.length ? 'fail' : 'pass',
  generatedAt: new Date().toISOString(),
}
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n')

if (failed.length) {
  console.error(`FAIL page evidence — ${failed.map((check) => check.name).join(', ')}`)
  process.exit(1)
}
console.log(`OK page evidence — ${outPath}`)
