#!/usr/bin/env node
// Mock-model test for structured component generation + repair-ready apply.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readData } from './lib.mjs'

const tools = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(tools, '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-component-generation-'))
const staging = fs.mkdtempSync(path.join(root, 'registry', '.tmp-component-generation-'))
const repairStaging = fs.mkdtempSync(path.join(root, 'registry', '.tmp-component-repair-'))
const fileStaging = fs.mkdtempSync(path.join(root, 'registry', '.tmp-component-file-'))
const mocks = path.join(tmp, 'mocks')
fs.mkdirSync(mocks)
function cleanup() {
  fs.rmSync(staging, { recursive: true, force: true })
  fs.rmSync(repairStaging, { recursive: true, force: true })
  fs.rmSync(fileStaging, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
}
process.on('exit', cleanup)
try {
  const bundlePath = path.join(tmp, 'source.files.json')
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
  const manifestEntry = bundle.files.find((file) => file.path === 'component.json')
  const manifest = JSON.parse(manifestEntry.content)
  manifest.version = '1.1.0'
  manifestEntry.content = JSON.stringify(manifest, null, 2)

  fs.writeFileSync(
    path.join(mocks, 'component-files.json'),
    JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(bundle) }] }),
  )
  const result = spawnSync(process.execPath, [
    path.join(tools, 'generate-component.mjs'),
    '--component', 'code-anatomy',
    '--brief', path.join(root, 'specs/001-2d-arrays/component-briefs/code-anatomy.md'),
    '--mode', 'extend',
    '--strategy', 'full',
    '--registry', path.join(root, 'registry/index.json'),
    '--style', path.join(root, 'shells/branch-choice/style-pack.manifest.json'),
    '--exemplar', 'code-anatomy',
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
  assert.equal(readData(path.join(staged, 'component.json')).provenance.approvedBy, 'pending-page-review')
  assert.equal(readData(path.join(staged, 'component.json')).version, '1.1.0')
  const report = readData(path.join(tmp, 'work', 'generation.json'))
  assert.equal(report.attempts, 1)

  // A failed package check must feed errors back and retry once.
  const repairMocks = path.join(tmp, 'repair-mocks')
  fs.mkdirSync(repairMocks)
  const invalid = structuredClone(bundle)
  invalid.files = invalid.files.filter((file) => file.path !== 'runtime.js')
  fs.writeFileSync(
    path.join(repairMocks, 'component-files.json'),
    JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(invalid) }] }),
  )
  fs.writeFileSync(
    path.join(repairMocks, 'component-files-repair.json'),
    JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(bundle) }] }),
  )
  const repairResult = spawnSync(process.execPath, [
    path.join(tools, 'generate-component.mjs'),
    '--component', 'code-anatomy',
    '--brief', path.join(root, 'specs/001-2d-arrays/component-briefs/code-anatomy.md'),
    '--mode', 'extend',
    '--strategy', 'full',
    '--registry', path.join(root, 'registry/index.json'),
    '--style', path.join(root, 'shells/branch-choice/style-pack.manifest.json'),
    '--exemplar', 'code-anatomy',
    '--staging', repairStaging,
    '--project-root', root,
    '--work-dir', path.join(tmp, 'repair-work'),
    '--mock-dir', repairMocks,
    '--api', 'anthropic-messages',
    '--model', 'mock',
  ], { encoding: 'utf8', cwd: root })
  if (repairResult.status !== 0) {
    console.error(repairResult.stdout, repairResult.stderr)
    process.exit(1)
  }
  assert.equal(readData(path.join(tmp, 'repair-work', 'generation.json')).attempts, 2)

  // files strategy: one mocked model call per file.
  const fileMocks = path.join(tmp, 'file-mocks')
  fs.mkdirSync(fileMocks)
  for (const file of bundle.files) {
    if (file.path.startsWith('baselines/')) continue
    const stem = `component-file-${file.path.replace(/[^a-zA-Z0-9._-]+/g, '-')}`
    const first = file.path === 'tests/core.spec.mjs'
      ? { path: file.path, content: "import test from 'node:test'\ntest('intentional failure', () => { throw new Error('intentional failure') })\n" }
      : { path: file.path, content: file.content }
    fs.writeFileSync(
      path.join(fileMocks, `${stem}.json`),
      JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(first) }] }),
    )
    if (file.path === 'tests/core.spec.mjs') {
      fs.writeFileSync(
        path.join(fileMocks, `${stem}-repair.json`),
        JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ path: file.path, content: file.content }) }] }),
      )
    }
  }
  const fileResult = spawnSync(process.execPath, [
    path.join(tools, 'generate-component.mjs'),
    '--component', 'code-anatomy',
    '--brief', path.join(root, 'specs/001-2d-arrays/component-briefs/code-anatomy.md'),
    '--mode', 'extend',
    '--strategy', 'files',
    '--registry', path.join(root, 'registry/index.json'),
    '--style', path.join(root, 'shells/branch-choice/style-pack.manifest.json'),
    '--exemplar', 'code-anatomy',
    '--staging', fileStaging,
    '--project-root', root,
    '--work-dir', path.join(tmp, 'file-work'),
    '--mock-dir', fileMocks,
    '--api', 'anthropic-messages',
    '--model', 'mock',
  ], { encoding: 'utf8', cwd: root })
  if (fileResult.status !== 0) {
    console.error(fileResult.stdout, fileResult.stderr)
    process.exit(1)
  }
  assert.ok(fs.existsSync(path.join(fileStaging, 'code-anatomy', 'runtime.js')))
  const fileReport = readData(path.join(tmp, 'file-work', 'generation.json'))
  assert.equal(fileReport.strategy, 'files')
  assert.equal(fileReport.attempts, 2)
  const attempt2Evidence = fs.readdirSync(path.join(tmp, 'file-work'))
    .filter((name) => name.includes('attempt-2') && name.startsWith('evidence-'))
    .sort()
  assert.deepEqual(attempt2Evidence, ['evidence-tests-core.spec.mjs-attempt-2.json'])
  console.log('PASS structured component generation with mock files')
} finally {
  cleanup()
}
