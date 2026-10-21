#!/usr/bin/env node
// List new/extend components declared by the approved script that are neither
// registered core nor already staged. The workflow prebuilds these once before
// the page loop, instead of stalling the first page that needs each component.
import fs from 'node:fs'
import path from 'node:path'
import { parseScript } from './script-lib.mjs'
import { assertScriptApproved } from './approval-lib.mjs'
import { readSectionManifest } from './section-lib.mjs'
import { readData } from './lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const scriptPath = opt('--script')
const storyboardPath = opt('--storyboard')
const sectionsPath = opt('--sections')
const registryPath = opt('--registry', 'registry/index.json')
const stagingDir = opt('--staging', path.join(path.dirname(path.resolve(registryPath)), 'staging'))

if (!scriptPath || !storyboardPath || !sectionsPath) {
  console.error(
    'usage: node list-missing-components.mjs --script <courseware.md> --storyboard <storyboard.yml> --sections <review-sections.yml> [--registry registry/index.json] [--staging <dir>]',
  )
  process.exit(2)
}
try {
  assertScriptApproved(scriptPath)
} catch (error) {
  console.error(`FAIL missing components — ${error.message}`)
  process.exit(1)
}

const script = parseScript(scriptPath)
const storyboard = readData(storyboardPath)
const manifest = readSectionManifest(sectionsPath)
const bySlide = new Map((storyboard.slides || []).map((slide) => [slide.id, slide]))

const declared = new Set()
for (const slide of script.slides) {
  for (const item of slide.machine?.componentPlan || []) {
    if (item.status === 'new' || item.status === 'extend') declared.add(item.id)
  }
}

const registered = new Set()
try {
  const registry = JSON.parse(fs.readFileSync(path.resolve(registryPath), 'utf8'))
  for (const entry of registry.components || []) {
    if (entry.status === 'core') registered.add(entry.id)
  }
} catch {
  // check-registry catches a missing/invalid registry elsewhere.
}

const staged = new Set()
try {
  for (const dirent of fs.readdirSync(path.resolve(stagingDir), { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const file = path.join(stagingDir, dirent.name, 'component.json')
    if (!fs.existsSync(file)) continue
    try {
      staged.add(JSON.parse(fs.readFileSync(file, 'utf8')).id)
    } catch {
      // check-staged-components reports broken packages.
    }
  }
} catch {
  // No staging directory yet.
}

const missing = [...declared].filter((id) => !registered.has(id) && !staged.has(id)).sort()
const components = missing.map((id) => {
  const section = manifest.sections.find((candidate) =>
    (candidate.slides || []).some((slideId) =>
      (bySlide.get(slideId)?.components || []).includes(id),
    ),
  )
  return {
    id,
    section: section ? section.id : null,
    slides: section ? section.slides : [],
  }
})

console.log(
  JSON.stringify(
    {
      ids: components.map((component) => component.id),
      needsPrebuild: components.length > 0,
      components,
      staging: path.relative(process.cwd(), path.resolve(stagingDir)),
    },
    null,
    2,
  ),
)
