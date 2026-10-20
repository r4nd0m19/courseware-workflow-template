#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { resolveChrome } from './chrome.mjs'

const args = process.argv.slice(2)
const positional = args.filter((a) => !a.startsWith('--'))
const urlArg = positional[0]
function opt(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
function flag(name) {
  return args.includes(name)
}
if (!urlArg) {
  console.error(`usage: node crawl-reference.mjs <url|file> [options]

Options:
  --out <dir>            output directory (default: reference-crawl)
  --pages <n|auto>       target saved pages (default: auto)
  --max-pages <n>        hard cap (default: 200)
  --next-selector <css>  next button selector (default: ArrowRight + common selectors)
  --wait <ms>            wait after navigation (default: 700)
  --viewport <WxH>       viewport (default: 1440x900)
  --storage-state <path> Playwright storage state for authenticated pages
  --no-screenshot        skip screenshots
`)
  process.exit(2)
}

const outDir = path.resolve(opt('--out', 'reference-crawl'))
const pagesArg = opt('--pages', 'auto')
const targetPages = pagesArg === 'auto' ? Infinity : Number(pagesArg)
const maxPages = Number(opt('--max-pages', '200'))
const nextSelector = opt('--next-selector', '')
const waitMs = Number(opt('--wait', '700'))
const [vw, vh] = opt('--viewport', '1440x900').split('x').map(Number)
const storageState = opt('--storage-state', '')
const screenshot = !flag('--no-screenshot')

let url = urlArg
if (!/^[a-z]+:\/\//i.test(url)) {
  const local = path.resolve(url)
  url = fs.existsSync(local) ? pathToFileURL(local).href : `https://${url}`
}

const executablePath = resolveChrome()
if (!executablePath) {
  console.error('Chromium not found. Set CHROME_PATH or install Playwright Chromium.')
  process.exit(2)
}

fs.mkdirSync(path.join(outDir, 'pages'), { recursive: true })
if (screenshot) fs.mkdirSync(path.join(outDir, 'screenshots'), { recursive: true })

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
})
const context = await browser.newContext({
  viewport: { width: vw || 1440, height: vh || 900 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  ...(storageState && fs.existsSync(storageState)
    ? { storageState }
    : {}),
})
const page = await context.newPage()
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
await page.waitForTimeout(1200)

async function snapshot() {
  return page.evaluate(() => {
    const txt = (el) => (el?.innerText || '').trim()
    const codeBlocks = [...document.querySelectorAll('pre code, pre')]
      .map((e) => txt(e))
      .filter((t) => t.length > 0)
    const headings = [...document.querySelectorAll('h1,h2,h3')]
      .map((e) => txt(e))
      .filter(Boolean)
      .slice(0, 30)
    const optionEls = [
      ...document.querySelectorAll(
        'input[type=radio], input[type=checkbox], [data-correct], .option, .option-item, .choice, .quiz-option',
      ),
    ]
    const seen = new Set()
    const options = []
    for (const el of optionEls) {
      const label = el.closest('label') || el.parentElement || el
      const text = txt(label).slice(0, 500)
      if (!text) continue
      const key = text.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const cls = typeof el.className === 'string' ? el.className : ''
      const rawCorrect =
        el.getAttribute?.('data-correct') ??
        el.dataset?.correct ??
        el.getAttribute?.('aria-checked')
      const correct =
        rawCorrect === 'true' ||
        /(^|\s)(correct|right|answer)(\s|$)/i.test(cls)
      options.push({ text, correct, checked: !!el.checked })
    }
    const outputBlocks = [
      ...document.querySelectorAll(
        '[class*="output"], [class*="result"], .feedback, [class*="feedback"]',
      ),
    ]
      .map((e) => txt(e))
      .filter((t) => t && t.length < 2000)
      .slice(0, 30)
    return {
      url: location.href,
      title: headings[0] || document.title,
      headings,
      text: (document.body.innerText || '').slice(0, 30000),
      codeBlocks: [...new Set(codeBlocks)].slice(0, 30),
      options: options.slice(0, 50),
      outputBlocks: [...new Set(outputBlocks)].slice(0, 30),
      html: document.documentElement.outerHTML.slice(0, 300000),
    }
  })
}

async function hashOf() {
  const s = await snapshot()
  return {
    hash: `${s.title}\n${s.text.slice(0, 1000)}`,
    title: s.title,
  }
}

async function advance() {
  const before = await hashOf()
  if (nextSelector) {
    const loc = page.locator(nextSelector).first()
    if (await loc.count()) {
      await loc.click({ timeout: 2000 }).catch(() => {})
      await page.waitForTimeout(waitMs)
    }
  } else {
    await page.keyboard.press('ArrowRight').catch(() => {})
    await page.waitForTimeout(waitMs)
  }
  let after = await hashOf()
  if (after.hash !== before.hash) return true

  const selectors = [
    'button[aria-label*="next" i]',
    'button[aria-label*="下一"]',
    '[aria-label*="下一页"]',
    'a[rel="next"]',
    '.next',
    'button.next',
    '[class*="next"]',
  ]
  for (const sel of selectors) {
    const loc = page.locator(sel).first()
    if (!(await loc.count())) continue
    await loc.click({ timeout: 1500 }).catch(() => {})
    await page.waitForTimeout(waitMs)
    after = await hashOf()
    if (after.hash !== before.hash) return true
  }
  return false
}

const pages = []
const duplicates = []
let attempts = 0
let duplicateStreak = 0
let stoppedReason = ''

while (pages.length < Math.min(targetPages, maxPages) && attempts < maxPages) {
  attempts += 1
  const s = await snapshot()
  const idx = pages.length + 1
  const hash = `${s.title}\n${s.text.slice(0, 1000)}`
  if (pages.some((p) => p.hash === hash)) {
    duplicateStreak += 1
    duplicates.push({ attempt: attempts, title: s.title })
    if (duplicateStreak >= 3) {
      stoppedReason = 'duplicate-content'
      break
    }
  } else {
    duplicateStreak = 0
    const base = String(idx).padStart(3, '0')
    const htmlFile = `pages/${base}.html`
    fs.writeFileSync(path.join(outDir, htmlFile), s.html)
    const record = {
      page: idx,
      url: s.url,
      title: s.title,
      headings: s.headings,
      text: s.text,
      codeBlocks: s.codeBlocks,
      options: s.options,
      outputBlocks: s.outputBlocks,
      htmlFile,
      screenshot: screenshot ? `screenshots/${base}.png` : null,
      hash,
    }
    fs.writeFileSync(
      path.join(outDir, 'pages', `${base}.json`),
      JSON.stringify(record, null, 2),
    )
    if (screenshot) {
      await page
        .screenshot({ path: path.join(outDir, 'screenshots', `${base}.png`), fullPage: true })
        .catch(() => {})
    }
    pages.push(record)
    console.log(`page ${pages.length}: ${s.title || '(untitled)'}${s.options.length ? ` [${s.options.length} options]` : ''}`)
  }

  if (pages.length >= Math.min(targetPages, maxPages)) break
  const moved = await advance()
  if (!moved) {
    stoppedReason = 'no-next-navigation'
    break
  }
}

const manifest = {
  sourceUrl: url,
  capturedAt: new Date().toISOString(),
  viewport: { width: vw || 1440, height: vh || 900 },
  savedPages: pages.length,
  attempts,
  duplicates,
  stoppedReason: stoppedReason || 'target-reached',
  pages: pages.map((p) => ({
    page: p.page,
    title: p.title,
    url: p.url,
    htmlFile: p.htmlFile,
    screenshot: p.screenshot,
    codeBlocks: p.codeBlocks.length,
    options: p.options.length,
  })),
}
fs.writeFileSync(path.join(outDir, 'crawl.json'), JSON.stringify(manifest, null, 2))
console.log(`done: ${pages.length} page(s) -> ${outDir}`)
console.log(`stopped: ${manifest.stoppedReason}`)
await browser.close()
