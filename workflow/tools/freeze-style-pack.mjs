#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const packPath = args.find((a) => !a.startsWith('--'))
function opt(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
if (!packPath) {
  console.error(`usage: node freeze-style-pack.mjs <style-pack.full.json> [--out <freeze.json>]

Validates the full style pack (including baselines), then writes a frozen manifest
with SHA-256 of the pack + baseline files.
`)
  process.exit(2)
}

const outPath = path.resolve(
  opt('--out', path.join(path.dirname(packPath), 'style-pack.freeze.json')),
)
const here = path.dirname(fileURLToPath(import.meta.url))
const validator = path.join(here, 'validate-style-pack.mjs')

const check = spawnSync(process.execPath, [validator, packPath, '--check-baselines'], {
  stdio: 'inherit',
})
if (check.status !== 0) {
  console.error('style pack validation failed; refuse to freeze')
  process.exit(1)
}

const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'))
const hash = crypto.createHash('sha256')
hash.update(fs.readFileSync(packPath))
const baselineFiles = []
for (const component of pack.components || []) {
  if (!component.baseline) continue
  const p = path.resolve(path.dirname(packPath), component.baseline)
  baselineFiles.push(path.relative(path.dirname(packPath), p))
}
baselineFiles.sort()
for (const rel of baselineFiles) {
  const p = path.resolve(path.dirname(packPath), rel)
  hash.update(rel)
  hash.update(fs.readFileSync(p))
}

const freeze = {
  id: pack.id,
  version: pack.version,
  sourceHash: hash.digest('hex'),
  frozenAt: new Date().toISOString(),
  packPath: path.relative(process.cwd(), path.resolve(packPath)),
  components: pack.components?.length || 0,
  layouts: pack.layouts?.length || 0,
  baselineFiles,
}
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(freeze, null, 2))
console.log(`frozen ${pack.id}@${pack.version}`)
console.log(`sourceHash: ${freeze.sourceHash}`)
console.log(`wrote ${outPath}`)
