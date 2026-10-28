#!/usr/bin/env node
// Validate one model-generated deck slide and apply it to deck.json.
//
// The model never writes deck.json. This tool checks the slide contract
// (id/title/type/component/props), rejects page-level implementation fields,
// validates custom component props against their schema, and only then writes.
import fs from 'node:fs'
import path from 'node:path'
import Ajv from 'ajv'
import { readData } from './lib.mjs'
import { parseFlagValue } from './self-review-lib.mjs'

const args = process.argv.slice(2)
const deckPath = parseFlagValue(args, '--deck')
const evidencePath = parseFlagValue(args, '--evidence')
const slidePath = parseFlagValue(args, '--slide-json')
const outPath = parseFlagValue(args, '--out', deckPath)
if (!deckPath || !evidencePath || !slidePath) {
  console.error(
    'usage: node apply-page-deck.mjs --deck <deck.json> --evidence <page-deck-evidence.json> --slide-json <model-output.json> [--out <deck.json>]',
  )
  process.exit(2)
}

const evidence = readData(evidencePath)
const result = readData(slidePath)
const slide = result.slide || result
const errors = []
if (!slide || typeof slide !== 'object' || Array.isArray(slide)) {
  console.error('FAIL apply page deck — output.slide must be an object')
  process.exit(1)
}
if (slide.id !== evidence.slideId) errors.push(`slide.id ${slide.id} != ${evidence.slideId}`)
const expectedTitles = new Set([
  evidence.scriptSlide?.title,
  evidence.storyboardSlide?.title,
].filter(Boolean))
if (expectedTitles.size && !expectedTitles.has(slide.title)) {
  errors.push(`slide.title ${JSON.stringify(slide.title)} does not match script/storyboard title`)
}
if (!Array.isArray(evidence.slideTypes) || !evidence.slideTypes.includes(slide.type)) {
  errors.push(`slide.type ${JSON.stringify(slide.type)} is not a declared shell slide type`)
}
if (slide.component) {
  if (!evidence.components?.[slide.component]) {
    errors.push(`component ${slide.component} is not available in registry/staging`)
  } else if (evidence.components[slide.component].propsSchema) {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(evidence.components[slide.component].propsSchema)
    if (!validate(slide.props || {})) {
      for (const error of validate.errors || []) {
        errors.push(`props${error.instancePath || '/'} ${error.message}`)
      }
    }
  }
}
if (slide.type === 'blank' && !slide.component) {
  errors.push('type=blank requires a component id')
}
function checkForbidden(value, where = 'slide') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkForbidden(item, `${where}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (key === 'style' || key === 'className' || key === 'html' || key === 'innerHTML' || /^on[A-Z]/.test(key)) {
      errors.push(`${where}.${key} is forbidden in deck data`)
    }
    if (item && typeof item === 'object') checkForbidden(item, `${where}.${key}`)
  }
}
checkForbidden(slide)

const deck = readData(deckPath)
if (result.meta && typeof result.meta === 'object') {
  for (const [key, value] of Object.entries(result.meta)) {
    if (!(key in (deck.meta || {}))) {
      errors.push(`meta.${key} is not an existing deck meta field`)
      continue
    }
    deck.meta[key] = value
  }
}
if (errors.length) {
  console.error('FAIL apply page deck')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}
const index = (deck.slides || []).findIndex((item) => item.id === slide.id)
if (index >= 0) deck.slides[index] = slide
else deck.slides = [...(deck.slides || []), slide]
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(path.resolve(outPath), `${JSON.stringify(deck, null, 2)}\n`)
console.log(`OK apply page deck — ${slide.id} ${slide.type}${slide.component ? ` / ${slide.component}` : ''}`)
