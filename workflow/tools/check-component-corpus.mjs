#!/usr/bin/env node
// Regression harness for structured component files against the current core
// registry. This is a benchmark, not a workflow gate: it proves the file
// contract can round-trip every existing component before model output is used.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadRegistry, resolveInside } from './registry-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
const flag = (name) => args.includes(name)
const projectRoot = path.resolve(opt('--project-root', process.cwd()))
const registryPath = path.resolve(opt('--registry', path.join(projectRoot, 'registry/index.json')))
const only = new Set(String(opt('--components', '')).split(',').map((id) => id.trim()).filter(Boolean))
const skipBrowser = flag('--skip-browser')
const keep = flag('--keep')
const { index, registryDir } = loadRegistry(registryPath)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-component-corpus-'))
const staging = fs.mkdtempSync(path.join(registryDir, '.tmp-component-corpus-'))
let failed = 0
let total = 0
function cleanup() {
  if (!keep) {
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.rmSync(staging, { recursive: true, force: true })
  } else {
    console.log(`kept: ${tmp} ${staging}`)
  }
}
process.on('exit', cleanup)
try {
  for (const entry of index.components || []) {
    if (only.size && !only.has(entry.id)) continue
    total += 1
    const packageDir = resolveInside(registryDir, entry.package)
    const bundle = path.join(tmp, `${entry.id}.json`)
    const convert = spawnSync(process.execPath, [
      path.join(projectRoot, 'workflow/tools/component-package-to-files.mjs'),
      '--package', packageDir,
      '--out', bundle,
    ], { encoding: 'utf8', cwd: projectRoot })
    if (convert.status !== 0) {
      failed += 1
      console.error(`FAIL ${entry.id} convert`)
      console.error(convert.stdout, convert.stderr)
      continue
    }
    const apply = spawnSync(process.execPath, [
      path.join(projectRoot, 'workflow/tools/apply-component-files.mjs'),
      '--files', bundle,
      '--staging', staging,
      '--project-root', projectRoot,
      '--force',
      ...(skipBrowser ? ['--skip-browser'] : []),
    ], { encoding: 'utf8', cwd: projectRoot })
    if (apply.status !== 0) {
      failed += 1
      console.error(`FAIL ${entry.id} apply/check`)
      console.error(apply.stdout, apply.stderr)
      continue
    }
    console.log(`PASS ${entry.id}`)
  }
} finally {
  cleanup()
}
if (failed) {
  console.error(`${failed}/${total} component package(s) failed`)
  process.exit(1)
}
console.log(`OK component corpus — ${total}/${total} package(s)`)
