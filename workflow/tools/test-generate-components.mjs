#!/usr/bin/env node
// Mock test for the workflow wrapper that builds one or more components.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readData } from './lib.mjs'

const tools = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(tools, '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-generate-components-'))
const staging = fs.mkdtempSync(path.join(root, 'registry', '.tmp-generate-components-'))
function cleanup() {
  fs.rmSync(staging, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
}
process.on('exit', cleanup)
try {
  const bundlePath = path.join(tmp, 'bundle.json')
  const convert = spawnSync(process.execPath, [
    path.join(tools, 'component-package-to-files.mjs'),
    '--package', path.join(root, 'registry/components/code-anatomy'),
    '--out', bundlePath,
  ], { encoding: 'utf8', cwd: root })
  if (convert.status !== 0) {
    console.error(convert.stdout, convert.stderr)
    process.exit(1)
  }
  const bundle = readData(bundlePath)
  bundle.files = bundle.files.filter((file) => !file.path.startsWith('baselines/'))
  const manifest = bundle.files.find((file) => file.path === 'component.json')
  const manifestData = JSON.parse(manifest.content)
  manifestData.version = '1.1.0'
  manifest.content = JSON.stringify(manifestData, null, 2)
  const mocks = path.join(tmp, 'mocks')
  fs.mkdirSync(mocks)
  for (const file of bundle.files) {
    const stem = `component-file-${file.path.replace(/[^a-zA-Z0-9._-]+/g, '-')}`
    fs.writeFileSync(
      path.join(mocks, `${stem}.json`),
      JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ path: file.path, content: file.content }) }] }),
    )
  }
  const result = spawnSync(process.execPath, [
    path.join(tools, 'generate-components.mjs'),
    '--components', 'code-anatomy',
    '--lesson-slug', '001-2d-arrays',
    '--script', path.join(root, 'specs/001-2d-arrays/courseware.md'),
    '--brief-dir', path.join(root, 'specs/001-2d-arrays/component-briefs'),
    '--registry', path.join(root, 'registry/index.json'),
    '--style', path.join(root, 'shells/branch-choice/style-pack.manifest.json'),
    '--staging', staging,
    '--project-root', root,
    '--work-dir', path.join(tmp, 'work'),
    '--mock-dir', mocks,
    '--api', 'anthropic-messages',
    '--model', 'mock',
  ], { encoding: 'utf8', cwd: root })
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr)
    process.exit(1)
  }
  const staged = path.join(staging, 'code-anatomy')
  assert.ok(fs.existsSync(path.join(staged, 'component.json')))
  assert.ok(fs.existsSync(path.join(staged, 'baselines/initial-1440x900.png')))
  assert.equal(readData(path.join(staged, 'component.json')).version, '1.1.0')
  console.log('PASS structured component batch generation')
} finally {
  cleanup()
}
