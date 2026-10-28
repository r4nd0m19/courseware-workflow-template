#!/usr/bin/env node
// Validate a model-authored component file bundle and stage it atomically.
//
// The model never writes registry/staging or registry/components. This tool
// checks the path allowlist, file sizes and manifest references, writes to a
// temporary directory, runs the deterministic component checks, and only then
// renames the package into registry/staging/<id>.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readData, validateWithSchema } from './lib.mjs'
import { isSafeRelative, resolveInside } from './registry-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
function flag(name) {
  return args.includes(name)
}
const filesPath = opt('--files')
const stagingRoot = path.resolve(opt('--staging', 'registry/staging'))
const projectRoot = path.resolve(opt('--project-root', process.cwd()))
const force = flag('--force')
const skipChecks = flag('--skip-checks')
const skipBrowser = flag('--skip-browser')
const generateBaselines = flag('--generate-baselines')
const sanitizeProvenance = flag('--sanitize-provenance')
const sandbox = flag('--sandbox')
if (!filesPath) {
  console.error('usage: node apply-component-files.mjs --files <component-files.json> [--staging registry/staging] [--project-root .] [--force] [--skip-checks] [--skip-browser] [--generate-baselines] [--sanitize-provenance] [--sandbox]')
  process.exit(2)
}
const MAX_TOTAL = 20 * 1024 * 1024
const MAX_FILE = 8 * 1024 * 1024
let tempDir = ''
function fail(message) {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
  console.error(`FAIL apply component files — ${message}`)
  process.exit(1)
}
function decode(file) {
  if ((file.encoding || 'utf8') === 'utf8') return Buffer.from(file.content, 'utf8')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.content) || file.content.length % 4 !== 0) {
    fail(`${file.path}: invalid base64 content`)
  }
  return Buffer.from(file.content, 'base64')
}

let bundle
try {
  bundle = readData(filesPath)
} catch (error) {
  fail(`cannot read ${filesPath}: ${error.message}`)
}
const schema = validateWithSchema(
  fileURLToPath(new URL('../schemas/component-files.schema.json', import.meta.url)),
  bundle,
)
if (!schema.ok) fail(`bundle schema:\n  ${schema.errors.join('\n  ')}`)
const seen = new Set()
let total = 0
const decoded = new Map()
for (const file of bundle.files) {
  if (!isSafeRelative(file.path) || file.path.split('/').includes('..')) {
    fail(`unsafe path ${JSON.stringify(file.path)}`)
  }
  if (seen.has(file.path)) fail(`duplicate path ${file.path}`)
  seen.add(file.path)
  const buffer = decode(file)
  if (buffer.length > MAX_FILE) fail(`${file.path}: file exceeds ${MAX_FILE} bytes`)
  total += buffer.length
  if (total > MAX_TOTAL) fail(`bundle exceeds ${MAX_TOTAL} bytes`)
  decoded.set(file.path, buffer)
}
for (const required of ['component.json', 'runtime.js']) {
  if (!decoded.has(required)) fail(`missing required file ${required}`)
}
let manifest
try {
  manifest = JSON.parse(decoded.get('component.json').toString('utf8'))
} catch (error) {
  fail(`component.json: ${error.message}`)
}
if (manifest.id !== bundle.id) fail(`bundle.id ${bundle.id} != component.json id ${manifest.id}`)
const referenced = [
  manifest.implementation,
  ...(manifest.styles || []),
  ...(manifest.tests || []),
  ...(manifest.stories || []),
  ...(generateBaselines ? [] : manifest.baselines || []),
].filter(Boolean)
for (const relative of referenced) {
  if (!decoded.has(relative)) fail(`manifest references missing file ${relative}`)
}

const forbidden = [
  [/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/, 'network API'],
  [/\brequire\s*\(/, 'CommonJS require'],
  [/\bchild_process\b/, 'child_process'],
  [/\beval\s*\(/, 'eval'],
  [/\bnew\s+Function\b/, 'new Function'],
  [/\b(document\.cookie|localStorage|sessionStorage)\b/, 'browser storage/cookies'],
  [/(?:src|href)=["']https?:\/\//i, 'external asset URL'],
  [/url\(\s*["']?https?:\/\//i, 'external CSS URL'],
]
const testForbidden = [
  [/\b(child_process|node:net|node:http|node:https)\b/, 'network/process API'],
  [/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/, 'network API'],
]
for (const [relative, buffer] of decoded) {
  if (!/^(runtime\.js|styles\.css|stories\/.*\.(html|js|css)|assets\/.*|tests\/.*\.(mjs|js))$/.test(relative)) continue
  const text = buffer.toString('utf8')
  const rules = relative.startsWith('tests/') ? testForbidden : forbidden
  for (const [pattern, label] of rules) {
    if (pattern.test(text)) fail(`${relative}: forbidden ${label}`)
  }
}

fs.mkdirSync(stagingRoot, { recursive: true })
tempDir = fs.mkdtempSync(path.join(stagingRoot, `.tmp-${bundle.id}-`))
for (const [relative, buffer] of decoded) {
  const absolute = resolveInside(tempDir, relative)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, buffer)
}

if (sanitizeProvenance) {
  // The model must not claim a teacher approval. Registration records the real approver later.
  manifest.status = 'core'
  manifest.runtime = 'vanilla-browser'
  manifest.provenance = {
    ...manifest.provenance,
    approvedBy: 'pending-page-review',
    approvedAt: 'pending',
  }
  fs.writeFileSync(path.join(tempDir, 'component.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

if (generateBaselines) {
  const capture = spawnSync(process.execPath, [
    path.join(projectRoot, 'workflow/tools/capture-component-baselines.mjs'),
    '--package', tempDir,
    '--project-root', projectRoot,
    '--only-missing',
    ...(sandbox ? ['--sandbox'] : []),
  ], { stdio: 'inherit', cwd: projectRoot })
  if (capture.error) fail(`capture baselines: ${capture.error.message}`)
  if (capture.status !== 0) fail(`capture baselines failed (exit ${capture.status})`)
}

if (!skipChecks) {
  const checks = spawnSync(process.execPath, [
    path.join(projectRoot, 'workflow/tools/run-component-checks.mjs'),
    '--package', tempDir,
    '--project-root', projectRoot,
    ...(skipBrowser ? ['--skip-browser'] : []),
    ...(sandbox ? ['--sandbox'] : []),
  ], { stdio: 'inherit', cwd: projectRoot })
  if (checks.error) fail(`component checks: ${checks.error.message}`)
  if (checks.status !== 0) fail(`component checks failed (exit ${checks.status})`)
}

const finalDir = path.join(stagingRoot, bundle.id)
if (fs.existsSync(finalDir)) {
  if (!force) fail(`${finalDir} already exists (pass --force to replace)`)
  fs.rmSync(finalDir, { recursive: true, force: true })
}
fs.renameSync(tempDir, finalDir)
tempDir = ''
const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(finalDir, 'component.json'))).digest('hex')
console.log(`OK apply component files — ${bundle.id} staged at ${finalDir} (manifest sha256 ${digest.slice(0, 12)})`)
