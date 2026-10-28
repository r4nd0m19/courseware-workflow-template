#!/usr/bin/env node
// Build a set of new/extend components through the structured generator.
//
// Workflow wrapper equivalent to the old multi-component speckit.component-build
// invocation: it resolves each brief, chooses new/extend from the approved
// script, and calls generate-component for one component at a time.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseScript } from './script-lib.mjs'
import { findReferenceExtract } from './reference-extract-lib.mjs'

const toolsDir = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
function die(message) {
  console.error(`FAIL component generation batch — ${message}`)
  process.exit(1)
}
const componentIds = String(opt('--components'))
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)
const lessonSlug = opt('--lesson-slug')
const scriptPath = opt('--script')
const briefDir = opt('--brief-dir', lessonSlug ? path.join('specs', lessonSlug, 'component-briefs') : '')
const registryPath = opt('--registry', 'registry/index.json')
const stylePath = opt('--style')
const styleFullPath = opt('--style-full')
const staging = opt('--staging', 'registry/staging')
const projectRoot = path.resolve(opt('--project-root', process.cwd()))
const strategy = opt('--strategy', 'files')
const exemplarId = opt('--exemplar', 'code-anatomy')
const maxAttempts = opt('--max-attempts', '2')
const mockDir = opt('--mock-dir')
const workRoot = opt('--work-dir', path.join('review', lessonSlug, 'component-generation'))
const force = args.includes('--force')
const skipBrowser = args.includes('--skip-browser')
if (!componentIds.length || !lessonSlug || !scriptPath || !briefDir) {
  console.error('usage: node generate-components.mjs --components <id,id> --lesson-slug <slug> --script <courseware.md> [--brief-dir specs/<slug>/component-briefs] [--registry registry/index.json] [--style <manifest>] [--staging registry/staging] [--project-root .] [--strategy files|full] [--mock-dir <dir>] [--work-dir <dir>] [--force] [--skip-browser]')
  process.exit(2)
}
if (!fs.existsSync(scriptPath)) die(`script not found: ${scriptPath}`)
const script = parseScript(scriptPath)
const statusById = new Map()
for (const slide of script.slides) {
  for (const plan of slide.machine?.componentPlan || []) {
    if (plan.status === 'new' || plan.status === 'extend') statusById.set(plan.id, plan.status)
  }
}
const forwarded = []
for (let i = 0; i < args.length; i += 1) {
  if (['--config', '--zcode-config', '--zcode-provider', '--api', '--base-url', '--model', '--api-key-env', '--api-key-file', '--max-tokens', '--timeout-ms', '--auth'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
    forwarded.push(args[i], args[i + 1])
    i += 1
  }
}
for (const id of componentIds) {
  const mode = statusById.get(id)
  if (!mode) die(`${id}: no new/extend componentPlan declaration in ${scriptPath}`)
  const brief = path.join(briefDir, `${id}.md`)
  if (!fs.existsSync(brief)) die(`${id}: brief not found: ${brief}`)
  const extractManifest = findReferenceExtract(scriptPath, id)
  if (extractManifest) {
    let extract
    try {
      extract = JSON.parse(fs.readFileSync(extractManifest, 'utf8'))
    } catch (error) {
      die(`${id}: cannot read reference extract ${extractManifest}: ${error.message}`)
    }
    if (extract.id !== id) die(`${id}: reference extract declares id ${JSON.stringify(extract.id)}`)
  }
  const actualMode = extractManifest ? 'reference-verbatim' : mode
  const workDir = path.join(workRoot, id)
  const childArgs = [
    path.join(toolsDir, 'generate-component.mjs'),
    '--component', id,
    '--brief', brief,
    '--mode', actualMode,
    ...(extractManifest
      ? ['--extract-manifest', extractManifest]
      : ['--strategy', strategy]),
    '--registry', registryPath,
    '--exemplar', exemplarId,
    '--staging', staging,
    '--project-root', projectRoot,
    '--work-dir', workDir,
    '--max-attempts', maxAttempts,
    ...(stylePath ? ['--style', stylePath] : []),
    ...(styleFullPath ? ['--style-full', styleFullPath] : []),
    ...(mockDir ? ['--mock-dir', mockDir] : []),
    ...(force ? ['--force'] : []),
    ...(skipBrowser ? ['--skip-browser'] : []),
    ...forwarded,
  ]
  console.log(`\n== component ${id} (${actualMode}${extractManifest ? ` via ${path.relative(process.cwd(), extractManifest)}` : ''})`)
  const result = spawnSync(process.execPath, childArgs, {
    cwd: projectRoot,
    stdio: 'inherit',
  })
  if (result.error) die(`${id}: ${result.error.message}`)
  if (result.status !== 0) die(`${id}: generator failed (exit ${result.status})`)
}
console.log(`OK component generation batch — ${componentIds.length} component(s)`)
