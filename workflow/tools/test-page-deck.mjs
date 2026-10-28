#!/usr/bin/env node
// Test the single-shot page-deck generator plus the validating applier.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const tools = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-page-deck-'))
const evidence = path.join(tmp, 'evidence.json')
const deck = path.join(tmp, 'deck.json')
const mock = path.join(tmp, 'mock.json')
const slideOut = path.join(tmp, 'slide.json')
fs.writeFileSync(
  evidence,
  JSON.stringify({
    lesson: '测试课',
    lessonSlug: 'smoke',
    section: { id: 'S01', title: '封面', slides: ['S01'] },
    slideId: 'S01',
    scriptSlide: { title: '测试课' },
    storyboardSlide: { title: '测试课' },
    hint: { type: 'hero' },
    slideTypes: ['hero'],
    typeTemplates: { hero: { type: 'hero', title: '占位', lead: '占位', topics: [] } },
    deckMeta: { coverCode: 'old', coverOutput: 'old' },
    existingSlide: null,
    components: {},
  }),
)
fs.writeFileSync(deck, JSON.stringify({ meta: { coverCode: 'old', coverOutput: 'old' }, slides: [] }))
fs.writeFileSync(
  mock,
  JSON.stringify({
    content: [{
      type: 'text',
      text: JSON.stringify({
        meta: { coverCode: 'new' },
        slide: { id: 'S01', title: '测试课', type: 'hero', lead: '新封面', topics: ['路线'] },
      }),
    }],
  }),
)
const generate = spawnSync(
  process.execPath,
  [
    path.join(tools, 'single-shot-generate.mjs'),
    '--mode', 'page-deck',
    '--evidence', evidence,
    '--out', slideOut,
    '--api', 'anthropic-messages',
    '--model', 'mock',
    '--mock-response', mock,
  ],
  { encoding: 'utf8' },
)
if (generate.status !== 0) {
  console.error(generate.stdout, generate.stderr)
  process.exit(1)
}
const apply = spawnSync(
  process.execPath,
  [
    path.join(tools, 'apply-page-deck.mjs'),
    '--deck', deck,
    '--evidence', evidence,
    '--slide-json', slideOut,
  ],
  { encoding: 'utf8' },
)
if (apply.status !== 0) {
  console.error(apply.stdout, apply.stderr)
  process.exit(1)
}
const result = JSON.parse(fs.readFileSync(deck, 'utf8'))
assert.equal(result.meta.coverCode, 'new')
assert.equal(result.slides[0].id, 'S01')
assert.equal(result.slides[0].lead, '新封面')
console.log('OK page deck generator + applier')
