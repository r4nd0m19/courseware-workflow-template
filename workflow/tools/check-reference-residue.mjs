#!/usr/bin/env node
// Deterministic reference-residue check for one rendered page.
//
// The per-lesson reference adaptation map marks reference-specific strings as
// `residue: replace`. This tool reads the rendered #slide text and fails if any
// of those strings is still visible. It also verifies optional `lessonText`
// replacements are present. It does not judge prose or visuals; those remain
// in the page self-review.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChrome } from './chrome.mjs'
import { readData } from './lib.mjs'
import { normalizeCompact as normalize } from './rendered-text-lib.mjs'
import { requireProductionRun } from './review-guard.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
function flag(name) {
  return args.includes(name)
}
const mappingPath = args.find((arg) => !arg.startsWith('--'))
const url = opt('--url')
const storyboardPath = opt('--storyboard')
const slidesRaw = opt('--slides')
const waitMs = Number(opt('--wait', '500'))
const minLength = Number(opt('--min-length', '4'))
const manual = flag('--manual')
const jsonOut = flag('--json')

if (!mappingPath || !url || !storyboardPath || !slidesRaw) {
  console.error(
    'usage: node check-reference-residue.mjs <reference-adaptation.json> --url <deck-url> --storyboard <storyboard.yml> --slides S02B[,S02C] [--min-length 4] [--wait 500] [--json] [--manual]',
  )
  process.exit(2)
}
requireProductionRun({ tool: 'check-reference-residue', manual })

const mapping = readData(mappingPath)
const storyboard = readData(storyboardPath)
const slides = storyboard.slides.filter((slide) => slide.status !== 'SKIP')
const wanted = slidesRaw.split(',').map((id) => id.trim()).filter(Boolean)
const problems = []
const checks = []

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
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
await page.waitForTimeout(800)

for (const slideId of wanted) {
  const index = slides.findIndex((slide) => slide.id === slideId)
  if (index < 0) {
    problems.push(`${slideId}: not in storyboard (non-SKIP)`)
    continue
  }
  // Start each slide from the first page so a multi-slide run cannot drift.
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(800)
  const gone = await page.evaluate((target) => {
    const button = document.querySelector(`#outline [data-go="${target}"]`)
    if (button) {
      button.click()
      return true
    }
    return false
  }, index)
  if (!gone) {
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
  const rendered = normalize(await page.locator('#slide').textContent().catch(() => ''))
  if (!rendered) {
    problems.push(`${slideId}: #slide rendered no text`)
    continue
  }

  const entries = (mapping.entries || []).filter(
    (entry) =>
      entry.residue === 'replace' &&
      (entry.pages || []).includes(slideId),
  )
  for (const entry of entries) {
    const ref = normalize(entry.reference)
    if (ref.length >= minLength && rendered.includes(ref)) {
      problems.push(`${slideId}/${entry.id}: reference content still visible: ${entry.reference}`)
      checks.push({ slideId, id: entry.id, status: 'fail', notes: 'reference residue' })
    } else {
      checks.push({ slideId, id: entry.id, status: 'pass', notes: 'no reference residue' })
    }
    if (entry.lessonText) {
      const replacement = normalize(entry.lessonText)
      if (replacement && !rendered.includes(replacement)) {
        problems.push(
          `${slideId}/${entry.id}: expected lesson replacement not visible: ${entry.lessonText}`,
        )
      }
    }
  }

  for (const [i, item] of (mapping.unmapped || []).entries()) {
    if (item.residue !== 'replace') continue
    const ref = normalize(item.reference)
    if (ref.length >= minLength && rendered.includes(ref)) {
      problems.push(`${slideId}/unmapped[${i}]: reference content still visible: ${item.reference}`)
    }
  }
}

await browser.close()
const result = {
  ok: problems.length === 0,
  mapping: mappingPath,
  url,
  slides: wanted,
  checks,
  problems,
}
if (jsonOut) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (problems.length) {
  if (!jsonOut) {
    console.error('FAIL reference residue')
    for (const problem of problems) console.error(`  - ${problem}`)
  }
  process.exit(1)
}
if (!jsonOut) console.log(`OK reference residue — ${wanted.length} slide(s) clean`)
