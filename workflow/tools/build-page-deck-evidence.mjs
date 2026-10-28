#!/usr/bin/env node
// Build the compact evidence for one page's deck implementation.
//
// The implementer is a single-shot model, not a coding agent. It receives the
// approved script page, storyboard slide, shell slide-type templates, component
// props schemas, current deck meta/slide and the section. It returns one deck
// slide; apply-page-deck.mjs validates and writes it.
import fs from 'node:fs'
import path from 'node:path'
import { readData } from './lib.mjs'
import { parseScript } from './script-lib.mjs'
import { readSectionManifest, sectionById } from './section-lib.mjs'
import { parseFlagValue } from './self-review-lib.mjs'

const args = process.argv.slice(2)
const lessonSlug = parseFlagValue(args, '--lesson-slug')
const scriptPath = parseFlagValue(args, '--script')
const storyboardPath = parseFlagValue(args, '--storyboard')
const sectionsPath = parseFlagValue(args, '--sections')
const sectionId = parseFlagValue(args, '--section')
const deckPath = parseFlagValue(args, '--deck')
const shellPath = parseFlagValue(args, '--shell', 'shells/branch-choice')
const registryPath = parseFlagValue(args, '--registry', 'registry/index.json')
const stagingDir = parseFlagValue(args, '--staging', 'registry/staging')
const outPath = parseFlagValue(
  args,
  '--out',
  path.join('review', lessonSlug, `page-deck-evidence-${sectionId}.json`),
)
if (!lessonSlug || !scriptPath || !storyboardPath || !sectionsPath || !sectionId || !deckPath) {
  console.error(
    'usage: node build-page-deck-evidence.mjs --lesson-slug <slug> --script <courseware.md> --storyboard <storyboard.yml> --sections <review-sections.yml> --section <id> --deck <deck.json> --shell <shells/id> [--registry <index.json>] [--staging <dir>] [--out <evidence.json>]',
  )
  process.exit(2)
}

const section = sectionById(readSectionManifest(sectionsPath), sectionId)
if (!section) {
  console.error(`FAIL page deck evidence — section ${sectionId} is not declared`)
  process.exit(2)
}
const slideId = section.slides[0]
const script = parseScript(scriptPath)
const scriptSlide = script.slides.find((slide) => slide.id === slideId)
if (!scriptSlide) {
  console.error(`FAIL page deck evidence — slide ${slideId} is not in ${scriptPath}`)
  process.exit(2)
}
const storyboard = readData(storyboardPath)
const board = (storyboard.slides || []).find((slide) => slide.id === slideId) || null
const deck = readData(deckPath)
const shell = readData(path.join(shellPath, 'shell.json'))
const registry = readData(registryPath)

// Parse the shell's placeholder deck to recover one structural example per
// native slide type. The examples contain placeholder text, but their field
// names are the renderer contract.
function previewDeck() {
  const file = path.join(shellPath, 'site/deck.js')
  if (!fs.existsSync(path.resolve(file))) return { meta: {}, slides: [] }
  const text = fs.readFileSync(path.resolve(file), 'utf8')
  const match = text.match(/window\.COURSEWARE_SHELL_DATA\s*=\s*(\{[\s\S]*?\});\s*$/)
  if (!match) return { meta: {}, slides: [] }
  try {
    return JSON.parse(match[1])
  } catch {
    return { meta: {}, slides: [] }
  }
}
const preview = previewDeck()
const typeTemplates = {}
for (const slide of preview.slides || []) {
  if (slide?.type && !typeTemplates[slide.type]) typeTemplates[slide.type] = slide
}
const slideTypes = preview.slides?.map((slide) => slide.type).filter(Boolean) || shell.dataContract?.slideTypes || []

function componentPackages() {
  const ids = new Set()
  for (const component of registry.components || []) ids.add(component.id)
  if (fs.existsSync(path.resolve(stagingDir))) {
    for (const name of fs.readdirSync(path.resolve(stagingDir))) {
      if (fs.existsSync(path.resolve(stagingDir, name, 'component.json'))) ids.add(name)
    }
  }
  const packages = {}
  for (const id of ids) {
    for (const dir of [path.join(stagingDir, id), path.join('registry/components', id)]) {
      const file = path.join(dir, 'component.json')
      if (!fs.existsSync(path.resolve(file))) continue
      const component = readData(file)
      packages[id] = {
        id: component.id || id,
        name: component.name || id,
        description: component.description || '',
        interactionLevels: component.interactionLevels || [],
        whenToUse: component.whenToUse || '',
        whenNotToUse: component.whenNotToUse || '',
        propsSchema: component.propsSchema || null,
      }
      break
    }
  }
  return packages
}
const components = componentPackages()
const existingSlide = (deck.slides || []).find((slide) => slide.id === slideId) || null
const hint = scriptSlide.machine?.interaction?.component
  ? { type: 'blank', component: scriptSlide.machine.interaction.component }
  : scriptSlide.machine?.interaction?.type === 'cover-hero'
    ? { type: 'hero' }
    : { type: scriptSlide.machine?.interaction?.type || 'blank' }

const evidence = {
  schemaVersion: '1.0',
  mode: 'page-deck',
  lessonSlug,
  section: { id: section.id, title: section.title, slides: section.slides },
  slideId,
  scriptSlide: {
    id: scriptSlide.id,
    title: scriptSlide.headingTitle,
    screenContent: scriptSlide.screenContent,
    interactionDesign: scriptSlide.interactionDesign,
    narration: scriptSlide.narration,
    transition: scriptSlide.transition,
    machine: scriptSlide.machine,
  },
  storyboardSlide: board,
  hint,
  slideTypes,
  typeTemplates,
  deckMeta: deck.meta || {},
  existingSlide,
  components,
  rules: [
    '只返回本页一个 deck slide；id/title 必须与脚本和 storyboard 一致。',
    'type 必须来自 slideTypes；自定义互动使用 type=blank + component=<id> + props。',
    'component 必须是 components 中的 id；props 必须符合对应 propsSchema。',
    '屏幕内容从脚本「屏幕内容」逐字搬入；不要把旁白放进屏幕字段。',
    '不得写 style、className、html、innerHTML、on* 等页面实现字段。',
    '不要生成音频、截图或构建站点；这些由 workflow 处理。',
  ],
}
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(path.resolve(outPath), `${JSON.stringify(evidence, null, 2)}\n`)
console.log(`OK page deck evidence — ${outPath}`)
