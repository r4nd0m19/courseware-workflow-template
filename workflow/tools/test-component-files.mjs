#!/usr/bin/env node
// Golden test for structured component files.
//
// It converts the existing code-anatomy package to a file bundle, stages it
// through apply-component-files, runs the same package/tests gate, and checks
// that the reconstructed package is byte-equivalent.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readData } from './lib.mjs'

const tools = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(tools, '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-component-files-'))
const stagingRoot = fs.mkdtempSync(path.join(root, 'registry', '.tmp-component-files-'))
const generatedStaging = fs.mkdtempSync(path.join(root, 'registry', '.tmp-component-generated-'))
const bundlePath = path.join(tmp, 'code-anatomy.files.json')
const evidencePath = path.join(tmp, 'code-anatomy.evidence.json')
const sourcePackage = path.join(root, 'registry/components/code-anatomy')
function cleanup() {
  fs.rmSync(stagingRoot, { recursive: true, force: true })
  fs.rmSync(generatedStaging, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
}
process.on('exit', cleanup)

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
function fail(result) {
  console.error(result.stdout || '')
  console.error(result.stderr || '')
  process.exit(1)
}
try {
  const convert = spawnSync(process.execPath, [
    path.join(tools, 'component-package-to-files.mjs'),
    '--package', sourcePackage,
    '--out', bundlePath,
  ], { encoding: 'utf8', cwd: root })
  if (convert.status !== 0) fail(convert)
  assert.ok(fs.existsSync(bundlePath))

  const evidence = spawnSync(process.execPath, [
    path.join(tools, 'build-component-evidence.mjs'),
    '--component', 'code-anatomy',
    '--brief', path.join(root, 'specs/001-2d-arrays/component-briefs/code-anatomy.md'),
    '--mode', 'extend',
    '--registry', path.join(root, 'registry/index.json'),
    '--style', path.join(root, 'shells/branch-choice/style-pack.manifest.json'),
    '--exemplar', 'code-anatomy',
    '--out', evidencePath,
  ], { encoding: 'utf8', cwd: root })
  if (evidence.status !== 0) fail(evidence)
  const evidenceData = readData(evidencePath)
  assert.equal(evidenceData.componentId, 'code-anatomy')
  assert.equal(evidenceData.existing.manifest.id, 'code-anatomy')
  assert.ok(evidenceData.brief.text.includes('code-anatomy') || evidenceData.brief.text.length > 0)

  const apply = spawnSync(process.execPath, [
    path.join(tools, 'apply-component-files.mjs'),
    '--files', bundlePath,
    '--staging', stagingRoot,
    '--project-root', root,
    '--force',
  ], { encoding: 'utf8', cwd: root })
  if (apply.status !== 0) fail(apply)
  const staged = path.join(stagingRoot, 'code-anatomy')
  const sourceFiles = fs.readdirSync(sourcePackage, { recursive: true }).filter((file) => fs.statSync(path.join(sourcePackage, file)).isFile()).sort()
  const stagedFiles = fs.readdirSync(staged, { recursive: true }).filter((file) => fs.statSync(path.join(staged, file)).isFile()).sort()
  assert.deepEqual(stagedFiles, sourceFiles)
  for (const relative of sourceFiles) {
    assert.equal(sha256(path.join(staged, relative)), sha256(path.join(sourcePackage, relative)), relative)
  }
  assert.match(apply.stdout, /OK component checks/)

  const badBundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'))
  badBundle.files.push({ path: '../evil.js', content: 'module.exports = 1' })
  const badPath = path.join(tmp, 'bad.files.json')
  fs.writeFileSync(badPath, JSON.stringify(badBundle))
  const rejected = spawnSync(process.execPath, [
    path.join(tools, 'apply-component-files.mjs'),
    '--files', badPath,
    '--staging', stagingRoot,
    '--project-root', root,
    '--skip-checks',
  ], { encoding: 'utf8', cwd: root })
  assert.notEqual(rejected.status, 0)

  const forbiddenBundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'))
  const runtime = forbiddenBundle.files.find((file) => file.path === 'runtime.js')
  runtime.content += '\nfetch("/leak");\n'
  const forbiddenPath = path.join(tmp, 'forbidden.files.json')
  fs.writeFileSync(forbiddenPath, JSON.stringify(forbiddenBundle))
  const forbidden = spawnSync(process.execPath, [
    path.join(tools, 'apply-component-files.mjs'),
    '--files', forbiddenPath,
    '--staging', stagingRoot,
    '--project-root', root,
    '--skip-checks',
  ], { encoding: 'utf8', cwd: root })
  assert.notEqual(forbidden.status, 0)
  assert.match(forbidden.stderr, /forbidden network API/)

  const withoutBaselines = JSON.parse(fs.readFileSync(bundlePath, 'utf8'))
  withoutBaselines.files = withoutBaselines.files.filter((file) => !file.path.startsWith('baselines/'))
  const noBaselineBundle = path.join(tmp, 'no-baselines.files.json')
  fs.writeFileSync(noBaselineBundle, JSON.stringify(withoutBaselines))
  const generated = spawnSync(process.execPath, [
    path.join(tools, 'apply-component-files.mjs'),
    '--files', noBaselineBundle,
    '--staging', generatedStaging,
    '--project-root', root,
    '--generate-baselines',
    '--force',
  ], { encoding: 'utf8', cwd: root })
  if (generated.status !== 0) fail(generated)
  const generatedPackage = path.join(generatedStaging, 'code-anatomy')
  assert.ok(fs.existsSync(path.join(generatedPackage, 'baselines/initial-1440x900.png')))
  assert.ok(fs.existsSync(path.join(generatedPackage, 'baselines/wrong-1366x768.png')))
  console.log('PASS structured component files golden round-trip')

} finally {
  cleanup()
}
