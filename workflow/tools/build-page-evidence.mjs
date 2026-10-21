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
const publicChecks = checks.map(({ stdout, ...rest }) => rest)
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
  density: densityJson,
  quizKeys: quizJson,
  overlap: overlapJson,
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
for (const file of [scriptPath, storyboardPath, deckPath, outPath]) {
  if (fs.existsSync(path.resolve(file))) {
    reviewedArtifacts.push({ path: relative(file), sha256: hashFile(file) })
  }
}
for (const screenshot of screenshots) {
  if (screenshot.pngExists) {
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
  concepts: [],
  automatedChecks: publicChecks.map((check) => ({
    name: check.name,
    status: check.status,
    notes: check.summary,
  })),
  checklist: [
    { item: 'rendered text matches script', status: 'n/a' },
    { item: 'interaction evidence', status: 'n/a' },
    { item: 'no overflow/overlap', status: 'n/a' },
    { item: 'reference adaptation', status: 'n/a' },
    { item: 'component behavior', status: 'n/a' },
    { item: 'narration', status: 'n/a' },
    { item: 'no personal data', status: 'n/a' },
  ],
  issues: [],
  referenceAdaptation: '',
  verdict: 'fail',
  reviewedAt: new Date().toISOString(),
}
fs.mkdirSync(path.dirname(path.resolve(reviewJson)), { recursive: true })
fs.writeFileSync(reviewJson, JSON.stringify(skeleton, null, 2) + '\n')

const md = [
  `# AI 自审：page-${sectionId}`,
  '',
  `- 页面：${sectionId} · ${section.title}`,
  `- 屏：${section.slides.join(', ')}`,
  `- 证据包：\`${relative(outPath)}\``,
  `- 本文件由 build-page-evidence 生成骨架；AI 只需填写“需要判断”的字段，不要重算哈希或自动检查。`,
  '',
  '## 自动检查',
  '',
  '| 检查 | 结果 | 摘要 |',
  '|---|---|---|',
  ...publicChecks.map((check) => `| ${check.name} | ${check.status} | ${check.summary.replace(/\|/g, '\\|')} |`),
  '',
  '## 逐屏信号',
  '',
  '| 屏 | 语义单元（待填） | 结论（待填） |',
  '|---|---|---|',
  ...densityEntries.map((entry) => `| ${entry.slideId} |  |  |`),
  '',
  '## 需要 AI 判断并填写',
  '',
  '- `density[].semanticUnits` / `density[].verdict` / `density[].notes`',
  '- `concepts[]`（本页涉及的概念；verdict + evidence + slideIds）',
  '- `checklist` 中适用的项与 `issues`',
  '- `referenceAdaptation`（参考课件专属内容与本课替换；自由判断，不套固定清单）',
  '- `verdict`: pass / fail',
  '',
  '不要重跑 density/concepts/quiz/narration/overflow/overlap/rendered 命令；这些结果已在证据包里。',
  '',
]
fs.mkdirSync(path.dirname(path.resolve(reviewMd)), { recursive: true })
fs.writeFileSync(reviewMd, md.join('\n'))

if (failed.length) {
  console.error(`FAIL page evidence — ${failed.map((check) => check.name).join(', ')}`)
  process.exit(1)
}
console.log(`OK page evidence — ${outPath}`)
