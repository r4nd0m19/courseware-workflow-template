#!/usr/bin/env node
// Compact evidence for the single-shot reference-adaptation mapper.
import fs from 'node:fs'
import path from 'node:path'
import { readData } from './lib.mjs'
import { parseScript } from './script-lib.mjs'
import { parseFlagValue } from './self-review-lib.mjs'

const args = process.argv.slice(2)
const lessonSlug = parseFlagValue(args, '--lesson-slug')
const lesson = parseFlagValue(args, '--lesson', lessonSlug)
const scriptPath = parseFlagValue(args, '--script')
const storyboardPath = parseFlagValue(args, '--storyboard')
const shellPath = parseFlagValue(args, '--shell', 'shells/branch-choice')
const conceptsPath = parseFlagValue(args, '--concepts')
const contentPath = parseFlagValue(args, '--content')
const outPath = parseFlagValue(
  args,
  '--out',
  path.join('review', lessonSlug, 'reference-adaptation-evidence.json'),
)
if (!lessonSlug || !scriptPath || !storyboardPath || !shellPath || !conceptsPath || !contentPath) {
  console.error(
    'usage: node build-reference-adaptation-evidence.mjs --lesson-slug <slug> --lesson <title> --script <courseware.md> --storyboard <storyboard.yml> --shell <shells/id> --concepts <concepts.yml> --content <content-pack.json> [--out <evidence.json>]',
  )
  process.exit(2)
}

const shellFile = path.join(shellPath, 'shell.json')
const referenceFile = path.join(shellPath, 'source/lesson.js')
const shell = readData(shellFile)
const parsed = parseScript(scriptPath)
const storyboard = readData(storyboardPath)
const concepts = readData(conceptsPath)
const content = readData(contentPath)
const evidence = {
  schemaVersion: '1.0',
  mode: 'reference-adaptation',
  lessonSlug,
  lesson,
  shell: shell.id || path.basename(shellPath),
  shellPath,
  referenceSource: `${shellPath}/source/lesson.js`,
  referenceLesson: shell.name || '',
  scriptSlides: parsed.slides
    .filter((slide) => slide.machine?.status !== 'SKIP')
    .map((slide) => ({
      id: slide.id,
      title: slide.headingTitle,
      screenContent: slide.screenContent,
      interactionDesign: slide.interactionDesign,
      narration: slide.narration,
      transition: slide.transition,
    })),
  storyboard: (storyboard.slides || [])
    .filter((slide) => slide.status !== 'SKIP')
    .map((slide) => ({
      id: slide.id,
      title: slide.title,
      contentRefs: slide.contentRefs || [],
    })),
  concepts: (concepts.concepts || []).map((concept) => ({
    id: concept.id,
    term: concept.term,
    definition: concept.definition,
    mustAppear: concept.mustAppear || [],
    introducedOn: concept.introducedOn,
  })),
  content: (content.items || []).map((item) => ({
    id: item.id,
    title: item.title,
    kind: item.kind,
    text: item.text,
  })),
  referenceSourceText: fs.existsSync(referenceFile) ? fs.readFileSync(referenceFile, 'utf8') : '',
}
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(path.resolve(outPath), `${JSON.stringify(evidence, null, 2)}\n`)
console.log(`OK reference adaptation evidence — ${outPath}`)
