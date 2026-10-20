#!/usr/bin/env node
// List the shell library and verify that each declared package is loadable.
import fs from 'node:fs'
import path from 'node:path'
import { readJson } from './shell-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const indexFile = path.resolve(opt('--index', 'shells/index.json'))
const jsonOut = args.includes('--json')
const check = args.includes('--check')

if (!fs.existsSync(indexFile)) {
  console.error(`shell index not found: ${indexFile}`)
  process.exit(2)
}
const index = readJson(indexFile)
const errors = []
const rows = []
for (const entry of index.shells || []) {
  const root = path.resolve(path.dirname(indexFile), entry.path || entry.id)
  const shellFile = path.join(root, 'shell.json')
  let shell = null
  if (!fs.existsSync(shellFile)) errors.push(`${entry.id}: shell.json not found at ${shellFile}`)
  else {
    shell = readJson(shellFile, `${entry.id}/shell.json`)
    if (shell.id !== entry.id) errors.push(`${entry.id}: shell.json id is ${shell.id}`)
    if (!fs.existsSync(path.join(root, 'site', 'index.html'))) errors.push(`${entry.id}: site/index.html missing`)
    if (!fs.existsSync(path.join(root, 'style-pack.full.json'))) errors.push(`${entry.id}: style-pack.full.json missing`)
  }
  rows.push({
    id: entry.id,
    name: shell?.name || entry.name,
    version: shell?.version || entry.version,
    profile: shell?.profile || entry.profile,
    slideTypes: shell?.dataContract?.slideTypes?.length ?? entry.slideTypes?.length ?? 0,
    illustrations: shell?.assets?.illustrations?.length ?? 0,
    path: path.relative(process.cwd(), root) || '.',
    ok: !errors.some((error) => error.startsWith(`${entry.id}:`)),
  })
}

if (jsonOut) {
  console.log(JSON.stringify({ index: indexFile, shells: rows, errors }, null, 2))
} else {
  console.log(`shells: ${rows.length}`)
  for (const row of rows) {
    console.log(`${row.ok ? 'OK ' : 'ERR'} ${row.id}@${row.version} — ${row.name}`)
    console.log(`    profile=${row.profile} types=${row.slideTypes} illustrations=${row.illustrations} path=${row.path}`)
  }
  for (const error of errors) console.error(`  - ${error}`)
}
process.exit(errors.length && check ? 1 : 0)
