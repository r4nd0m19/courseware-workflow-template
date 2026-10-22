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
import { ensurePreviewServer, fileUrl, openUrl, writeShellPreview } from './preview-lib.mjs'
import { playerUrlFor, writePlayerPage } from './player-page-lib.mjs'
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
const reviewOut = opt('--review-out')
const reportOut = opt('--report-out')
const servePreview = flag('--serve-preview')
const openPreview = flag('--open-preview')
const previewPort = Number(opt('--preview-port', '8083')) || 8083
const previewState = opt('--preview-state', path.join('review', 'shell-preview.json'))
// The shell's own site ships a preview deck whose job is to exercise every
// declared native slide type. A production site is expected to cover only the
// types its lesson uses, so the full-coverage requirement applies by default
// only when checking the package itself.
const requireFullPreview = flag('--require-full-preview') || (!siteOverride && !urlArg)
const report = {
  shell: shellDir,
  site: siteOverride || '',
  ok: false,
  errors: [],
  warnings: [],
  notes: [],
  types: [],
  slides: [],
  interactions: { passed: [], failed: [] },
  preview: {},
  narration: {},
  previewUrl: '',
  playerUrl: '',
  reviewFile: '',
  shotsDir: '',
}

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
const siteDir = siteOverride ? path.resolve(siteOverride) : path.join(shellDir, 'site')
if (!url) {
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
// Record which media file the shell actually asks the browser to play. The
// audio element is created in a closure and is not attached to the DOM, so
// instrumenting play() is the least invasive way to verify the voice switch.
await page.addInitScript(() => {
  window.__coursewareMedia = []
  const originalPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) {
    window.__coursewareMedia.push({ src: this.currentSrc || this.src, at: Date.now() })
    return originalPlay.apply(this, args)
  }
})
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
  deckSlides: window.COURSEWARE_SHELL_DATA?.slides || [],
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
if (unexercised.length) {
  const message = `declared but not exercised by the preview deck: ${unexercised.join(', ')}`
  if (requireFullPreview) report.errors.push(`preview deck does not exercise every declared slide type: ${unexercised.join(', ')}`)
  else report.warnings.push(message)
}

if (requireFullPreview) {
  const previewSlides = snapshot.deckSlides || []
  const previewMeta = snapshot.meta?.preview || {}
  report.preview = {
    dummy: previewMeta.dummy === true,
    contentLabel: previewMeta.contentLabel || '',
    voiceLabel: previewMeta.voiceLabel || '',
    markedSlides: previewSlides.filter((slide) => String(slide.title || '').includes('占位')).length,
    totalSlides: previewSlides.length,
  }
  if (!report.preview.dummy) report.errors.push('preview deck is not marked as dummy content (meta.preview.dummy)')
  const unmarked = previewSlides
    .map((slide, index) => ({ slide, index }))
    .filter(({ slide }) => !String(slide.title || '').includes('占位'))
  if (unmarked.length) {
    report.errors.push(
      `preview deck has ${unmarked.length} slide(s) without the 占位 marker: ` +
        unmarked.map(({ slide, index }) => `${index + 1}:${slide.title || '(no title)'}`).join(', '),
    )
  }
  await checkPreviewNarration(page, snapshot)
}

if (requireFullPreview) await exercisePreviewInteractions(page, snapshot.deckSlides || [])

// Auto-play must narrate an interactive page and then hold; the learner
// decides when the task is done and clicks 下一页. The preview deck marks its
// hands-on slides with component:true, but a probe should not depend on real
// clip length or pause segments, so this context replaces the probe page's
// narration with a 0.2s stub and uses FakeAudio.
const deckSlides = snapshot.deckSlides || []
const explicitComponentSlides = await page.evaluate(() => (window.COURSEWARE_SHELL_DATA?.slides || []).map((slide, i) => slide.component ? i : -1).filter((i) => i >= 0))
const interactiveTypes = new Set(['rain', 'judgment', 'quiz', 'expr', 'numberLab', 'chainLab', 'tripleLab', 'fill', 'stone', 'checklist'])
const probeIndex = explicitComponentSlides.length
  ? explicitComponentSlides[0]
  : requireFullPreview
    ? deckSlides.findIndex((slide) => interactiveTypes.has(slide.type))
    : -1
if (probeIndex >= 0) {
  const probeContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  await probeContext.addInitScript(() => {
    class FakeAudio {
      constructor() { this.currentTime = 0; this.duration = 0.1; this.readyState = 1; this.onloadedmetadata = null; this.onended = null; this.onerror = null; this._src = '' }
      set src(value) { this._src = value }
      get src() { return this._src }
      load() { setTimeout(() => this.onloadedmetadata?.(), 0) }
      play() { setTimeout(() => this.onended?.(), 40); return Promise.resolve() }
      pause() {}
    }
    window.Audio = FakeAudio
  })
  const probe = await probeContext.newPage()
  await probe.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
  const held = await probe.evaluate(async ({ index, preview }) => {
    // Mutating the object works because lesson.js captured this same object in
    // its `voiceManifest` const. A production manifest is left untouched.
    const manifest = window.COURSEWARE_VOICE_MANIFEST || window.BRANCH_VOICE_MANIFEST
    if (preview && manifest) {
      if (!Array.isArray(manifest.pages)) manifest.pages = []
      const segment = { kind: 'audio', id: 'probe', files: { xiaolai: { src: 'data:audio/wav;base64,UklGRg==', duration: 0.2 } } }
      manifest.pages[index] = { dummy: true, segments: [segment] }
    }
    const slide = window.COURSEWARE_SHELL_DATA?.slides?.[index]
    if (slide) slide.component = true
    window.COURSEWARE_DEBUG.go(index)
    document.querySelector('#autoMode').click()
    await new Promise((resolve) => setTimeout(resolve, 700))
    return {
      index: window.COURSEWARE_DEBUG.index,
      toast: document.querySelector('#toast')?.textContent || '',
    }
  }, { index: probeIndex, preview: requireFullPreview }).catch((error) => ({ error: String(error) }))
  if (held.error) report.errors.push(`auto-play hold: ${held.error}`)
  else {
    if (held.index !== probeIndex) report.errors.push(`auto-play advanced off interactive slide ${probeIndex + 1} to ${held.index + 1}`)
    if (!/下一页/.test(held.toast)) report.errors.push('auto-play hold did not show the continue hint')
    else report.notes.push('auto-play holds on interactive pages and shows the continue hint')
    const advanced = await probe.evaluate(async () => {
      document.querySelector('#next').click()
      await new Promise((resolve) => setTimeout(resolve, 350))
      return window.COURSEWARE_DEBUG.index
    }).catch((error) => ({ error: String(error) }))
    if (advanced.error) report.errors.push(`auto-play continue: ${advanced.error}`)
    else if (advanced <= probeIndex) report.errors.push('auto-play did not continue after 下一页 on an interactive page')
  }
  await probeContext.close()
} else {
  report.notes.push('no interactive slide in this deck; auto-play hold check skipped')
}

if (consoleErrors.length) report.errors.push(...consoleErrors)
report.url = url
report.consoleErrors = consoleErrors
report.slideCount = report.slides.length
report.nativeTypes = [...new Set(report.types)]
report.typeCount = report.nativeTypes.length
await browser.close()
if (server) await server.close()

// Human review needs a URL that survives this process. Start a detached
// server only for a local site; an explicit --url is already someone else's
// live server. If the detached server cannot start, fall back to file:// so
// the review sheet still names the artifact instead of failing the gate.
if (urlArg) {
  report.previewUrl = urlArg
} else if (servePreview) {
  try {
    writePlayerPage(siteDir)
    const preview = await ensurePreviewServer({
      root: siteDir,
      stateFile: path.resolve(previewState),
      preferredPort: previewPort,
    })
    report.previewUrl = preview.url
    report.previewPid = preview.pid
    report.previewReused = preview.reused
    report.previewState = path.resolve(previewState)
    const opener = openPreview ? openUrl(preview.url) : ''
    if (opener) report.openedWith = opener
    report.notes.push(`preview server: ${preview.url}${preview.reused ? ' (reused)' : ''}`)
  } catch (error) {
    report.previewUrl = fileUrl(path.join(siteDir, 'index.html'))
    report.warnings.push(`preview server unavailable (${error.message}); using file URL`)
  }
}
report.playerUrl = report.previewUrl ? playerUrlFor(report.previewUrl) : ''
if (reviewOut) {
  try {
    writeShellPreview({
      file: reviewOut,
      shell,
      shellDir,
      report,
      previewUrl: report.previewUrl || report.url,
      playerUrl: report.playerUrl,
      shotsDir,
    })
    report.reviewFile = path.resolve(reviewOut)
    report.shotsDir = shotsDir ? path.resolve(shotsDir) : ''
  } catch (error) {
    report.errors.push(`review sheet: ${error.message}`)
  }
}
finish()

async function checkPreviewNarration(page, snapshot) {
  const info = await page.evaluate(() => {
    const manifest = window.COURSEWARE_VOICE_MANIFEST || window.BRANCH_VOICE_MANIFEST
    const plan = window.COURSEWARE_NARRATION_PLAN || window.BRANCH_NARRATION_PLAN
    const slides = window.COURSEWARE_SHELL_DATA?.slides || []
    const voiceIds = (manifest?.voices || []).map((voice) => voice.id)
    const pages = (manifest?.pages || []).map((page, index) => ({
      index,
      dummy: page?.dummy === true,
      title: page?.title || '',
      segments: (page?.segments || []).map((segment) => ({
        kind: segment.kind,
        id: segment.id,
        text: segment.text || '',
        seconds: Number(segment.seconds) || 0,
        files: segment.files || {},
      })),
    }))
    const planPages = (plan?.pages || []).map((page) => ({
      dummy: page?.dummy === true,
      title: page?.title || '',
      segments: (page?.segments || []).map((segment) => ({
        kind: segment.kind,
        id: segment.id,
        text: segment.text || '',
        seconds: Number(segment.seconds) || 0,
      })),
    }))
    return {
      manifestDummy: manifest?.dummy === true,
      planDummy: plan?.dummy === true,
      label: manifest?.label || plan?.label || '',
      voiceIds,
      pages,
      planPages,
      slideCount: slides.length,
    }
  })

  report.narration = {
    dummy: info.manifestDummy && info.planDummy,
    label: info.label,
    voiceCount: info.voiceIds.length,
    pageCount: info.pages.length,
    clipCount: 0,
    decodedClips: 0,
    playedVoices: [],
  }
  if (!info.manifestDummy) report.errors.push('voice manifest is not marked dummy')
  if (!info.planDummy) report.errors.push('narration plan is not marked dummy')
  if (info.voiceIds.length < 2) report.errors.push(`preview voice manifest has ${info.voiceIds.length} voice(s); at least 2 are needed to test switching`)
  if (info.pages.length !== info.slideCount) report.errors.push(`voice manifest has ${info.pages.length} page(s) for ${info.slideCount} slide(s)`)
  if (info.planPages.length !== info.slideCount) report.errors.push(`narration plan has ${info.planPages.length} page(s) for ${info.slideCount} slide(s)`)

  const uniqueClips = new Map()
  for (const page of info.pages) {
    if (!page.dummy) report.errors.push(`narration page ${page.index + 1} is not marked dummy`)
    if (!page.title) report.errors.push(`narration page ${page.index + 1} has no title`)
    if (!page.segments.length) {
      report.errors.push(`narration page ${page.index + 1} has no segments`)
      continue
    }
    const audioSegments = page.segments.filter((segment) => segment.kind === 'audio')
    if (!audioSegments.length) report.errors.push(`narration page ${page.index + 1} has no audio segment`)
    for (const segment of audioSegments) {
      if (!String(segment.text || '').includes('占位')) report.errors.push(`narration page ${page.index + 1} segment ${segment.id} text is not marked 占位`)
      for (const voiceId of info.voiceIds) {
        const file = segment.files?.[voiceId]
        if (!file?.src) {
          report.errors.push(`narration page ${page.index + 1} voice ${voiceId}: missing audio src`)
          continue
        }
        if (!(Number(file.duration) > 0)) {
          report.errors.push(`narration page ${page.index + 1} voice ${voiceId}: invalid duration`)
          continue
        }
        if (!file.src.startsWith('preview-audio/')) report.errors.push(`narration page ${page.index + 1} voice ${voiceId}: audio is not from preview-audio/ (${file.src})`)
        if (!uniqueClips.has(file.src)) uniqueClips.set(file.src, { src: file.src, duration: Number(file.duration) })
      }
    }
    const planPage = info.planPages[page.index]
    if (!planPage) continue
    const planIds = planPage.segments.map((segment) => `${segment.kind}:${segment.id}`).join('|')
    const manifestIds = page.segments.map((segment) => `${segment.kind}:${segment.id}`).join('|')
    if (planIds !== manifestIds) report.errors.push(`narration plan page ${page.index + 1} segments differ from the voice manifest`)
  }
  report.narration.clipCount = uniqueClips.size
  if (!uniqueClips.size) return

  const clips = [...uniqueClips.values()]
  const decoded = await page.evaluate(async (items) => {
    const results = []
    for (const clip of items) {
      const response = await fetch(clip.src)
      if (!response.ok) {
        results.push({ ...clip, error: `HTTP ${response.status}` })
        continue
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio()
      const duration = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(0), 8000)
        audio.onloadedmetadata = () => { clearTimeout(timer); resolve(audio.duration) }
        audio.onerror = () => { clearTimeout(timer); resolve(0) }
        audio.src = url
      })
      URL.revokeObjectURL(url)
      results.push({
        ...clip,
        bytes: blob.size,
        contentType: response.headers.get('content-type') || '',
        actualDuration: Number.isFinite(duration) ? duration : 0,
      })
    }
    return results
  }, clips).catch((error) => [{ error: String(error) }])
  for (const clip of decoded) {
    if (clip.error) {
      report.errors.push(`preview audio ${clip.src || '?'}: ${clip.error}`)
      continue
    }
    if (clip.bytes < 1024) report.errors.push(`preview audio ${clip.src}: too small (${clip.bytes} bytes)`)
    if (!/^audio\//.test(clip.contentType)) report.errors.push(`preview audio ${clip.src}: content-type is ${clip.contentType}`)
    if (!(clip.actualDuration > 0)) {
      report.errors.push(`preview audio ${clip.src}: browser could not decode it`)
      continue
    }
    if (Math.abs(clip.actualDuration - clip.duration) > 0.3) {
      report.errors.push(`preview audio ${clip.src}: manifest duration ${clip.duration}s != decoded ${clip.actualDuration.toFixed(2)}s`)
    }
    report.narration.decodedClips += 1
  }
  if (!report.errors.some((error) => /preview audio/.test(error))) {
    report.notes.push(`dummy preview voice decoded: ${report.narration.decodedClips} clip(s) across ${info.voiceIds.length} voices`)
  }

  const played = []
  const probeVoices = [info.voiceIds[0], info.voiceIds[2] || info.voiceIds[1]].filter((voice, index, all) => all.indexOf(voice) === index)
  for (const voiceId of probeVoices) {
    await page.evaluate((voice) => {
      window.COURSEWARE_DEBUG.go(0)
      window.__coursewareMedia = []
      const select = document.querySelector('#voiceSelect')
      select.value = voice
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }, voiceId)
    await page.click('#sound')
    const started = await page.waitForFunction(
      (voice) => (window.__coursewareMedia || []).some((entry) => new RegExp(`preview-audio/.*${voice}\\.mp3`).test(entry.src)),
      voiceId,
      { timeout: 10000 },
    ).then(() => true).catch(() => false)
    const state = await page.evaluate(() => ({
      speaking: document.querySelector('#sound')?.classList.contains('speaking') || false,
      toast: document.querySelector('#toast')?.textContent || '',
    }))
    if (!started) report.errors.push(`preview voice ${voiceId}: shell did not play the matching dummy clip`)
    else played.push(voiceId)
    if (!state.speaking) report.errors.push(`preview voice ${voiceId}: player did not enter the playing state`)
    if (/失败/.test(state.toast)) report.errors.push(`preview voice ${voiceId}: ${state.toast}`)
    await page.click('#sound').catch(() => {})
  }
  report.narration.playedVoices = played
  if (played.length) report.notes.push(`dummy preview voice played: ${played.join(', ')}`)
}

async function exercisePreviewInteractions(page, slides) {
  const passed = []
  const record = (name, ok, detail = '') => {
    if (ok) passed.push(name)
    else {
      report.errors.push(`preview interaction ${name}: ${detail || 'failed'}`)
      report.interactions.failed.push(`${name}: ${detail || 'failed'}`)
    }
  }
  const find = (type) => slides.findIndex((slide) => slide.type === type)
  const go = (index) => page.evaluate((i) => window.COURSEWARE_DEBUG.go(i), index)

  async function run(name, type, slide, fn) {
    const index = typeof type === 'number' ? type : find(type)
    if (index < 0) return
    await go(index)
    try {
      const result = await fn(slide ?? slides[index], index)
      record(name, result.ok, result.detail)
    } catch (error) {
      record(name, false, String(error))
    }
  }

  await run('rain', 'rain', null, async () => {
    const result = await page.evaluate(() => {
      document.querySelector('[data-rain="1"]')?.click()
      return {
        label: document.querySelector('[data-rain-label]')?.textContent || '',
        umbrella: document.querySelector('[data-umbrella]')?.textContent || '',
        feedback: document.querySelector('[data-feedback]')?.textContent || '',
      }
    })
    return { ok: /是/.test(result.label) && /带伞/.test(result.umbrella) && result.feedback.length > 0, detail: JSON.stringify(result) }
  })

  await run('judgment', 'judgment', null, async (slide) => {
    const result = await page.evaluate((items) => {
      items.forEach((item, i) => {
        document.querySelector(`[data-judgment-item="${i}"]`)?.click()
        document.querySelector(item[1] ? '[data-judgment-basket="correct"]' : '[data-judgment-basket="wrong"]')?.click()
      })
      document.querySelector('[data-check-judgment]')?.click()
      return {
        feedback: document.querySelector('[data-judgment-feedback]')?.textContent || '',
        counts: [...document.querySelectorAll('[data-judgment-count]')].map((node) => node.textContent),
      }
    }, slide.items)
    return { ok: /全部正确/.test(result.feedback) && result.counts.reduce((sum, n) => sum + Number(n), 0) === slide.items.length, detail: JSON.stringify(result) }
  })

  for (const [i, slide] of slides.entries()) {
    if (slide.type !== 'quiz' || !Number.isInteger(slide.answer)) continue
    await run(`quiz#${i + 1}`, i, slide, async () => {
      const result = await page.evaluate((answer) => {
        document.querySelector(`[data-choice="${answer}"]`)?.click()
        return {
          feedback: document.querySelector('[data-feedback]')?.textContent || '',
          selected: document.querySelector('.choice.selected')?.dataset.choice || '',
          codeGrid: Boolean(document.querySelector('.code-grid')),
        }
      }, slide.answer)
      return {
        ok: /回答正确/.test(result.feedback) && Number(result.selected) === slide.answer && (!slide.code || result.codeGrid),
        detail: JSON.stringify(result),
      }
    })
  }

  await run('expr', 'expr', null, async (slide) => {
    const expected = slide.cases?.[0]?.[1]
    const result = await page.evaluate((value) => {
      document.querySelector('[data-expr]').value = '0'
      document.querySelector('[data-predict]').value = value
      document.querySelector('[data-run-expr]')?.click()
      return {
        output: document.querySelector('[data-output]')?.textContent || '',
        feedback: document.querySelector('[data-feedback]')?.textContent || '',
      }
    }, expected)
    return { ok: result.output.includes(`输出：${expected}`) && /预测正确/.test(result.feedback), detail: JSON.stringify(result) }
  })

  for (const [i, slide] of slides.entries()) {
    if (slide.type !== 'numberLab') continue
    if (slide.kind === 'cute') {
      await run(`numberLab:cute#${i + 1}`, i, slide, async () => {
        const result = await page.evaluate(() => {
          document.querySelector('[data-number]').value = '48'
          const button = document.querySelector('[data-run-cute]')
          for (let step = 0; step < 3; step += 1) button?.click()
          return {
            feedback: document.querySelector('[data-feedback]')?.textContent || '',
            steps: [...document.querySelectorAll('[data-cute-step]')].map((node) => node.textContent),
          }
        })
        return { ok: /可爱数/.test(result.feedback) && result.steps.every((step) => step.length > 0), detail: JSON.stringify(result) }
      })
      continue
    }
    const sample = { 'odd-single': [9, '输出：odd'], 'odd-double': [6, '输出：even'], ticket: [30, '单价：48 元'] }[slide.kind]
    if (!sample) continue
    await run(`numberLab:${slide.kind}#${i + 1}`, i, slide, async () => {
      const result = await page.evaluate(([value, expected]) => {
        document.querySelector('[data-number]').value = String(value)
        document.querySelector('[data-run-number]')?.click()
        return { output: document.querySelector('[data-output]')?.textContent || '', feedback: document.querySelector('[data-feedback]')?.textContent || '', expected }
      }, sample)
      return { ok: result.output.includes(sample[1]), detail: JSON.stringify(result) }
    })
  }

  await run('chainLab', 'chainLab', null, async () => {
    const result = await page.evaluate(() => {
      document.querySelector('[data-run-chain]')?.click()
      return {
        output: document.querySelector('[data-output]')?.textContent || '',
        warning: document.querySelector('[data-chain-warning]')?.classList.contains('visible') || false,
      }
    })
    return { ok: result.warning && /正确逻辑/.test(result.output), detail: JSON.stringify(result) }
  })

  await run('tripleLab', 'tripleLab', null, async () => {
    const result = await page.evaluate(() => {
      const button = document.querySelector('[data-run-triple]')
      for (let step = 0; step < 3; step += 1) button?.click()
      return [...document.querySelectorAll('[data-step]')].map((node) => node.textContent)
    })
    return { ok: result.length === 3 && /输出 YES/.test(result[2]), detail: JSON.stringify(result) }
  })

  await run('fill', 'fill', null, async (slide) => {
    const result = await page.evaluate((answers) => {
      answers.forEach((value, i) => { document.querySelector(`[data-fill="${i}"]`).value = value })
      document.querySelector('[data-check-fill]')?.click()
      return document.querySelector('[data-feedback]')?.textContent || ''
    }, slide.answers)
    return { ok: /全部正确/.test(result), detail: result }
  })

  await run('stone', 'stone', null, async () => {
    const result = await page.evaluate(() => {
      document.querySelector('[data-stone-move]')?.click()
      const afterMove = document.querySelector('[data-stone-log]')?.textContent || ''
      document.querySelector('[data-stone-reply]')?.click()
      return { afterMove, log: document.querySelector('[data-stone-log]')?.textContent || '' }
    })
    return { ok: /Bill/.test(result.afterMove) && /Will/.test(result.log), detail: JSON.stringify(result) }
  })

  await run('checklist', 'checklist', null, async (slide) => {
    const result = await page.evaluate(() => {
      document.querySelectorAll('[data-check]').forEach((box) => { if (!box.checked) box.click() })
      return document.querySelector('[data-check-count]')?.textContent || ''
    })
    return { ok: result.includes(`已点亮 ${slide.items.length} / ${slide.items.length} 项`), detail: result }
  })

  // Renderer variants: the preview deck carries more than one slide for these
  // types, so each layout branch is exercised, not just the type name.
  for (const [i, slide] of slides.entries()) {
    if (slide.type === 'cards') {
      await run(`cards#${i + 1}`, i, slide, async () => {
        const result = await page.evaluate(() => ({
          count: document.querySelectorAll('.slide-inner > div.cards .card').length,
          two: document.querySelector('.slide-inner > div.cards')?.classList.contains('two') || false,
          source: Boolean(document.querySelector('.source-copy')),
          compactCode: Boolean(document.querySelector('.compact-source-code')),
        }))
        return {
          ok: result.count === slide.cards.length && result.two === (slide.cards.length === 2) && (!slide.sourceText || result.source) && (!slide.code || result.compactCode),
          detail: JSON.stringify(result),
        }
      })
    }
    if (slide.type === 'code') {
      await run(`code:${slide.flowType || 'flow'}#${i + 1}`, i, slide, async () => {
        const result = await page.evaluate(() => ({
          flow: Boolean(document.querySelector('.flow')),
          single: Boolean(document.querySelector('.branch-diagram')),
          nested: Boolean(document.querySelector('.nested-diagram')),
        }))
        const expected = slide.flowType === 'nested' ? result.nested : slide.flowType === 'single' ? result.single : result.flow
        return { ok: expected, detail: JSON.stringify(result) }
      })
    }
    if (slide.type === 'chapter' && String(slide.topics || '').startsWith('1. ')) {
      await run(`chapter:topics#${i + 1}`, i, slide, async () => {
        const count = await page.evaluate(() => document.querySelectorAll('.chapter-topics li').length)
        return { ok: count === String(slide.topics).split('　').length, detail: `${count} items` }
      })
    }
  }

  await run('hero', 'hero', null, async (slide) => {
    const result = await page.evaluate(() => ({
      topics: document.querySelectorAll('.topic-strip span').length,
      monitor: Boolean(document.querySelector('.cover-monitor')),
    }))
    return { ok: result.topics === slide.topics.length && result.monitor, detail: JSON.stringify(result) }
  })
  await run('end', 'end', null, async () => {
    const result = await page.evaluate(() => ({ recap: document.querySelectorAll('.recap span').length, monitor: Boolean(document.querySelector('.cover-monitor')) }))
    return { ok: result.recap > 0 && result.monitor, detail: JSON.stringify(result) }
  })
  await run('table', 'table', null, async (slide) => {
    const result = await page.evaluate(() => ({
      headers: document.querySelectorAll('thead th').length,
      rows: document.querySelectorAll('tbody tr').length,
      note: Boolean(document.querySelector('.callout')),
    }))
    return { ok: result.headers === slide.headers.length && result.rows === slide.rows.length && result.note, detail: JSON.stringify(result) }
  })
  await run('compare', 'compare', null, async () => {
    const count = await page.evaluate(() => document.querySelectorAll('.comparison section').length)
    return { ok: count === 2, detail: `${count} sections` }
  })
  await run('numberline', 'numberline', null, async () => {
    const ok = await page.evaluate(() => Boolean(document.querySelector('.number-line .range-highlight')))
    return { ok, detail: 'range highlight missing' }
  })
  await run('stoneIntro', 'stoneIntro', null, async () => {
    const count = await page.evaluate(() => document.querySelectorAll('.stone-rules > div').length)
    return { ok: count === 3, detail: `${count} rules` }
  })
  await run('stoneSummary', 'stoneSummary', null, async () => {
    const count = await page.evaluate(() => document.querySelectorAll('.stone-summary section').length)
    return { ok: count === 2, detail: `${count} sections` }
  })

  if (passed.length) report.notes.push(`preview interactions exercised: ${passed.join(', ')}`)
  report.interactions.passed = passed
}

function finish() {
  report.ok = report.errors.length === 0
  if (reportOut) {
    try {
      fs.mkdirSync(path.dirname(path.resolve(reportOut)), { recursive: true })
      fs.writeFileSync(path.resolve(reportOut), `${JSON.stringify(report, null, 2)}\n`)
    } catch (error) {
      report.errors.push(`report file: ${error.message}`)
      report.ok = false
    }
  }
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
