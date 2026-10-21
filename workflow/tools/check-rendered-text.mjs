#!/usr/bin/env node
// Deterministic rendered-text check for one section.
//
// Blocking: high-signal literals from the declarative deck — slide title,
// quiz stems/options, table headers/rows, code lines, item statements, chapter
// topics/flows, role labels and concept mustAppear phrases. They must appear
// in the rendered #slide textContent (hidden tabs/questions still count as
// rendered DOM content).
//
// Advisory: long prose props are compared to the visible innerText by token
// coverage. A low score is reported for the page self-review, but never blocks.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChrome } from './chrome.mjs'
import { readData } from './lib.mjs'
import {
  normalizeCode,
  normalizeCompact,
  normalizeText,
  tokenSet,
} from './rendered-text-lib.mjs'
import { requireProductionRun } from './review-guard.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
function flag(name) {
  return args.includes(name)
}
const url = opt('--url')
const deckPath = opt('--deck')
const storyboardPath = opt('--storyboard')
const slidesRaw = opt('--slides')
const conceptsPath = opt('--concepts')
const referenceAdaptationPath = opt('--reference-adaptation')
const threshold = Number(opt('--similarity-threshold', '0.85'))
const waitMs = Number(opt('--wait', '500'))
const manual = flag('--manual')
const jsonOut = flag('--json')

if (!url || !deckPath || !storyboardPath || !slidesRaw) {
  console.error(
    'usage: node check-rendered-text.mjs --url <deck-url> --deck <deck.json> --storyboard <storyboard.yml> --slides S02B[,S02C] [--concepts <concepts.yml>] [--reference-adaptation <reference-adaptation.json>] [--similarity-threshold 0.85] [--json] [--manual]',
  )
  process.exit(2)
}
requireProductionRun({ tool: 'check-rendered-text', manual })

const deck = readData(deckPath)
const storyboard = readData(storyboardPath)
const slides = storyboard.slides.filter((slide) => slide.status !== 'SKIP')
const wanted = slidesRaw.split(',').map((id) => id.trim()).filter(Boolean)
const deckById = new Map((deck.slides || []).map((slide) => [slide.id, slide]))

const SKIP_KEYS = new Set([
  'id',
  'type',
  'kind',
  'component',
  'layout',
  'mode',
  'modes',
  'correct',
  'ariaLabel',
  'misconception',
  'src',
  'alt',
  'answer',
  'answers',
  'initialMode',
  'initialConditionsOpen',
  'checkpoints',
  'requireCorrectToAdvance',
  'showProgress',
  'editable',
  'minValue',
  'maxValue',
  'stepDelayMs',
  'values',
  'default',
  'defaults',
])
const PROSE_KEYS = new Set([
  'lead',
  'intro',
  'description',
  'note',
  'prompt',
  'callout',
  'conclusion',
  'rules',
  'sourceText',
  'conditions',
  'notes',
  'left',
  'right',
  'cards',
  'segments',
  'text',
])

function addBlocking(list, value) {
  const text = String(value || '').trim()
  if (!text) return
  if (!list.includes(text)) list.push(text)
}

function addCode(out, value) {
  const code = normalizeCode(value)
  if (code.replace(/\s+/g, '').length >= 4) out.code.add(code)
}

function addOptions(out, options) {
  for (const option of options || []) {
    if (typeof option === 'string') addBlocking(out.text, option)
    else if (option && typeof option === 'object') addBlocking(out.text, option.text ?? option.label)
  }
}

function addRows(out, rows) {
  for (const row of rows || []) {
    if (typeof row === 'string') addBlocking(out.text, row)
    else if (Array.isArray(row)) {
      for (const cell of row) if (typeof cell === 'string') addBlocking(out.text, cell)
    } else if (row && typeof row === 'object') {
      addBlocking(out.text, row.text ?? row.label)
    }
  }
}

function addItems(out, items) {
  for (const item of items || []) {
    if (typeof item === 'string') addBlocking(out.text, item)
    else if (Array.isArray(item)) {
      for (const cell of item) if (typeof cell === 'string') addBlocking(out.text, cell)
    } else if (item && typeof item === 'object') {
      addBlocking(out.text, item.text ?? item.label)
    }
  }
}

// Only collect strings that the initial render is known to show. Hidden tabs,
// later quiz questions, checkpoints and comparison panels stay in the page
// interaction review; requiring them here would be a false gate.
function collectBlocking(slide, out) {
  addBlocking(out.text, slide.title)
  const props = slide.props || {}
  if (slide.type === 'quiz') {
    addBlocking(out.text, props.question)
    addOptions(out, props.options)
    addCode(out, props.code)
    return
  }
  if (slide.type === 'table') {
    addRows(out, props.headers)
    addRows(out, props.rows)
    return
  }
  if (slide.type === 'judgment' || slide.type === 'checklist') {
    addItems(out, props.items)
    return
  }
  if (slide.type === 'chapter') {
    addBlocking(out.text, props.topics)
    addBlocking(out.text, props.question)
    return
  }
  if (slide.type === 'code') {
    addCode(out, props.code)
    addItems(out, props.flow)
    return
  }
  if (slide.type === 'hero') {
    addItems(out, props.topics)
    return
  }
  if (slide.type === 'numberLab' || slide.type === 'chainLab' || slide.type === 'tripleLab') {
    addCode(out, props.code)
    addBlocking(out.text, props.question)
    return
  }
  if (slide.type === 'expr') {
    addBlocking(out.text, props.question)
    return
  }
  if (slide.type === 'fill') {
    addCode(out, props.code)
    return
  }
  if (slide.type === 'blank') {
    switch (slide.component) {
      case 'code-anatomy':
        addCode(out, props.code)
        for (const role of props.roles || []) addBlocking(out.text, role.label)
        break
      case 'quiz-bank': {
        const index = Math.max(0, Math.min(Number(props.initialQuestion || 0), (props.questions || []).length - 1))
        const question = (props.questions || [])[index]
        if (question) {
          addBlocking(out.text, question.stem)
          addCode(out, question.code)
          addOptions(out, question.options)
        }
        break
      }
      case 'matrix-lab': {
        const active = (props.panels || []).find((panel) => panel.mode === props.initialMode) || (props.panels || [])[0]
        if (active) addCode(out, active.code)
        break
      }
      case 'matrix-fill': {
        addCode(out, props.declaration)
        addCode(out, (props.variants || [])[0]?.code)
        for (const assignment of props.assignments || []) addCode(out, assignment.code)
        break
      }
      case 'matrix-basics':
        for (const point of props.concept?.points || []) addBlocking(out.text, point.label)
        break
      default:
        // Unknown blank component: title only. Its props are reviewed on the
        // rendered page, not assumed visible here.
        break
    }
  }
}

function collectProse(value, key, out) {
  if (value == null) return
  if (typeof value === 'string') {
    if (PROSE_KEYS.has(key) && value.trim()) out.add(value.trim())
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectProse(item, key, out)
    return
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.questions)) {
      const index = Math.max(0, Math.min(Number(value.initialQuestion || 0), value.questions.length - 1))
      if (value.questions[index]) collectProse(value.questions[index], 'question', out)
      for (const [childKey, child] of Object.entries(value)) {
        if (childKey === 'questions' || SKIP_KEYS.has(childKey)) continue
        collectProse(child, childKey, out)
      }
      return
    }
    if (Array.isArray(value.panels)) {
      const active = value.panels.find((panel) => panel.mode === value.initialMode) || value.panels[0]
      if (active) collectProse(active, 'panel', out)
      for (const [childKey, child] of Object.entries(value)) {
        if (childKey === 'panels' || SKIP_KEYS.has(childKey)) continue
        collectProse(child, childKey, out)
      }
      return
    }
    for (const [childKey, child] of Object.entries(value)) {
      if (SKIP_KEYS.has(childKey)) continue
      collectProse(child, childKey, out)
    }
  }
}

function conceptPhrases(slideId) {
  if (!conceptsPath || !fs.existsSync(conceptsPath)) return []
  try {
    const ledger = readData(conceptsPath)
    const phrases = []
    for (const concept of ledger.concepts || []) {
      // mustAppear is enforced on the introducing slide. Reinforced/assessed
      // pages only need to use the concept, which the concept review covers;
      // requiring the exact introduction phrases there would be a false gate.
      if (concept.introducedOn !== slideId) continue
      for (const phrase of concept.mustAppear || []) {
        if (phrase && phrase.trim()) phrases.push(phrase.trim())
      }
    }
    return phrases
  } catch {
    return []
  }
}

const chrome = resolveChrome()
if (!chrome) {
  console.error('Chromium not found. Set CHROME_PATH or install Playwright Chromium.')
  process.exit(2)
}
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
})
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
})
const page = await context.newPage()

const problems = []
const reports = []
for (const slideId of wanted) {
  const index = slides.findIndex((slide) => slide.id === slideId)
  if (index < 0) {
    problems.push(`${slideId}: not in storyboard (non-SKIP)`)
    continue
  }
  const deckSlide = deckById.get(slideId)
  if (!deckSlide) {
    problems.push(`${slideId}: missing from deck`)
    continue
  }
  const blocking = { text: [], code: new Set() }
  collectBlocking(deckSlide, blocking)
  for (const phrase of conceptPhrases(slideId)) addBlocking(blocking.text, phrase)

  const prose = new Set()
  collectProse(deckSlide.props || {}, 'props', prose)

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(800)
  const navigated = await page.evaluate((target) => {
    const button = document.querySelector(`#outline [data-go="${target}"]`)
    if (button) {
      button.click()
      return true
    }
    return false
  }, index)
  if (!navigated) {
    for (let i = 0; i < index; i += 1) {
      await page.keyboard.press('ArrowRight').catch(() => {})
      await page.waitForTimeout(waitMs)
    }
  }
  await page.waitForTimeout(waitMs)
  const current = await page.evaluate(() =>
    Number(document.querySelector('#slide')?.dataset?.page || 0),
  )
  if (current && current !== index + 1) {
    problems.push(`${slideId}: navigation landed on page ${current}, expected ${index + 1}`)
    continue
  }
  const rawText = await page.locator('#slide').textContent().catch(() => '')
  const rawVisible = await page.locator('#slide').innerText().catch(() => '')
  const rendered = normalizeCompact(rawText)
  const visible = normalizeText(rawVisible)
  if (!rendered) {
    problems.push(`${slideId}: #slide rendered no text`)
    continue
  }

  // Same browser pass: reference residue from the per-lesson map.
  if (referenceAdaptationPath && fs.existsSync(referenceAdaptationPath)) {
    try {
      const mapping = readData(referenceAdaptationPath)
      for (const entry of mapping.entries || []) {
        if (entry.residue !== 'replace') continue
        if (!(entry.pages || []).includes(slideId)) continue
        const ref = normalizeCompact(entry.reference)
        if (ref.length >= 4 && rendered.includes(ref)) {
          problems.push(`${slideId}/${entry.id}: reference content still visible: ${entry.reference}`)
        }
        if (entry.lessonText) {
          const replacement = normalizeCompact(entry.lessonText)
          if (replacement && !rendered.includes(replacement)) {
            problems.push(
              `${slideId}/${entry.id}: expected lesson replacement not visible: ${entry.lessonText}`,
            )
          }
        }
      }
      for (const [i, item] of (mapping.unmapped || []).entries()) {
        if (item.residue !== 'replace') continue
        const ref = normalizeCompact(item.reference)
        if (ref.length >= 4 && rendered.includes(ref)) {
          problems.push(`${slideId}/unmapped[${i}]: reference content still visible: ${item.reference}`)
        }
      }
    } catch (error) {
      problems.push(`cannot read reference adaptation ${referenceAdaptationPath}: ${error.message}`)
    }
  }

  const missing = []
  for (const expected of blocking.text) {
    if (!rendered.includes(normalizeCompact(expected))) missing.push(expected)
  }
  for (const expected of blocking.code) {
    if (!rendered.includes(normalizeCompact(expected))) missing.push(expected)
  }
  if (missing.length) {
    problems.push(`${slideId}: high-signal text missing from rendered page: ${missing.join(' | ')}`)
  }

  let coverage = null
  if (prose.size) {
    const expectedTokens = tokenSet([...prose].join(' '))
    const renderedTokens = tokenSet(visible)
    let hit = 0
    for (const token of expectedTokens) if (renderedTokens.has(token)) hit += 1
    coverage = expectedTokens.size ? hit / expectedTokens.size : 1
  }
  reports.push({
    slideId,
    blockingText: blocking.text.length,
    blockingCode: blocking.code.size,
    missing,
    proseCoverage: coverage,
    similarityThreshold: threshold,
    advisory:
      coverage != null && coverage < threshold
        ? `prose coverage ${coverage.toFixed(2)} < ${threshold} (advisory only)`
        : '',
  })
}

await browser.close()
const result = {
  ok: problems.length === 0,
  url,
  slides: wanted,
  reports,
  problems,
}
if (jsonOut) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (problems.length) {
  if (!jsonOut) {
    console.error('FAIL rendered text')
    for (const problem of problems) console.error(`  - ${problem}`)
  }
  process.exit(1)
}
if (!jsonOut) {
  const advisory = reports.filter((report) => report.advisory)
  console.log(`OK rendered text — ${wanted.length} slide(s) high-signal match`)
  for (const report of advisory) console.log(`  warning: ${report.slideId}: ${report.advisory}`)
}
