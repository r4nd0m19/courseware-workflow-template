import { chromium } from 'playwright-core'
import { resolveChrome } from './chrome.mjs'
import { assertScriptApproved, DEFAULT_SCRIPT_APPROVAL } from './approval-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
function flag(name) { return args.includes(name) }
const valueOptions = new Set(['--pages', '--start', '--width', '--height', '--script', '--approval'])
let url = ''
for (let i = 0; i < args.length; i += 1) {
  if (args[i].startsWith('--')) {
    if (valueOptions.has(args[i])) i += 1
    continue
  }
  if (!url) url = args[i]
}
const pages = Number(opt('--pages', '1')) || 1
const start = Number(opt('--start', '0')) || 0
const width = Number(opt('--width', '1440'))
const height = Number(opt('--height', '900'))
const scriptPath = opt('--script')
const approvalPath = opt('--approval', DEFAULT_SCRIPT_APPROVAL)
const debugGo = flag('--debug-go')
if (!url) {
  console.error('usage: node check-overflow.mjs <url> [--pages N] [--start N] [--width 1440] [--height 900] [--debug-go] [--script <courseware.md>] [--approval review/script-approval.json]')
  process.exit(2)
}
if (start < 0) {
  console.error('FAIL --start must be a non-negative slide index')
  process.exit(2)
}
if (scriptPath) {
  try {
    assertScriptApproved(scriptPath, { approvalPath })
  } catch (error) {
    console.error(`FAIL overflow — ${error.message}`)
    process.exit(1)
  }
}

const executablePath = resolveChrome()
if (!executablePath) {
  console.error('Chromium not found.')
  console.error('Set CHROME_PATH or run: cd workflow/tools && npx playwright install chromium')
  process.exit(2)
}

async function checkOverflow(page) {
  return page.evaluate(() => {
    const issues = []
    const tol = 2
    const doc = document.scrollingElement
    if (
      doc &&
      (doc.scrollHeight > window.innerHeight + tol ||
        doc.scrollWidth > window.innerWidth + tol)
    ) {
      issues.push({
        label: 'document',
        scrollH: doc.scrollHeight,
        clientH: window.innerHeight,
        scrollW: doc.scrollWidth,
        clientW: window.innerWidth,
      })
    }
    // Check the slide content plus document-level scrolling. Shell chrome
    // (time-track regions, decorative layers) intentionally clips its own
    // children and is not teaching content.
    const root = document.querySelector('#slide') || document.querySelector('.stage') || document.body
    const check = (el, label) => {
      if (!el || el.clientHeight === 0 || el.clientWidth === 0) return
      const cs = getComputedStyle(el)
      const constrained = [cs.overflowX, cs.overflowY].some(
        (v) => v === 'hidden' || v === 'auto' || v === 'scroll',
      )
      if (!constrained) return
      if (
        el.scrollHeight > el.clientHeight + tol ||
        el.scrollWidth > el.clientWidth + tol
      ) {
        issues.push({
          label,
          tag: el.tagName,
          cls: String(el.className).slice(0, 90),
          overflow: `${cs.overflowX}/${cs.overflowY}`,
          scrollH: el.scrollHeight,
          clientH: el.clientHeight,
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
        })
      }
    }
    check(root, 'slide')
    if (root) [...root.querySelectorAll('*')].forEach((el, i) => check(el, `el-${i}`))
    return issues
  })
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
let failed = 0

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
await page.waitForTimeout(1000)

async function showDebugPage(index) {
  const available = await page.evaluate(() => typeof window.COURSEWARE_DEBUG?.go === 'function')
  if (!available) throw new Error('COURSEWARE_DEBUG.go is not available')
  await page.evaluate((i) => window.COURSEWARE_DEBUG.go(i), index)
  await page.waitForTimeout(500)
}

async function checkCurrent(pageNumber) {
  const issues = await checkOverflow(page)
  if (issues.length) {
    failed += 1
    console.error(`FAIL page ${pageNumber} at ${width}x${height}: content does not fit (no scrollbars allowed)`)
    for (const issue of issues) console.error(`  ${JSON.stringify(issue)}`)
  } else {
    console.log(`OK page ${pageNumber} at ${width}x${height}`)
  }
}

if (debugGo) {
  for (let i = 0; i < pages; i += 1) {
    await showDebugPage(start + i)
    await checkCurrent(start + i + 1)
  }
} else {
  for (let i = 0; i < start; i += 1) {
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(300)
  }
  for (let i = 0; i < pages; i += 1) {
    if (i > 0) {
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(500)
    }
    await checkCurrent(start + i + 1)
  }
}

await browser.close()
if (failed) process.exit(1)
