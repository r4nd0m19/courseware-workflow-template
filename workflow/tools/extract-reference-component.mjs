#!/usr/bin/env node
// Deterministically extract reference-verbatim JS functions, CSS rules and an
// HTML fragment into an authored component template. No model participates.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readData, validateWithSchema } from './lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
const manifestPath = opt('--extract')
const outDir = path.resolve(opt('--out'))
const projectRoot = path.resolve(opt('--project-root', process.cwd()))
const force = args.includes('--force')
if (!manifestPath || !opt('--out')) {
  console.error('usage: node extract-reference-component.mjs --extract <reference-extract.json> --out <staging/id> [--project-root .] [--force]')
  process.exit(2)
}
function die(message) {
  console.error(`FAIL reference extraction — ${message}`)
  process.exit(1)
}
function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}
function readRelative(base, relative) {
  const absolute = path.resolve(base, relative)
  const root = path.resolve(base)
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) die(`path escapes ${base}: ${relative}`)
  if (!fs.existsSync(absolute)) die(`source not found: ${relative}`)
  return { absolute, text: fs.readFileSync(absolute, 'utf8') }
}
const manifest = readData(manifestPath)
const schema = validateWithSchema(
  new URL('../schemas/reference-extract.schema.json', import.meta.url).pathname,
  manifest,
)
if (!schema.ok) die(`manifest schema:\n  ${schema.errors.join('\n  ')}`)
const shellDir = path.resolve(projectRoot, manifest.shell)
if (!fs.existsSync(shellDir)) die(`shell not found: ${manifest.shell}`)

const sources = {}
for (const kind of ['js', 'css', 'html']) {
  if (!manifest.source[kind]) continue
  const file = readRelative(shellDir, manifest.source[kind])
  const digest = sha256(file.text)
  if (manifest.hashes[kind] !== digest) die(`${kind} hash mismatch: expected ${manifest.hashes[kind]}, found ${digest}`)
  sources[kind] = { ...file, digest }
}

function functionText(source, name) {
  const regex = new RegExp(`(?:async\\s+)?function\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`, 'g')
  const match = regex.exec(source)
  if (!match) die(`JS function not found: ${name}`)
  const start = match.index
  let brace = source.indexOf('{', regex.lastIndex)
  if (brace < 0) die(`JS function ${name}: opening brace not found`)
  let depth = 0
  let mode = ''
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i]
    const next = source[i + 1]
    if (mode) {
      if (mode === 'line' && ch === '\n') mode = ''
      else if (mode === 'block' && ch === '*' && next === '/') { mode = ''; i += 1 }
      else if ((mode === 'single' || mode === 'double' || mode === 'template') && ch === '\\') i += 1
      else if (mode === 'single' && ch === "'") mode = ''
      else if (mode === 'double' && ch === '"') mode = ''
      else if (mode === 'template' && ch === '`') mode = ''
      continue
    }
    if (ch === '/' && next === '/') { mode = 'line'; i += 1; continue }
    if (ch === '/' && next === '*') { mode = 'block'; i += 1; continue }
    if (ch === "'") { mode = 'single'; continue }
    if (ch === '"') { mode = 'double'; continue }
    if (ch === '`') { mode = 'template'; continue }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  die(`JS function ${name}: closing brace not found`)
}

function cssBlocks(source, wanted) {
  const blocks = []
  const targets = new Set(wanted.map((selector) => selector.replace(/\s+/g, ' ').trim()))
  let i = 0
  while (i < source.length) {
    while (i < source.length && /\s/.test(source[i])) i += 1
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2)
      i = end >= 0 ? end + 2 : source.length
      continue
    }
    const start = i
    const brace = source.indexOf('{', i)
    if (brace < 0) break
    const selector = source.slice(start, brace).replace(/\s+/g, ' ').trim()
    let depth = 0
    let end = brace
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1
      else if (source[end] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    if (end >= source.length) die('unbalanced CSS block')
    const text = source.slice(start, end + 1)
    const parts = selector.split(',').map((part) => part.trim())
    if (parts.some((part) => targets.has(part))) {
      blocks.push(text)
      for (const part of parts) if (targets.has(part)) targets.delete(part)
    } else if (selector.startsWith('@media') && parts.length === 1 && wanted.some((item) => text.includes(item))) {
      // Keep a media query whole when the requested selector lives inside it.
      blocks.push(text)
    }
    i = end + 1
  }
  const missing = wanted.filter((selector) => !blocks.some((block) => block.includes(selector)))
  if (missing.length) die(`CSS selector not found: ${missing.join(', ')}`)
  return blocks
}

function htmlFragment(source, selector) {
  const id = selector.match(/#([A-Za-z0-9_-]+)/)?.[1] || ''
  const className = selector.match(/\.([A-Za-z0-9_-]+)/)?.[1] || ''
  const tag = selector.match(/^([A-Za-z][A-Za-z0-9-]*)/)?.[1] || '[A-Za-z][A-Za-z0-9-]*'
  const openRe = new RegExp(`<(${tag})\\b[^>]*>`, 'gi')
  let match
  while ((match = openRe.exec(source))) {
    const tagCode = source.slice(match.index, openRe.lastIndex)
    if (id && !new RegExp(`\\bid=["']${id}["']`).test(tagCode)) continue
    if (className && !new RegExp(`\\bclass=["'][^"']*\\b${className}\\b`).test(tagCode)) continue
    const tagName = match[1].toLowerCase()
    const closeRe = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi')
    closeRe.lastIndex = match.index
    let depth = 0
    let end = -1
    let token
    while ((token = closeRe.exec(source))) {
      if (token[0].startsWith('</')) depth -= 1
      else if (!token[0].endsWith('/>')) depth += 1
      if (depth === 0) { end = closeRe.lastIndex; break }
    }
    if (end < 0) die(`HTML fragment ${selector}: closing tag not found`)
    return source.slice(match.index, end)
  }
  die(`HTML selector not found: ${selector}`)
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
else if (fs.readdirSync(outDir).length && !force) die(`${outDir} is not empty (pass --force)`)
else if (force) fs.rmSync(outDir, { recursive: true, force: true }) || fs.mkdirSync(outDir, { recursive: true })
const templateDir = path.resolve(projectRoot, manifest.templateDir)
if (!fs.existsSync(templateDir)) die(`template directory not found: ${manifest.templateDir}`)
fs.cpSync(templateDir, outDir, { recursive: true })
// The adapter is an authoring input used to assemble runtime.js; it is not a
// package file. Do not leave it in the extracted component contract.
const adapterOut = path.resolve(outDir, manifest.adapter)
const adapterInside = adapterOut === outDir || adapterOut.startsWith(`${outDir}${path.sep}`)
if (adapterInside && fs.existsSync(adapterOut) && adapterOut !== path.resolve(outDir, 'runtime.js')) {
  fs.rmSync(adapterOut, { force: true })
}
const adapter = readRelative(templateDir, manifest.adapter)
const functions = manifest.functions.map((name) => functionText(sources.js.text, name)).join('\n\n')
const runtime = `// Reference-verbatim functions extracted from ${manifest.source.js}\n// Source SHA-256: ${sources.js.digest}\n\n${functions}\n\n${adapter.text.trim()}\n`
fs.writeFileSync(path.join(outDir, 'runtime.js'), runtime)
const styles = cssBlocks(sources.css.text, manifest.selectors).join('\n\n')
fs.writeFileSync(path.join(outDir, 'styles.css'), `${styles}\n`)
if (manifest.source.html && manifest.markupSelector) {
  fs.writeFileSync(path.join(outDir, 'reference-fragment.html'), htmlFragment(sources.html.text, manifest.markupSelector))
}
const componentPath = path.join(outDir, 'component.json')
const component = readData(componentPath)
component.id = manifest.id
component.status = 'core'
component.runtime = 'vanilla-browser'
component.implementation = 'runtime.js'
component.styles = ['styles.css']
component.sourceFidelity = {
  kind: 'reference-verbatim',
  selectors: manifest.selectors,
  sourceRefs: [
    `${manifest.source.js}#${sources.js.digest}`,
    `${manifest.source.css}#${sources.css.digest}`,
    ...(manifest.source.html ? [`${manifest.source.html}#${sources.html.digest}`] : []),
  ],
}
component.provenance = {
  ...(component.provenance || {}),
  type: 'reference-verbatim',
  brief: component.provenance?.brief || `component-briefs/${manifest.id}.md`,
  approvedBy: 'pending-page-review',
  approvedAt: 'pending',
}
fs.writeFileSync(componentPath, `${JSON.stringify(component, null, 2)}\n`)
console.log(`OK reference extraction — ${manifest.id}, ${manifest.functions.length} function(s), ${manifest.selectors.length} CSS selector(s)`)
