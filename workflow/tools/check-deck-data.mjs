#!/usr/bin/env node
// Deck-data gate: the runtime deck must be generated from the approved
// storyboard as declarative slide data. This checks order/ids/titles, renderer
// types, forbidden raw-HTML hooks, and that narration resolves to real clips.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChrome } from './chrome.mjs'
import { readData } from './lib.mjs'
import { assertScriptApproved, DEFAULT_SCRIPT_APPROVAL } from './approval-lib.mjs'
import { readSectionManifest, sectionById, validateSectionManifest } from './section-lib.mjs'
import { resolveShellDir } from './shell-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
function flag(name) { return args.includes(name) }
const url = opt('--url')
const storyboardPath = opt('--storyboard')
const sectionsPath = opt('--sections')
const sectionId = opt('--section')
const fidelityPath = opt('--fidelity', 'style-pack/source/fidelity.json')
const registryPath = opt('--registry', 'registry/index.json')
const stagingArg = opt('--staging')
const shellArg = opt('--shell')
const scriptPath = opt('--script')
const approvalPath = opt('--approval', DEFAULT_SCRIPT_APPROVAL)
const jsonOut = flag('--json')
const errors = []
const warnings = []
const notes = []

if (!url || !storyboardPath) {
  console.error(`usage: node check-deck-data.mjs --url <deck-url> --storyboard <storyboard.yml>
  [--sections <review-sections.yml> --section <id>] [--fidelity style-pack/source/fidelity.json]
  [--registry registry/index.json] [--staging registry/staging] [--shell <shell-id-or-dir>] [--json]
  [--script <courseware.md> --approval review/script-approval.json]`)
  process.exit(2)
}

if (scriptPath) {
  try {
    assertScriptApproved(scriptPath, { approvalPath })
  } catch (error) {
    console.error(`FAIL deck data — ${error.message}`)
    process.exit(1)
  }
}

let shell = null
if (shellArg) {
  try {
    shell = JSON.parse(fs.readFileSync(path.join(resolveShellDir(shellArg), 'shell.json'), 'utf8'))
  } catch (error) {
    console.error(`FAIL shell: ${error.message}`)
    process.exit(2)
  }
  notes.push(`shell: ${shell.id}@${shell.version} (${shell.dataContract.slideTypes.length} native slide types)`)
}

const storyboard = readData(storyboardPath)
const nonSkip = (storyboard.slides || []).filter((s) => s.status !== 'SKIP')
let expected = nonSkip
if (sectionsPath || sectionId) {
  if (!sectionsPath || !sectionId) {
    console.error('FAIL --sections and --section must be provided together')
    process.exit(2)
  }
  const manifest = readSectionManifest(sectionsPath)
  const problems = validateSectionManifest(manifest, storyboard.slides, { requireAll: true })
  if (problems.length) {
    console.error(`FAIL review sections\n${problems.map((p) => `  ${p}`).join('\n')}`)
    process.exit(1)
  }
  const section = sectionById(manifest, sectionId)
  if (!section) {
    console.error(`FAIL section ${sectionId} is not declared in ${sectionsPath}`)
    process.exit(1)
  }
  const byId = new Map(storyboard.slides.map((s) => [s.id, s]))
  expected = section.slides.map((id) => byId.get(id))
  const notApproved = expected.filter((s) => s.status !== 'APPROVED')
  if (notApproved.length) {
    console.error(`FAIL section ${sectionId} has non-APPROVED slide(s): ${notApproved.map((s) => s.id).join(', ')}`)
    process.exit(1)
  }
}

const allowedTypes = new Set()
const generatedTypes = new Set()
const shellTypes = new Set(shell?.dataContract?.slideTypes || [])
const fidelityFile = path.resolve(fidelityPath)
if (!shell && fs.existsSync(fidelityFile)) {
  const fidelity = JSON.parse(fs.readFileSync(fidelityFile, 'utf8'))
  for (const spec of Object.values(fidelity.components || {})) {
    for (const type of spec.sourceTypes || []) {
      // `kind: generated` entries describe a design pattern, not an
      // implemented renderer. Only a core registry entry makes the type usable.
      if (spec.kind === 'generated') generatedTypes.add(type)
      else allowedTypes.add(type)
    }
  }
} else if (!shell) warnings.push(`fidelity manifest not found: ${fidelityPath}`)
const coreComponents = new Set()
const stagedComponents = new Set()
const registryFile = path.resolve(registryPath)
if (fs.existsSync(registryFile)) {
  const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'))
  for (const entry of registry.components || []) {
    if (entry.status === 'core') { allowedTypes.add(entry.id); coreComponents.add(entry.id) }
  }
}
// The current page may be rendered with components still in staging; they are
// bundled for review and registered only after the page gate approves them.
if (stagingArg) {
  const stagingDir = path.resolve(stagingArg)
  if (fs.existsSync(stagingDir)) {
    for (const dirent of fs.readdirSync(stagingDir, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue
      const manifestFile = path.join(stagingDir, dirent.name, 'component.json')
      if (!fs.existsSync(manifestFile)) continue
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
      if (manifest.status === 'core') {
        allowedTypes.add(manifest.id)
        stagedComponents.add(manifest.id)
        notes.push(`staged component: ${manifest.id}@${manifest.version}`)
      }
    }
  }
}

const forbiddenKeys = /^(html|rawHtml|innerHTML|style|className|on[A-Z].*)$/
function inspectData(value, where) {
  if (Array.isArray(value)) { value.forEach((v, i) => inspectData(v, `${where}[${i}]`)); return }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && /<script\b|javascript:/i.test(value)) errors.push(`${where}: forbidden executable markup`)
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.test(key)) errors.push(`${where}: forbidden deck-data field "${key}" (renderer/CSS must come from the style pack)`)
    inspectData(child, `${where}.${key}`)
  }
}

const chrome = resolveChrome()
if (!chrome) {
  console.error('FAIL Chromium not found. Set CHROME_PATH or install Playwright Chromium.')
  process.exit(2)
}
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push(String(e)))
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
await page.waitForTimeout(700)
const snapshot = await page.evaluate(() => {
  const shellData = window.COURSEWARE_SHELL_DATA || null
  return {
    meta: window.COURSEWARE_META || shellData?.meta || null,
    slides: Array.isArray(window.COURSEWARE_SLIDES)
      ? window.COURSEWARE_SLIDES
      : (Array.isArray(shellData?.slides) ? shellData.slides : null),
    narration: window.LESSON_NARRATION || {},
    clips: window.LESSON_VOICE_MANIFEST?.clips || {},
    voices: (window.LESSON_VOICE_MANIFEST?.voices || window.LESSON_AUTOPLAY_CONFIG?.voices || []).map((v) => v.id),
    shellPlan: window.COURSEWARE_NARRATION_PLAN || null,
    shellVoice: window.COURSEWARE_VOICE_MANIFEST || null,
    customTypes: window.CoursewareComponents && typeof window.CoursewareComponents.types === 'function'
      ? window.CoursewareComponents.types()
      : [],
  }
}).catch((error) => ({ error: String(error) }))
await browser.close()

const voiceIds = shell
  ? (snapshot.shellVoice?.voices || []).map((voice) => voice.id)
  : (snapshot.voices || [])
if (shell && !voiceIds.length) errors.push('COURSEWARE_VOICE_MANIFEST.voices is empty or missing')

if (snapshot.error) errors.push(`runtime: ${snapshot.error}`)
if (!snapshot.meta?.title) errors.push('COURSEWARE_META.title is missing')
if (!Array.isArray(snapshot.slides)) errors.push('COURSEWARE_SLIDES is missing or not an array')
if (Array.isArray(snapshot.slides)) {
  inspectData(snapshot.slides, 'COURSEWARE_SLIDES')
  snapshot.slides.forEach((s, i) => { if (!s?.id) errors.push(`deck slide #${i + 1}: missing id`) })
  const ids = snapshot.slides.map((s) => s?.id).filter(Boolean)
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (duplicates.length) errors.push(`duplicate deck slide id(s): ${[...new Set(duplicates)].join(', ')}`)
  const byId = new Map(snapshot.slides.map((s) => [s?.id, s]))
  let cursor = -1
  for (const want of expected) {
    const got = byId.get(want.id)
    if (!got) { errors.push(`missing deck slide ${want.id} (${want.title})`); continue }
    const index = snapshot.slides.indexOf(got)
    if (index <= cursor) errors.push(`deck order: ${want.id} appears before the previous storyboard slide`)
    cursor = index
    if (String(got.title || '').trim() !== String(want.title || '').trim()) errors.push(`${want.id}: title "${got.title}" != storyboard "${want.title}"`)
    if (!got.type) errors.push(`${want.id}: missing renderer type`)
    else if (shell) {
      if (!shellTypes.has(got.type)) errors.push(`${want.id}: type "${got.type}" is not declared by shell ${shell.id}`)
      if (got.component) {
        if (got.type !== 'blank') errors.push(`${want.id}: component slides must use type "blank" (got "${got.type}")`)
        if (!coreComponents.has(got.component) && !stagedComponents.has(got.component)) errors.push(`${want.id}: component "${got.component}" is not a core registry component`)
        if (!(snapshot.customTypes || []).includes(got.component)) {
          errors.push(`${want.id}: component "${got.component}" is not registered at runtime (sync the bundle)`)
        }
      } else if (coreComponents.has(got.type) || stagedComponents.has(got.type)) {
        errors.push(`${want.id}: component "${got.type}" must be mounted through type "blank" + component, not used as a slide type`)
      }
    } else if (allowedTypes.size && !allowedTypes.has(got.type)) errors.push(`${want.id}: unknown renderer type "${got.type}" (not in fidelity contract or core registry)`)
    if (!shell && got.type && generatedTypes.has(got.type) && !(snapshot.customTypes || []).includes(got.type)) {
      errors.push(`${want.id}: generated component "${got.type}" is not registered at runtime (register it core, then sync the bundle)`)
    }
    if (!shell && got.type && (coreComponents.has(got.type) || stagedComponents.has(got.type)) && !got.id) errors.push(`${want.id}: custom component slide has no id`)
    if (shell) {
      const pageIndex = snapshot.slides.indexOf(got)
      const plan = snapshot.shellPlan?.pages?.[pageIndex]
      const voicePage = snapshot.shellVoice?.pages?.[pageIndex]
      const text = (plan?.segments || []).map((segment) => segment.text || '').join(' ').trim()
      if (!text) errors.push(`${want.id}: narration plan page ${pageIndex + 1} is empty`)
      if (!voicePage) errors.push(`${want.id}: voice manifest page ${pageIndex + 1} is missing`)
      else {
        const audioSegments = (voicePage.segments || []).filter((segment) => segment.kind === 'audio')
        if (!audioSegments.length) errors.push(`${want.id}: voice manifest has no audio segment`)
        for (const segment of audioSegments) {
          for (const voice of voiceIds) {
            const file = segment.files?.[voice]
            if (!file?.src) errors.push(`${want.id}: narration missing voice clip "${voice}"`)
            else if (!(Number(file.duration) > 0)) errors.push(`${want.id}/${voice}: audio duration is 0`)
          }
        }
      }
    } else {
      const narration = got.narration || snapshot.narration[got.id] || snapshot.narration[got.title]
      if (!narration || !String(narration).trim()) {
        errors.push(`${want.id}: narration does not resolve (deck data / LESSON_NARRATION)`)
        continue
      }
      const clip = snapshot.clips[narration]
      if (!clip) errors.push(`${want.id}: narration text has no voice clips`)
      else {
        for (const voice of voiceIds) {
          if (!clip[voice]) errors.push(`${want.id}: narration missing voice clip "${voice}"`)
        }
      }
    }
  }
  if (!sectionId && snapshot.slides.length !== nonSkip.length) {
    errors.push(`deck has ${snapshot.slides.length} slide(s); storyboard has ${nonSkip.length} non-SKIP slide(s)`)
  }
  if (shell) {
    const planPages = snapshot.shellPlan?.pages || []
    const voicePages = snapshot.shellVoice?.pages || []
    if (planPages.length !== snapshot.slides.length) {
      errors.push(`COURSEWARE_NARRATION_PLAN has ${planPages.length} page(s); deck has ${snapshot.slides.length}`)
    }
    if (voicePages.length !== snapshot.slides.length) {
      errors.push(`COURSEWARE_VOICE_MANIFEST has ${voicePages.length} page(s); deck has ${snapshot.slides.length}`)
    }
    const requiredVoices = ['xiaozhi', 'xiaochuang', 'xiaowei', 'xiaolai']
    const missingVoices = requiredVoices.filter((voice) => !voiceIds.includes(voice))
    if (missingVoices.length) errors.push(`voice manifest missing required voice(s): ${missingVoices.join(', ')}`)
  }
  notes.push(`runtime: ${snapshot.slides.length} slide(s), ${voiceIds.length} voice(s)${sectionId ? `; checked section ${sectionId}` : ''}`)
}

for (const message of consoleErrors) errors.push(`console: ${message}`)
const report = { ok: errors.length === 0, errors, warnings, notes }
if (jsonOut) console.log(JSON.stringify(report, null, 2))
else {
  for (const n of notes) console.log(`note: ${n}`)
  for (const w of warnings) console.log(`warn: ${w}`)
  for (const e of errors) console.log(`ERROR: ${e}`)
  console.log(`${report.ok ? 'OK' : 'FAIL'} deck data`)
}
process.exit(report.ok ? 0 : 1)
