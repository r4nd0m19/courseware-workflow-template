#!/usr/bin/env node
// Assemble style-pack/source from the reference courseware by copying files
// byte-for-byte. No CSS reimplementation, no screenshot-derived values.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
function flag(name) { return args.includes(name) }
const reference = path.resolve(opt('--reference', ''))
const outDir = path.resolve(opt('--out', 'style-pack/source'))
const inlineCssPath = opt('--inline-css', '')
const check = flag('--check')
const jsonOut = flag('--json')
if (!reference || !fs.existsSync(reference)) {
  console.error(`usage: node build-style-pack-source.mjs --reference <reference-lesson-dir> [--inline-css <file>] [--out style-pack/source] [--check] [--json]`)
  process.exit(2)
}
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const errors = []
const files = []
const cssMap = [
  ['01-blockworld-theme.css', 'blockworld-theme.css'],
  ['02-cover-workstation.css', 'cover-workstation.css'],
  ['03-chapter-covers.css', 'chapter-covers.css'],
  ['04-chapter-gardens.css', 'chapter-gardens.css'],
  ['05-creative-labs.css', 'creative-labs.css'],
  ['06-classroom-polish.css', 'classroom-polish.css'],
]
const jsMap = [
  ['lesson-audio.js', 'lesson-audio.js'],
  ['classroom-polish.js', 'classroom-polish.js'],
  ['cpp-classroom.js', 'cpp-classroom.js'],
]

let inlineCss = inlineCssPath ? path.resolve(inlineCssPath) : ''
if (!inlineCss) {
  const inline = path.join(reference, 'inline.css')
  if (fs.existsSync(inline)) inlineCss = inline
}
if (!inlineCss) {
  const htmlFile = path.join(reference, 'index.html')
  if (fs.existsSync(htmlFile)) {
    const html = fs.readFileSync(htmlFile, 'utf8')
    const match = html.match(/<style>\s*([\s\S]*?)\s*<\/style>/)
    if (match) {
      inlineCss = path.join(outDir, '.inline-base.css')
      if (!check) {
        fs.mkdirSync(outDir, { recursive: true })
        fs.writeFileSync(inlineCss, match[1])
      }
    }
  }
}
if (!inlineCss || !fs.existsSync(inlineCss)) errors.push('inline base CSS not found (pass --inline-css)')

function add(relativeFile, sourceFile, referencePath) {
  if (!fs.existsSync(sourceFile)) { errors.push(`reference file missing: ${sourceFile}`); return }
  const target = path.join(outDir, relativeFile)
  const hash = sha256(sourceFile)
  const bytes = fs.statSync(sourceFile).size
  if (!check) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(sourceFile, target)
  } else if (!fs.existsSync(target) || sha256(target) !== hash) {
    errors.push(`copied source is stale: ${relativeFile}`)
  }
  files.push({ file: `source/${relativeFile}`, referencePath, sha256: hash, bytes })
}

if (inlineCss && fs.existsSync(inlineCss)) add('css/00-base.css', inlineCss, path.relative(process.cwd(), inlineCss))
for (const [relative, name] of cssMap) add(`css/${relative}`, path.join(reference, name), path.relative(process.cwd(), path.join(reference, name)))
for (const [relative, name] of jsMap) add(`js/${relative}`, path.join(reference, name), path.relative(process.cwd(), path.join(reference, name)))

const sourceFile = path.join(outDir, 'SOURCE.json')
let previous = {}
if (fs.existsSync(sourceFile)) {
  try { previous = JSON.parse(fs.readFileSync(sourceFile, 'utf8')) } catch {}
}
const manifest = {
  schemaVersion: previous.schemaVersion || '1.0',
  stylePackId: previous.stylePackId || 'blockworld-cpp',
  stylePackVersion: previous.stylePackVersion || '2.0.0',
  sourceKind: 'verbatim-copy',
  capturedAt: previous.capturedAt || new Date().toISOString(),
  referenceRoot: path.relative(process.cwd(), reference),
  referenceUrl: previous.referenceUrl || '',
  notes: [
    'CSS and JS files are copied byte-for-byte from the reference courseware; no reimplementation.',
    'Component DOM templates and animation behavior live in the copied reference renderer/index.',
    'Reference images and audio remain local-only and are excluded from shareable packs pending authorization.',
  ],
  files,
}
if (!check) {
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(sourceFile, `${JSON.stringify(manifest, null, 2)}\n`)
} else if (!fs.existsSync(sourceFile)) {
  errors.push(`missing ${sourceFile}`)
}

const report = { ok: errors.length === 0, files: files.length, errors, out: path.relative(process.cwd(), sourceFile) }
if (jsonOut) console.log(JSON.stringify(report, null, 2))
else {
  for (const error of errors) console.log(`ERROR: ${error}`)
  console.log(`${report.ok ? 'OK' : 'FAIL'} style-pack source (${files.length} copied files)${check ? ' (check)' : ''}`)
}
process.exit(report.ok ? 0 : 1)
