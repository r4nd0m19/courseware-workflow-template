#!/usr/bin/env node
// Visual overlap gate: text boxes must not intersect the character/illustration
// on a rendered page. The shell positions characters absolutely, so a long
// cover-output or callout can silently run under the art. This is a geometry
// fact, not a taste judgment; check it before the human page review.
import { chromium } from 'playwright-core'
import { readData } from './lib.mjs'
import { resolveChrome } from './chrome.mjs'
import { requireProductionRun } from './review-guard.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
function flag(name) {
  return args.includes(name)
}
const valueOptions = new Set([
  '--slides',
  '--storyboard',
  '--width',
  '--height',
])
let url = ''
for (let i = 0; i < args.length; i += 1) {
  if (args[i].startsWith('--')) {
    if (valueOptions.has(args[i])) i += 1
    continue
  }
  if (!url) url = args[i]
}
const slidesArg = opt('--slides')
const storyboardPath = opt('--storyboard')
const width = Number(opt('--width', '1440')) || 1440
const height = Number(opt('--height', '900')) || 900
const manual = flag('--manual')
const jsonOut = flag('--json')

if (!url || !slidesArg || !storyboardPath) {
  console.error(
    'usage: node check-overlap.mjs <deck-url> --slides S01[,S02] --storyboard <storyboard.yml> [--width 1440] [--height 900] [--manual] [--json]',
  )
  process.exit(2)
}
requireProductionRun({ tool: 'check-overlap', manual })

const storyboard = readData(storyboardPath)
const ordered = (storyboard.slides || []).filter((s) => s.status !== 'SKIP')
const wanted = slidesArg.split(',').map((s) => s.trim()).filter(Boolean)
const indexes = wanted.map((id) => ({ id, index: ordered.findIndex((s) => s.id === id) }))
for (const item of indexes) {
  if (item.index < 0) {
    console.error(`FAIL overlap — slide ${item.id} not found in ${storyboardPath}`)
    process.exit(2)
  }
}

const executablePath = resolveChrome()
if (!executablePath) {
  console.error('Chromium not found. Set CHROME_PATH or install Playwright Chromium.')
  process.exit(2)
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
})
const context = await browser.newContext({
  viewport: { width, height },
  locale: 'zh-CN',
})
const page = await context.newPage()
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
await page.waitForTimeout(800)

async function showSlide(index) {
  const available = await page.evaluate(
    () => typeof window.COURSEWARE_DEBUG?.go === 'function',
  )
  if (available) {
    await page.evaluate((i) => window.COURSEWARE_DEBUG.go(i), index)
  } else {
    await page.keyboard.press('Home').catch(() => {})
    for (let i = 0; i < index; i += 1) {
      await page.keyboard.press('ArrowRight').catch(() => {})
      await page.waitForTimeout(120)
    }
  }
  await page.waitForTimeout(500)
}

function findOverlaps() {
  const textSelector = [
    'h1',
    'h2',
    'h3',
    'p',
    '.lead',
    '.cover-kicker',
    '.cover-output',
    '.monitor-bar',
    '.callout',
    '.card',
    '.feedback',
    '.quiz-question',
    '.panel-head',
    '.code-card',
    'pre',
  ].join(',')
  const artSelector = [
    '.pixel-student',
    '.cover-robot',
    '.cover-art > img',
    '.cover-art > svg',
  ].join(',')
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const style = getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden'
  }
  const texts = [...new Set([...document.querySelectorAll(textSelector)])]
    .filter((el) => visible(el) && String(el.innerText || '').trim())
    .map((el) => ({
      element: el,
      label: `${el.tagName.toLowerCase()}.${String(el.className || '').split(/\s+/).filter(Boolean).join('.')}`,
      text: String(el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      rect: el.getBoundingClientRect(),
    }))
  const arts = [...new Set([...document.querySelectorAll(artSelector)])]
    .filter(visible)
    .map((el) => ({
      element: el,
      label: `${el.tagName.toLowerCase()}.${String(el.className || '').split(/\s+/).filter(Boolean).join('.')}`,
      rect: el.getBoundingClientRect(),
    }))
  const plainRect = (rect) => ({
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  })
  const overlaps = []
  for (const text of texts) {
    for (const art of arts) {
      if (text.element === art.element) continue
      if (art.element.contains(text.element) || text.element.contains(art.element)) continue
      const overlapWidth =
        Math.min(text.rect.right, art.rect.right) -
        Math.max(text.rect.left, art.rect.left)
      const overlapHeight =
        Math.min(text.rect.bottom, art.rect.bottom) -
        Math.max(text.rect.top, art.rect.top)
      if (overlapWidth > 4 && overlapHeight > 4) {
        overlaps.push({
          text: text.label,
          textContent: text.text,
          art: art.label,
          textRect: plainRect(text.rect),
          artRect: plainRect(art.rect),
        })
      }
    }
  }
  return overlaps
}

let failed = 0
const results = []
for (const item of indexes) {
  await showSlide(item.index)
  const overlaps = await page.evaluate(findOverlaps)
  results.push({ slideId: item.id, overlaps })
  if (overlaps.length) {
    failed += 1
    if (!jsonOut) {
      console.error(`FAIL overlap page ${item.id}: text intersects the character/illustration`)
      for (const overlap of overlaps) {
        console.error(
          `  ${overlap.text} "${overlap.textContent}" overlaps ${overlap.art}`,
        )
      }
    }
  } else if (!jsonOut) {
    console.log(`OK overlap page ${item.id}`)
  }
}

await browser.close()
if (jsonOut) {
  console.log(JSON.stringify({ ok: failed === 0, slides: results }, null, 2))
}
if (failed) process.exit(1)
