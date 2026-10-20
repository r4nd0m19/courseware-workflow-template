#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fail, ok } from './lib.mjs'
import { inspectPackage } from './registry-lib.mjs'

const args = process.argv.slice(2)
function option(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const registryPath = option('--registry')
const projectRoot = option('--project-root') ? path.resolve(option('--project-root')) : ''
const stagingOpt = option('--staging')
const excluded = new Set([option('--registry'), option('--project-root'), stagingOpt].filter(Boolean))
const stagingArg = stagingOpt || args.find((a) => !a.startsWith('--') && !excluded.has(a))
let stagingDir = stagingArg ? path.resolve(stagingArg) : ''
if (!stagingDir && registryPath) {
  stagingDir = path.join(path.dirname(path.resolve(registryPath)), 'staging')
}
if (!stagingDir) {
  console.error('usage: node check-staged-components.mjs <staging-dir> | --registry <registry.json> [--staging <dir>] [--project-root <dir>]')
  process.exit(2)
}
if (!fs.existsSync(stagingDir)) {
  ok('staged components', 'none (staging directory does not exist)')
  process.exit(0)
}
const packages = fs
  .readdirSync(stagingDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(stagingDir, d.name))
  .filter((dir) => fs.existsSync(path.join(dir, 'component.json')))
if (packages.length === 0) {
  ok('staged components', 'none')
  process.exit(0)
}
const errors = []
const warnings = []
const ids = []
for (const dir of packages) {
  const result = inspectPackage(dir, { projectRoot })
  for (const e of result.errors) errors.push(`${path.basename(dir)}: ${e}`)
  for (const w of result.warnings) warnings.push(`${path.basename(dir)}: ${w}`)
  if (result.manifest) ids.push(`${result.manifest.id}@${result.manifest.version}`)
}
if (errors.length) {
  fail('staged components', errors)
  for (const w of warnings) console.error(`WARN ${w}`)
  process.exit(1)
}
ok('staged components', ids.join(', '))
for (const w of warnings) console.log(`WARN ${w}`)
