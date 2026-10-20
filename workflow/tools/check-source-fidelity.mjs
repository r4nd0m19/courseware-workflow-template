#!/usr/bin/env node
// Source-fidelity gate: copied reference CSS/JS must stay byte-identical,
// and the rendered deck must keep the reference DOM geometry/selectors.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { chromium } from 'playwright-core'
import { resolveChrome } from './chrome.mjs'

const args = process.argv.slice(2)
const root = process.cwd()
function opt(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
function flag(name) { return args.includes(name) }
const sourcePath = path.resolve(opt('--source', 'style-pack/source/SOURCE.json'))
const fidelityPath = path.resolve(opt('--fidelity', 'style-pack/source/fidelity.json'))
const siteDir = path.resolve(opt('--site', 'prototype/site'))
const url = opt('--url', '')
const jsonOut = flag('--json')
const checkMirror = flag('--check-mirror')
const sourceOnly = flag('--source-only')
const errors = []
const warnings = []
const notes = []

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
function exists(file) { return fs.existsSync(file) && fs.statSync(file).isFile() }
function apngFrames(file) {
  const data = fs.readFileSync(file)
  if (data.length < 8 || data.toString('ascii', 1, 4) !== 'PNG') return 0
  let off = 8
  while (off + 8 <= data.length) {
    const len = data.readUInt32BE(off)
    const type = data.toString('ascii', off + 4, off + 8)
    if (type === 'acTL') return data.readUInt32BE(off + 8)
    off += 12 + len
    if (type === 'IEND') break
  }
  return 0
}

if (!exists(sourcePath)) {
  console.error(`source manifest not found: ${sourcePath}`)
  process.exit(2)
}
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
const sourceRoot = path.dirname(sourcePath)
for (const entry of source.files || []) {
  const local = path.resolve(sourceRoot, entry.file.replace(/^source\//, ''))
  const sourceCopy = path.resolve(sourceRoot, entry.file)
  const target = exists(sourceCopy) ? sourceCopy : local
  if (!exists(target)) {
    errors.push(`missing copied source: ${entry.file}`)
    continue
  }
  const actual = sha256(target)
  if (actual !== entry.sha256) errors.push(`${entry.file}: hash ${actual} != ${entry.sha256}`)
  if (entry.bytes && fs.statSync(target).size !== entry.bytes) errors.push(`${entry.file}: bytes ${fs.statSync(target).size} != ${entry.bytes}`)
  // site copy must match the copied source; 00-base.css is inlined in index.html
  if (!sourceOnly && entry.file.endsWith('.css')) {
    if (path.basename(entry.file) === '00-base.css') {
      const htmlFile = path.join(siteDir, 'index.html')
      const html = exists(htmlFile) ? fs.readFileSync(htmlFile, 'utf8') : ''
      const match = html.match(/<style>\s*([\s\S]*?)\s*<\/style>/)
      if (!match) errors.push('prototype/site/index.html: inline base <style> not found')
      else {
        const inline = match[1].trim().replace(/\.\/assets\//g, './CPP编程入门_resource/')
        const base = fs.readFileSync(target, 'utf8').trim()
        if (inline !== base) errors.push('prototype/site/index.html: inline base CSS differs from copied 00-base.css')
        else notes.push('inline base CSS matches copied 00-base.css')
      }
    } else {
      const siteName = path.basename(entry.file).replace(/^\d+-/, '')
      const siteFile = path.join(siteDir, siteName)
      if (!exists(siteFile)) errors.push(`site css not found: ${siteName}`)
      else {
        const siteHash = sha256(siteFile)
        if (siteHash !== entry.sha256) errors.push(`prototype/site/${siteName}: hash ${siteHash} != copied source`)
      }
    }
  }
  if (!sourceOnly && entry.file.endsWith('.js')) {
    const siteFile = path.join(siteDir, path.basename(entry.file))
    if (exists(siteFile) && sha256(siteFile) !== entry.sha256) errors.push(`prototype/site/${path.basename(entry.file)}: hash differs from copied source`)
  }
  if (checkMirror) {
    const candidates = [
      path.resolve(root, entry.referencePath),
      path.resolve(root, 'research/r0', entry.referencePath),
      path.resolve(root, 'research/r0/analysis', path.basename(entry.referencePath)),
    ]
    const mirror = candidates.find(exists)
    if (!mirror) warnings.push(`reference mirror not found for ${entry.file} (gitignored; skipped)`)
    else if (sha256(mirror) !== entry.sha256) errors.push(`reference mirror differs for ${entry.file}: ${mirror}`)
    else notes.push(`mirror verified: ${entry.file}`)
  }
}

const fidelity = exists(fidelityPath) ? JSON.parse(fs.readFileSync(fidelityPath, 'utf8')) : null
if (!fidelity) errors.push(`fidelity manifest not found: ${fidelityPath}`)
else if (!sourceOnly) {
  const indexFile = path.join(siteDir, 'index.html')
  const html = exists(indexFile) ? fs.readFileSync(indexFile, 'utf8') : ''
  const combinedCss = [html]
    .concat(fs.readdirSync(siteDir).filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(path.join(siteDir, f), 'utf8')))
    .join('\n')
  for (const marker of fidelity.shell?.requiredCss || []) {
    if (!combinedCss.includes(marker)) errors.push(`site source missing required marker: ${marker}`)
  }
  for (const [name, anim] of Object.entries(fidelity.animations || {})) {
    if (anim.kind === 'animated-png' && anim.asset) {
      const asset = path.join(siteDir, anim.asset)
      if (!exists(asset)) errors.push(`${name}: missing asset ${anim.asset}`)
      else {
        const frames = apngFrames(asset)
        if (frames < (anim.minFrames || 2)) errors.push(`${name}: ${anim.asset} has ${frames} frame(s), expected >= ${anim.minFrames || 2}`)
        else notes.push(`${name}: animated PNG ${frames} frames`)
      }
    }
  }
}

if (url) {
  const chrome = resolveChrome()
  if (!chrome) {
    errors.push('Chromium not found for DOM fidelity check')
  } else if (fidelity) {
    const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'] })
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    const page = await context.newPage()
    const consoleErrors = []
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) consoleErrors.push(m.text()) })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
    await page.waitForTimeout(900)
    const viewport = fidelity.viewports?.['desktop-1440x900']
    if (viewport?.stage) {
      const box = await page.locator('#slide').boundingBox().catch(() => null)
      if (!box) errors.push('DOM: #slide not found')
      else {
        if (Math.round(box.width) !== viewport.stage.width) errors.push(`DOM: stage width ${Math.round(box.width)} != ${viewport.stage.width}`)
        if (Math.round(box.height) !== viewport.stage.height) errors.push(`DOM: stage height ${Math.round(box.height)} != ${viewport.stage.height}`)
        else notes.push(`DOM: stage ${Math.round(box.width)}x${Math.round(box.height)}`)
      }
    }
    for (const selector of fidelity.shell?.selectors || []) {
      if (!(await page.locator(selector).count())) errors.push(`DOM: missing shell selector ${selector}`)
    }
    const types = await page.evaluate(() => window.COURSEWARE_DEBUG?.types?.() || [])
    for (const [name, spec] of Object.entries(fidelity.components || {})) {
      // Generated entries are design vocabulary, not copied reference DOM.
      // Comparing them to a harness fixture would be self-referential.
      if (spec.kind === 'generated') {
        notes.push(`DOM: ${name} is generated; reference fidelity not applicable`)
        continue
      }
      const sourceTypes = spec.sourceTypes || []
      if (!sourceTypes.length) continue
      const candidates = types.map((t, i) => sourceTypes.includes(t) ? i : -1).filter((i) => i >= 0)
      if (!candidates.length) { warnings.push(`DOM: no slide of type ${sourceTypes.join('/')} in deck for ${name}; skipped`); continue }
      const variants = spec.variants || [{ selectors: spec.selectors || [] }]
      let passed = null, best = null
      for (const index of candidates) {
        await page.evaluate((i) => window.COURSEWARE_DEBUG?.go?.(i), index)
        await page.waitForTimeout(400)
        for (const variant of variants) {
          const missing = []
          for (const selector of variant.selectors || []) {
            if (!(await page.locator(selector).count())) missing.push(selector)
          }
          if (!missing.length) { passed = { index, variant }; break }
          if (!best || missing.length < best.missing.length) best = { index, missing }
        }
        if (passed) break
      }
      if (passed) notes.push(`DOM: ${name} checked on slide ${passed.index + 1}`)
      else errors.push(`DOM: ${name} missing ${best?.missing.join(', ') || 'selectors'} (tried slides ${candidates.map((i) => i + 1).join(',')})`)
    }
    const animation = await page.evaluate(() => {
      const robot = document.querySelector('.cover-robot')
      return robot ? { animationName: getComputedStyle(robot).animationName } : null
    }).catch(() => null)
    if (animation) notes.push(`DOM: cover-robot animationName=${animation.animationName}`)
    for (const message of consoleErrors) errors.push(`console: ${message}`)
    await browser.close()
  }
}

const report = { ok: errors.length === 0, errors, warnings, notes }
if (jsonOut) console.log(JSON.stringify(report, null, 2))
else {
  for (const n of notes) console.log(`note: ${n}`)
  for (const w of warnings) console.log(`warn: ${w}`)
  for (const e of errors) console.log(`ERROR: ${e}`)
  console.log(`${report.ok ? 'OK' : 'FAIL'} source fidelity${url ? ' (with DOM)' : ''}`)
}
process.exit(report.ok ? 0 : 1)
