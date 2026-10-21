#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readData } from './lib.mjs'
import { DEFAULT_SCREENSHOTS_DIR } from './approval-lib.mjs'
import { requireProductionRun } from './review-guard.mjs'
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
function flag(name) {
  return args.includes(name)
}

const sectionsPath = opt('--sections')
const storyboardPath = opt('--storyboard')
const sectionId = opt('--section')
const screenshots = opt('--screenshots', DEFAULT_SCREENSHOTS_DIR)
const deckPath = opt('--deck')

if (!sectionsPath || !storyboardPath || !sectionId) {
  console.error(
    'usage: node check-rendered-section.mjs --sections <file> --storyboard <file> --section <id> [--screenshots <dir>] [--deck <deck.json>] [--manual|--alpha]',
  )
  process.exit(2)
}
requireProductionRun({
  tool: `check-rendered-section ${sectionId}`,
  manual: flag('--manual') || flag('--alpha'),
})

const expectedDeckSha256 = deckPath
  ? crypto.createHash('sha256').update(fs.readFileSync(deckPath)).digest('hex')
  : null
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
      if (expectedDeckSha256) {
        if (typeof meta.deckSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(meta.deckSha256)) {
          errors.push(
            `screenshot for ${id} has no deck hash; re-capture it with build-screen --deck after the current build`,
          )
        } else if (meta.deckSha256 !== expectedDeckSha256) {
          errors.push(
            `screenshot for ${id} is stale: deck ${meta.deckSha256.slice(0, 12)}…, current ${expectedDeckSha256.slice(0, 12)}…; rebuild and re-capture`,
          )
        }
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
