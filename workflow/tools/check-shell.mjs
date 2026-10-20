#!/usr/bin/env node
// Validate a shell package and render its default preview deck.
//
// Checks the package wiring (data hooks, source ledger, style pack, reference
// art hashes), then opens the shell with COURSEWARE_DEBUG and walks every
// declared slide type. This is the shell-library counterpart to
// check-source-fidelity/check-deck-data, which assume the older prototype.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChrome } from './chrome.mjs'
import { readJson, resolveShellDir, serveDir, validateShellPackage } from './shell-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
function flag(name) { return args.includes(name) }

let shellDir
try {
  shellDir = resolveShellDir(opt('--shell', 'branch-choice'))
} catch (error) {
  console.error(`FAIL ${error.message}`)
  process.exit(2)
}
const siteOverride = opt('--site')
const urlArg = opt('--url')
const shotsDir = opt('--shots')
const jsonOut = flag('--json')
const requireArt = flag('--require-art')
const report = { shell: shellDir, site: siteOverride || '', ok: false, errors: [], warnings: [], notes: [], types: [], slides: [] }

const packageCheck = validateShellPackage(shellDir)
report.errors.push(...packageCheck.errors)
report.warnings.push(...packageCheck.warnings)
report.notes.push(...packageCheck.notes)
if (!packageCheck.shell) {
  finish()
}
const shell = packageCheck.shell

const chrome = resolveChrome()
if (!chrome) {
  report.errors.push('Chromium not found. Set CHROME_PATH or install Playwright Chromium.')
  finish()
}
let server = null
let url = urlArg
if (!url) {
  const siteDir = siteOverride ? path.resolve(siteOverride) : path.join(shellDir, 'site')
  if (!fs.existsSync(siteDir)) {
    report.errors.push(`site directory not found: ${siteDir}`)
    finish()
  }
  server = await serveDir(siteDir)
  url = server.url
}
report.site = report.site || url

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) consoleErrors.push(`console: ${m.text()}`) })
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => {
  report.errors.push(`goto: ${e.message}`)
  return null
})
if (response && !response.ok()) report.errors.push(`HTTP ${response.status()} for ${url}`)
await page.waitForTimeout(700)

const snapshot = await page.evaluate(() => ({
  debug: Boolean(window.COURSEWARE_DEBUG),
  types: window.COURSEWARE_DEBUG?.types?.() || [],
  deckTypes: (window.COURSEWARE_SHELL_DATA?.slides || []).map((slide) => slide.type),
  meta: window.COURSEWARE_SHELL_DATA?.meta || null,
  shellSelectors: Object.fromEntries(
    ['.app', '.topbar', '.footer', '#slide', '#outline', '.voice-picker', '.time-track', '.pixel-student']
      .map((selector) => [selector, document.querySelectorAll(selector).length]),
  ),
  counter: document.querySelector('#counter')?.textContent || '',
  slideClass: document.querySelector('#slide')?.className || '',
  art: window.COURSEWARE_SHELL_ART || null,
})).catch((error) => ({ error: String(error) }))
if (snapshot.error) report.errors.push(`runtime: ${snapshot.error}`)
if (!snapshot.debug) report.errors.push('COURSEWARE_DEBUG is missing')
if (!Array.isArray(snapshot.types) || !snapshot.types.length) report.errors.push('COURSEWARE_DEBUG.types() returned no slide types')
if (!snapshot.meta) report.errors.push('COURSEWARE_SHELL_DATA.meta is missing')
report.types = snapshot.types || []
for (const [selector, count] of Object.entries(snapshot.shellSelectors || {})) {
  if (!count) report.errors.push(`shell selector not found: ${selector}`)
}
if (JSON.stringify(snapshot.types) !== JSON.stringify(snapshot.deckTypes)) {
  report.errors.push(`COURSEWARE_DEBUG.types() does not match the deck: ${JSON.stringify(snapshot.types)} vs ${JSON.stringify(snapshot.deckTypes)}`)
}
if (snapshot.counter !== `1 / ${snapshot.types.length}`) report.errors.push(`counter at load is "${snapshot.counter}", expected "1 / ${snapshot.types.length}"`)
if (!/hero/.test(snapshot.slideClass)) report.errors.push(`first slide is not hero: ${snapshot.slideClass}`)
const artSlots = (shell.assets?.illustrations || []).map((art) => art.slot)
const artEntries = snapshot.art || {}
const missingArt = artSlots.filter((slot) => !artEntries[slot])
if (requireArt && missingArt.length) report.errors.push(`COURSEWARE_SHELL_ART is missing generated slot(s): ${missingArt.join(', ')}`)
if (Object.keys(artEntries).length) report.notes.push(`generated art slots: ${Object.keys(artEntries).join(', ')}`)

// Every declared slide type must be producible by the shell renderer. The
// default deck may not exercise all of them, so navigate through the deck and
// report which types the preview actually covers.
const fidelity = readJson(path.join(shellDir, 'fidelity.json'))
const typeSelectors = new Map()
for (const spec of Object.values(fidelity.components || {})) {
  for (const type of spec.sourceTypes || []) typeSelectors.set(type, spec.selectors || ['.slide-inner'])
}
const covered = new Set()
for (const type of shell.dataContract.slideTypes) {
  if (!typeSelectors.has(type)) report.errors.push(`fidelity.json: no selectors for slide type ${type}`)
}
for (let i = 0; i < snapshot.types.length; i += 1) {
  const state = await page.evaluate((index) => {
    window.COURSEWARE_DEBUG.go(index)
    return {
      index,
      type: window.COURSEWARE_DEBUG.types()[index],
      slideClass: document.querySelector('#slide')?.className || '',
      text: (document.querySelector('#slide')?.innerText || '').trim().slice(0, 120),
      counter: document.querySelector('#counter')?.textContent || '',
    }
  }, i)
  const missing = await page.evaluate((selectors) => selectors.filter((selector) => !document.querySelector(selector)), typeSelectors.get(state.type) || ['.slide-inner'])
  await page.waitForFunction(() => {
    const image = document.querySelector('#slide img.generated-mascot')
    return !image || (image.complete && image.naturalWidth > 0)
  }, null, { timeout: 2000 }).catch(() => {})
  const artState = await page.evaluate(() => {
    const image = document.querySelector('#slide img.generated-mascot')
    return image ? { src: image.getAttribute('src') || '', loaded: image.complete && image.naturalWidth > 0 } : null
  })
  const slide = { ...state, missingSelectors: missing, art: artState }
  report.slides.push(slide)
  if (!state.slideClass.split(/\s+/).includes(state.type)) report.errors.push(`slide ${i + 1}: class "${state.slideClass}" does not include type ${state.type}`)
  if (!state.text) report.errors.push(`slide ${i + 1} (${state.type}): rendered text is empty`)
  if (state.counter !== `${i + 1} / ${snapshot.types.length}`) report.errors.push(`slide ${i + 1}: counter "${state.counter}"`)
  if (missing.length) report.errors.push(`slide ${i + 1} (${state.type}): missing selector(s) ${missing.join(', ')}`)
  if (artState && !artState.loaded) report.errors.push(`slide ${i + 1} (${state.type}): generated art failed to load: ${artState.src}`)
  if (typeSelectors.has(state.type)) covered.add(state.type)
  if (shotsDir) {
    fs.mkdirSync(path.resolve(shotsDir), { recursive: true })
    await page.screenshot({ path: path.join(path.resolve(shotsDir), `${String(i + 1).padStart(2, '0')}-${state.type}.png`) })
  }
}
const unexercised = shell.dataContract.slideTypes.filter((type) => !covered.has(type))
report.notes.push(`preview exercises: ${[...covered].join(', ')}`)
if (unexercised.length) report.warnings.push(`declared but not exercised by the preview deck: ${unexercised.join(', ')}`)
if (consoleErrors.length) report.errors.push(...consoleErrors)
report.url = url
report.consoleErrors = consoleErrors
await browser.close()
if (server) await server.close()
finish()

function finish() {
  report.ok = report.errors.length === 0
  if (jsonOut) console.log(JSON.stringify(report, null, 2))
  else {
    if (report.ok) console.log(`OK ${shellDir}`)
    else console.error(`FAIL ${shellDir}`)
    for (const error of report.errors) console.error(`  - ${error}`)
    for (const warning of report.warnings) console.error(`  warning: ${warning}`)
    for (const note of report.notes) console.error(`  note: ${note}`)
  }
  process.exit(report.ok ? 0 : 1)
}
