#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChrome } from './chrome.mjs'

const url = process.argv[2]
function opt(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
if (!url) {
  console.error('usage: node capture-url.mjs <url> [--out dir] [--width 1440] [--height 900] [--wait 1000] [--selector #slide]')
  process.exit(2)
}
const outDir = path.resolve(
  opt('--out', process.env.COURSEWARE_SCREENSHOTS_DIR || 'screenshots'),
)
const width = Number(opt('--width', '1440'))
const height = Number(opt('--height', '900'))
const waitMs = Number(opt('--wait', '1000'))
const selector = opt('--selector', '#slide')
const nextCount = Number(opt('--next', '0'))
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
const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
const page = await context.newPage()
const errors = []
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`) })
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => errors.push(`goto: ${e.message}`))
await page.waitForTimeout(waitMs)
for (let i = 0; i < nextCount; i++) {
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(350)
}
const pageFile = path.join(outDir, 'page.png')
await page.screenshot({ path: pageFile, fullPage: false }).catch(() => {})
let elementFile = null
if (selector) {
  const target = page.locator(selector).first()
  if (await target.count()) {
    elementFile = path.join(outDir, 'slide.png')
    await target.screenshot({ path: elementFile, timeout: 10000 }).catch(() => { elementFile = null })
  }
}
const info = await page.evaluate(() => ({
  title: document.title,
  bodyClass: document.body.className,
  slideClass: document.querySelector('#slide')?.className || '',
  text: (document.querySelector('#slide')?.innerText || '').slice(0, 500),
}))
const report = { url, width, height, pageFile, elementFile, errors, info }
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()
if (errors.length) process.exit(1)
