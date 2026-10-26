import fs from 'node:fs'
import { parseScript, extractFencedBlocks } from './script-lib.mjs'
import { readData } from './lib.mjs'

// Objective per-screen signals for the density self-review. These are evidence,
// not a score: the reviewer still has to name the screen's semantic units.
// Keep the definitions here so density-report.mjs and check-self-review.mjs
// always agree on what was measured.

const TEXT_LANGS = new Set(['', 'text', 'txt', 'plain', 'plaintext'])

function stripFences(text) {
  return String(text || '').replace(/```[\s\S]*?```/g, '')
}

function countListItems(text) {
  let count = 0
  for (const line of stripFences(text).split(/\r?\n/)) {
    if (/^\s*(?:[-*+]|\d+\.)\s+\S/.test(line)) count += 1
  }
  return count
}

function countSentences(text) {
  return String(text || '')
    .split(/[。！？；.!?;]+/)
    .map((s) => s.trim())
    .filter(Boolean).length
}

function tableStats(text) {
  const rows = []
  for (const line of stripFences(text).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    const cells = trimmed
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim())
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue
    rows.push(cells)
  }
  if (rows.length === 0) return { rows: 0, cols: 0 }
  const dataRows = rows.length > 1 ? rows.length - 1 : 0
  const cols = rows.reduce((max, cells) => Math.max(max, cells.length), 0)
  return { rows: dataRows, cols }
}

function fencedStats(text) {
  const blocks = extractFencedBlocks(text)
  let codeLines = 0
  let codeBlocks = 0
  let textRows = 0
  let textBlocks = 0
  for (const block of blocks) {
    const lines = block.content.split(/\r?\n/).filter((line) => line.trim()).length
    if (TEXT_LANGS.has(block.lang)) {
      textRows += lines
      textBlocks += 1
    } else {
      codeLines += lines
      codeBlocks += 1
    }
  }
  return { codeLines, codeBlocks, textRows, textBlocks }
}

export function screenSignals(slide, storyboardSlide) {
  const screen = slide.screenContent || ''
  const tables = tableStats(screen)
  const fences = fencedStats(screen)
  const narration = slide.narration || ''
  return {
    contentRefs: Array.isArray(storyboardSlide?.contentRefs)
      ? storyboardSlide.contentRefs.length
      : 0,
    tableRows: tables.rows,
    tableCols: tables.cols,
    textRows: fences.textRows,
    textBlocks: fences.textBlocks,
    codeLines: fences.codeLines,
    codeBlocks: fences.codeBlocks,
    bulletItems: countListItems(screen),
    narrationSentences: countSentences(narration),
    narrationChars: narration.replace(/\s+/g, '').length,
    screenChars: stripFences(screen).replace(/\s+/g, '').length,
  }
}

// Structured interaction/component facts for the script-stage complexity
// review. Free-text step/control counts are intentionally left to the reviewer;
// these are the facts the script already declares in machine fields.
export function complexitySignals(slide, storyboardSlide) {
  const plan = Array.isArray(slide.machine?.componentPlan)
    ? slide.machine.componentPlan
    : []
  const componentIds = Array.isArray(slide.machine?.components)
    ? slide.machine.components
    : Array.isArray(storyboardSlide?.components)
      ? storyboardSlide.components
      : []
  const entries = plan.length
    ? plan
    : componentIds.map((id) => ({ id, status: 'unknown' }))
  const interaction =
    slide.machine?.interaction || storyboardSlide?.interaction || {}
  return {
    components: entries.length,
    newComponents: entries.filter((entry) =>
      ['new', 'extend'].includes(String(entry?.status || '')),
    ).length,
    interactionLevel: String(interaction.level || ''),
    interactionType: String(interaction.type || ''),
    staticPage:
      String(interaction.level || '') === 'watch' ||
      String(interaction.type || '') === 'static-reading',
    hasStaticAlternative: Boolean(interaction.staticAlternative),
    hasMisconception: Boolean(interaction.misconception),
  }
}

const COMPLEXITY_SIGNAL_KEYS = [
  'components',
  'newComponents',
  'interactionLevel',
  'interactionType',
  'staticPage',
  'hasStaticAlternative',
  'hasMisconception',
]

export function complexitySignalKeys() {
  return [...COMPLEXITY_SIGNAL_KEYS]
}

export function compareComplexitySignals(declared, computed) {
  const diffs = []
  for (const key of COMPLEXITY_SIGNAL_KEYS) {
    const want = computed?.[key]
    const got = declared?.[key]
    if (got !== want) diffs.push(`${key}: review=${got}, current=${want}`)
  }
  return diffs
}

const SIGNAL_KEYS = [
  'contentRefs',
  'tableRows',
  'tableCols',
  'textRows',
  'textBlocks',
  'codeLines',
  'codeBlocks',
  'bulletItems',
  'narrationSentences',
  'narrationChars',
  'screenChars',
]

export function signalKeys() {
  return [...SIGNAL_KEYS]
}

export function compareSignals(declared, computed) {
  const diffs = []
  for (const key of SIGNAL_KEYS) {
    const want = computed[key]
    const got = declared?.[key]
    if (got !== want) diffs.push(`${key}: review=${got}, current=${want}`)
  }
  return diffs
}

export function buildDensityReport(scriptPath, storyboardPath, slideIds = null) {
  const parsed = parseScript(scriptPath)
  const storyboard = storyboardPath ? readData(storyboardPath) : null
  if (storyboard && !Array.isArray(storyboard.slides)) {
    throw new Error(`${storyboardPath}: slides must be an array`)
  }
  const storyboardById = new Map((storyboard?.slides || []).map((s) => [s.id, s]))
  const wanted = slideIds ? new Set(slideIds) : null
  const slides = []
  for (const slide of parsed.slides) {
    if (slide.machine?.status === 'SKIP') continue
    if (wanted && !wanted.has(slide.id)) continue
    const board =
      storyboardById.get(slide.id) || {
        contentRefs: Array.isArray(slide.machine?.contentRefs)
          ? slide.machine.contentRefs
          : [],
      }
    slides.push({
      slideId: slide.id,
      title: slide.headingTitle,
      signals: screenSignals(slide, board),
      complexity: complexitySignals(slide, board),
    })
  }
  if (wanted) {
    const found = new Set(slides.map((s) => s.slideId))
    const missing = [...wanted].filter((id) => !found.has(id))
    if (missing.length) {
      throw new Error(`slides not found in script/storyboard: ${missing.join(', ')}`)
    }
  }
  return {
    script: scriptPath,
    storyboard: storyboardPath || '(script machine fields)',
    slides,
  }
}

export function readSlideIds(raw) {
  if (!raw) return null
  const ids = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return ids.length ? ids : null
}
