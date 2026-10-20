#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { readData } from './lib.mjs'
import {
  readSectionManifest,
  sectionById,
  validateSectionManifest,
} from './section-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}

const sectionsPath = opt('--sections')
const storyboardPath = opt('--storyboard')
const sectionId = opt('--section')
const screenshots = opt('--screenshots', 'screenshots')

if (!sectionsPath || !storyboardPath || !sectionId) {
  console.error(
    'usage: node check-rendered-section.mjs --sections <file> --storyboard <file> --section <id> [--screenshots <dir>]',
  )
  process.exit(2)
}

const manifest = readSectionManifest(sectionsPath)
const storyboard = readData(storyboardPath)
const errors = validateSectionManifest(manifest, storyboard.slides || [], {
  requireAll: true,
})
const section = sectionById(manifest, sectionId)
if (!section) errors.push(`section ${sectionId} is not declared in ${sectionsPath}`)

if (!errors.length) {
  const byId = new Map((storyboard.slides || []).map((s) => [s.id, s]))
  for (const id of section.slides) {
    const slide = byId.get(id)
    if (!slide || slide.status !== 'APPROVED') {
      errors.push(`slide ${id} is not APPROVED`)
      continue
    }
    const png = path.join(screenshots, `${id}.png`)
    const json = path.join(screenshots, `${id}.json`)
    if (!fs.existsSync(png) || fs.statSync(png).size === 0) {
      errors.push(`screenshot missing or empty for ${id}: ${png}`)
    }
    if (!fs.existsSync(json)) {
      errors.push(`screenshot metadata missing for ${id}: ${json}`)
      continue
    }
    try {
      const meta = JSON.parse(fs.readFileSync(json, 'utf8'))
      if (meta.slideId !== id) {
        errors.push(`screenshot metadata for ${json} says slideId=${meta.slideId}`)
      }
    } catch (err) {
      errors.push(`screenshot metadata unreadable for ${id}: ${err.message}`)
    }
  }
}

if (errors.length) {
  console.error(`FAIL rendered section ${sectionId}`)
  for (const e of errors) console.error(`  ${e}`)
  process.exit(1)
}

console.log(
  `OK rendered section ${sectionId} — ${section.slides.length} slide(s) captured, all APPROVED`,
)
