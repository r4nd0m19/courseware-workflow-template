#!/usr/bin/env node
// Which components does this page need, and which of them are not registered yet?
// Components declared new/extend are built on the first page that uses them,
// bundled from staging for review, and registered after the page is approved.
import fs from 'node:fs'
import path from 'node:path'
import { parseScript } from './script-lib.mjs'
import { assertScriptApproved } from './approval-lib.mjs'
import { readSectionManifest, sectionById } from './section-lib.mjs'
import { readData } from './lib.mjs'
import { relativeReferenceExtract } from './reference-extract-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const scriptPath = opt('--script')
const storyboardPath = opt('--storyboard')
const sectionsPath = opt('--sections')
const sectionId = opt('--section')
const registryPath = opt('--registry', 'registry/index.json')
const stagingDir = opt('--staging', path.join(path.dirname(path.resolve(registryPath)), 'staging'))
const jsonOut = args.includes('--json')
if (!scriptPath || !storyboardPath || !sectionsPath || !sectionId) {
  console.error(
    'usage: node list-section-components.mjs --script <courseware.md> --storyboard <storyboard.yml> ' +
      '--sections <review-sections.yml> --section <id> [--registry registry/index.json] [--staging <dir>] [--json]',
  )
  process.exit(2)
}

try {
  assertScriptApproved(scriptPath)
} catch (error) {
  console.error(`FAIL section components — ${error.message}`)
  process.exit(1)
}

const script = parseScript(scriptPath)
const storyboard = readData(storyboardPath)
const manifest = readSectionManifest(sectionsPath)
const section = sectionById(manifest, sectionId)
if (!section) {
  console.error(`FAIL section ${sectionId} is not declared in ${sectionsPath}`)
  process.exit(2)
}
const bySlide = new Map(storyboard.slides.map((s) => [s.id, s]))
const declared = new Set()
for (const slide of script.slides) {
  for (const item of slide.machine?.componentPlan || []) {
    if (item.status === 'new' || item.status === 'extend') declared.add(item.id)
  }
}

const registered = new Set()
const registryFile = path.resolve(registryPath)
if (fs.existsSync(registryFile)) {
  const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'))
  for (const entry of registry.components || []) {
    if (entry.status === 'core') registered.add(entry.id)
  }
}

// A storyboard's `components` array also lists style-pack/native components
// (table, code-block, cover-hero, ...). Only declared custom components and
// registry components are built and registered here; an unknown id is caught
// by check-vocabulary, not silently treated as a missing component.
const required = new Set()
for (const id of section.slides) {
  const slide = bySlide.get(id)
  if (!slide) {
    console.error(`FAIL storyboard has no slide ${id}`)
    process.exit(2)
  }
  for (const component of slide.components || []) {
    if (declared.has(component) || registered.has(component)) required.add(component)
  }
}
const staged = new Set()
if (fs.existsSync(stagingDir)) {
  for (const dirent of fs.readdirSync(stagingDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const file = path.join(stagingDir, dirent.name, 'component.json')
    if (!fs.existsSync(file)) continue
    try {
      staged.add(JSON.parse(fs.readFileSync(file, 'utf8')).id)
    } catch {
      // A broken staged package is reported by check-staged-components.
    }
  }
}

const requiredList = [...required].sort()
const unregistered = requiredList.filter((id) => !registered.has(id))
const missing = unregistered.filter((id) => !staged.has(id))
const missingDeclared = missing.filter((id) => !declared.has(id))
if (missingDeclared.length) {
  console.error(
    `FAIL section ${sectionId} uses unregistered component(s) with no new/extend declaration: ${missingDeclared.join(', ')}`,
  )
  process.exit(1)
}

const registeredList = requiredList.filter((id) => registered.has(id))
const stagedList = requiredList.filter((id) => staged.has(id))
const parts = []
if (missing.length) parts.push(`本页需新建：${missing.join(', ')}`)
if (stagedList.length) parts.push(`本页已有暂存：${stagedList.join(', ')}`)
if (registeredList.length) parts.push(`复用已注册：${registeredList.join(', ')}`)
if (!parts.length) parts.push('本页无组件')

const referenceVerbatim = missing
  .map((id) => ({ id, extract: relativeReferenceExtract(scriptPath, id) }))
  .filter((entry) => entry.extract)
const data = {
  section: sectionId,
  slides: section.slides,
  required: requiredList,
  registered: registeredList,
  staged: stagedList,
  unregistered,
  missing,
  referenceVerbatim,
  // Build only what is absent; validate and review whenever anything is unregistered.
  buildRequired: missing.length > 0,
  needsWork: unregistered.length > 0,
  summary: parts.join('；'),
}
if (jsonOut) process.stdout.write(JSON.stringify(data, null, 2) + '\n')
else console.log(JSON.stringify(data, null, 2))
