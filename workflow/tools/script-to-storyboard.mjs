#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { readData, validateWithSchema, fail, ok } from './lib.mjs'
import { parseScript, compareStoryboardSlides } from './script-lib.mjs'

const argv = process.argv.slice(2)
function option(name, fallback = '') {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const scriptPath = (() => {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      if (argv[i] === '--out' || argv[i] === '--check') i += 1
      continue
    }
    return argv[i]
  }
  return ''
})()
const out = option('--out')
const check = option('--check')
const print = argv.includes('--print')

if (!scriptPath) {
  console.error('usage: node script-to-storyboard.mjs <courseware.md> [--out storyboard.yml] [--check storyboard.yml] [--print]')
  process.exit(2)
}

let parsed
try {
  parsed = parseScript(scriptPath)
} catch (err) {
  console.error(`FAIL courseware script parse — ${err.message}`)
  process.exit(1)
}

const fm = parsed.frontmatter
const storyboard = {
  lesson: fm.lesson,
  contentPack: fm.contentPack,
  stylePack: fm.stylePack,
  script: path.relative(process.cwd(), path.resolve(scriptPath)),
  slides: parsed.slides.map((s) => {
    const m = s.machine || {}
    const slide = {
      id: m.id,
      title: m.title,
      objectiveId: m.objectiveId,
      objective: m.objective,
      contentRefs: m.contentRefs,
      components: m.components,
      layout: m.layout,
      status: m.status || 'DRAFT',
      reviewer: m.reviewer || '',
      scriptSection: `${s.id} · ${s.headingTitle}`,
    }
    if (m.interaction) {
      const interaction = { ...m.interaction }
      delete interaction.component
      slide.interaction = interaction
    }
    if (m.continuedFrom) slide.continuedFrom = m.continuedFrom
    if (m.continued !== undefined) slide.continued = m.continued
    if (m.notes) slide.notes = m.notes
    return slide
  }),
}

const schemaCheck = validateWithSchema(
  fileURLToPath(new URL('../schemas/storyboard.schema.json', import.meta.url)),
  storyboard,
)
if (!schemaCheck.ok) {
  fail('storyboard projection', schemaCheck.errors)
  process.exit(1)
}

if (check) {
  const actual = readData(check)
  const diffs = compareStoryboardSlides(actual, storyboard)
  if (diffs.length) {
    fail('script ↔ storyboard consistency', diffs)
    process.exit(1)
  }
  ok('script ↔ storyboard consistency', `${storyboard.slides.length} slide(s)`)
}

const yaml = YAML.stringify(storyboard, { lineWidth: 0 })
if (out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  fs.writeFileSync(out, yaml)
  ok('storyboard projected from script', out)
}
if (print || (!out && !check)) process.stdout.write(yaml)
