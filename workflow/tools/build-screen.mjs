#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChrome } from './chrome.mjs'
import { readData } from './lib.mjs'
import { assertScriptApproved, DEFAULT_SCRIPT_APPROVAL } from './approval-lib.mjs'
import { requireProductionRun } from './review-guard.mjs'

const args = process.argv.slice(2)
const slideId = args.find((a) => !a.startsWith('--'))
function opt(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
function flag(name) {
  return args.includes(name)
}
if (!slideId) {
  console.error(`usage: node build-screen.mjs <slide-id> [options]

Options:
  --url <deck-url>        deck dev/preview URL (omit for stub mode)
  --storyboard <path>     storyboard.yml for slide order
  --script <path>         courseware.md; when set, its approval ledger must match
  --approval <path>       whole-script approval ledger (default: review/script-approval.json)
  --out <dir>             screenshot output (default: screenshots)
  --wait <ms>             wait after navigation (default: 500)
  --index <n>             zero-based index in the current deck (for section-filtered decks)
  --next-selector <css>   optional next control
  --debug-go              navigate with COURSEWARE_DEBUG.go(index) instead of keys
  --manual                allow a manual/test render outside the production workflow
  --alpha                 alias of --manual for whole-deck Alpha screenshots
`)
  process.exit(2)
}

const url = opt('--url', '')
const storyboardPath = opt('--storyboard', '')
const scriptPath = opt('--script', '')
const approvalPath = opt('--approval', DEFAULT_SCRIPT_APPROVAL)
const outDir = path.resolve(opt('--out', 'screenshots'))
const waitMs = Number(opt('--wait', '500'))
const explicitIndex = opt('--index', '')
const nextSelector = opt('--next-selector', '')
const debugGo = flag('--debug-go')
const manual = flag('--manual') || flag('--alpha')

if (!url) {
  console.log(`build screen ${slideId} (stub: no --url)`)
  process.exit(0)
}
requireProductionRun({ tool: `build-screen ${slideId}`, manual })
if (!storyboardPath) {
  console.error('--storyboard is required when --url is provided')
  process.exit(2)
}
if (scriptPath) {
  try {
    assertScriptApproved(scriptPath, { approvalPath })
  } catch (error) {
    console.error(`FAIL screen ${slideId} — ${error.message}`)
    process.exit(1)
  }
}

const storyboard = readData(storyboardPath)
const slides = storyboard.slides.filter((s) => s.status !== 'SKIP')
const storyboardIndex = slides.findIndex((s) => s.id === slideId)
if (storyboardIndex < 0) {
  console.error(`slide ${slideId} not found in storyboard (non-SKIP)`)
  process.exit(2)
}
const index = explicitIndex === '' ? storyboardIndex : Number(explicitIndex)
if (!Number.isInteger(index) || index < 0 || index >= slides.length) {
  console.error(`invalid --index ${explicitIndex} for ${slides.length} slide(s)`)
  process.exit(2)
}

const chrome = resolveChrome()
if (!chrome) {
  console.error('Chromium not found. Set CHROME_PATH or install Playwright Chromium.')
  process.exit(2)
}

fs.mkdirSync(outDir, { recursive: true })
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

if (debugGo) {
  const available = await page.evaluate(() => typeof window.COURSEWARE_DEBUG?.go === 'function')
  if (!available) {
    console.error('--debug-go requested but COURSEWARE_DEBUG.go is not available')
    await browser.close()
    process.exit(1)
  }
  await page.evaluate((i) => window.COURSEWARE_DEBUG.go(i), index)
  await page.waitForTimeout(waitMs)
} else {
  for (let i = 0; i < index; i++) {
    if (nextSelector) {
      const loc = page.locator(nextSelector).first()
      if (await loc.count()) {
        await loc.click({ timeout: 1500 }).catch(() => {})
      } else {
        await page.keyboard.press('ArrowRight').catch(() => {})
      }
    } else {
      await page.keyboard.press('ArrowRight').catch(() => {})
    }
    await page.waitForTimeout(waitMs)
  }
}

const target = page.locator('.stage, .slide, #slide').first()
const screenshot = path.join(outDir, `${slideId}.png`)
let shot = true
try {
  await target.screenshot({ path: screenshot, timeout: 10000 })
} catch {
  shot = false
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {})
}
const title = await page
  .locator('h1,h2')
  .first()
  .innerText()
  .catch(() => '')
const record = {
  slideId,
  index,
  title: String(title).trim(),
  url: page.url(),
  screenshot,
  elementShot: shot,
  capturedAt: new Date().toISOString(),
}
fs.writeFileSync(path.join(outDir, `${slideId}.json`), JSON.stringify(record, null, 2))
console.log(`built ${slideId} -> ${screenshot}`)
await browser.close()
