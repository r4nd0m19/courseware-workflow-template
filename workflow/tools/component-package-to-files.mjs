#!/usr/bin/env node
// Convert an existing component package into the structured files JSON.
// This is the golden-fixture path used to prove that apply-component-files can
// reproduce a known-good package before any model is allowed to write one.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateWithSchema } from './lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
const packageDir = opt('--package')
const outPath = opt('--out')
if (!packageDir || !outPath) {
  console.error('usage: node component-package-to-files.mjs --package <component-dir> --out <files.json>')
  process.exit(2)
}
const root = path.resolve(packageDir)
if (!fs.existsSync(path.join(root, 'component.json'))) {
  console.error(`FAIL component-package-to-files — ${root}/component.json not found`)
  process.exit(1)
}
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico'])
function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'component.json'), 'utf8'))
const files = walk(root)
  .map((file) => {
    const relative = path.relative(root, file).split(path.sep).join('/')
    const binary = BINARY.has(path.extname(file).toLowerCase())
    return {
      path: relative,
      encoding: binary ? 'base64' : 'utf8',
      content: fs.readFileSync(file, binary ? 'base64' : 'utf8'),
    }
  })
  .sort((a, b) => a.path.localeCompare(b.path))
const bundle = { id: manifest.id, files }
const schema = validateWithSchema(
  fileURLToPath(new URL('../schemas/component-files.schema.json', import.meta.url)),
  bundle,
)
if (!schema.ok) {
  console.error('FAIL component-package-to-files — package contains files outside the structured contract')
  for (const error of schema.errors) console.error(`  - ${error}`)
  process.exit(1)
}
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(path.resolve(outPath), `${JSON.stringify(bundle, null, 2)}\n`)
console.log(`OK component package -> files — ${manifest.id}, ${files.length} file(s)`)
