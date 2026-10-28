#!/usr/bin/env node
// Structured component generation: evidence -> file bundle -> apply/check loop.
//
// The model returns files only. apply-component-files writes a temporary
// package, captures missing story baselines, runs package/tests checks and only
// then stages the package. Test failures are fed back to the model; there is no
// coding-agent fallback.
//
// Two strategies:
//   full  - one model call returns every file (small components / tests)
//   files - one model call per file (default; avoids max_tokens on large code)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readData, validateWithSchema } from './lib.mjs'
import { compareSemver } from './registry-lib.mjs'

const toolsDir = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
function flag(name) {
  return args.includes(name)
}
function die(message) {
  console.error(`FAIL component generation — ${message}`)
  process.exit(1)
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.writeFileSync(path.resolve(file), `${JSON.stringify(value, null, 2)}\n`)
}
function runNode(scriptArgs, label, capture = false) {
  const result = spawnSync(process.execPath, scriptArgs, {
    cwd: process.cwd(),
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (result.error) die(`${label}: ${result.error.message}`)
  return result
}

const componentId = opt('--component')
const briefPath = opt('--brief')
const mode = opt('--mode', 'new')
const strategy = opt('--strategy', 'files')
const registryPath = opt('--registry', 'registry/index.json')
const stylePath = opt('--style')
const styleFullPath = opt('--style-full')
const exemplarId = opt('--exemplar', 'code-anatomy')
const staging = opt('--staging', 'registry/staging')
const projectRoot = path.resolve(opt('--project-root', process.cwd()))
const workDir = opt('--work-dir', path.join('review', 'component-files', componentId))
const evidencePath = opt('--evidence', path.join(workDir, 'evidence.json'))
const outPath = opt('--out', path.join(workDir, 'files.json'))
const reportPath = opt('--report', path.join(workDir, 'generation.json'))
const singleShotPath = opt('--single-shot', path.join(toolsDir, 'single-shot-generate.mjs'))
const buildEvidencePath = opt('--build-evidence', path.join(toolsDir, 'build-component-evidence.mjs'))
const applyPath = opt('--apply', path.join(toolsDir, 'apply-component-files.mjs'))
const mockDir = opt('--mock-dir')
const extractManifest = opt('--extract-manifest')
const maxAttempts = Math.max(1, Number(opt('--max-attempts', '3')) || 3)
const force = flag('--force')
const skipBrowser = flag('--skip-browser')
const sandbox = !flag('--no-sandbox')

if (!componentId || !briefPath) {
  console.error(
    'usage: node generate-component.mjs --component <id> --brief <component-brief.md> [--mode new|extend|reference-verbatim] [--extract-manifest <reference-extract.json>] [--strategy files|full] [--registry registry/index.json] [--style <manifest>] [--staging registry/staging] [--project-root .] [--mock-dir <dir>] [--force] [--skip-browser] [model options]',
  )
  process.exit(2)
}
if (!['new', 'extend', 'reference-verbatim'].includes(mode)) die(`unsupported mode ${mode}`)
if (!['files', 'full'].includes(strategy)) die(`strategy must be files or full, got ${strategy}`)
const FORWARDED_OPTIONS = new Set([
  '--config', '--zcode-config', '--zcode-provider', '--api', '--base-url', '--model',
  '--api-key-env', '--api-key-file', '--max-tokens', '--timeout-ms', '--auth',
])
const modelArgs = []
for (let i = 0; i < args.length; i += 1) {
  if (FORWARDED_OPTIONS.has(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
    modelArgs.push(args[i], args[i + 1])
    i += 1
  }
}
if (!modelArgs.includes('--max-tokens')) modelArgs.push('--max-tokens', '65536')
if (!modelArgs.includes('--timeout-ms')) modelArgs.push('--timeout-ms', '600000')

if (mode === 'reference-verbatim') {
  if (!extractManifest) die('reference-verbatim requires --extract-manifest <reference-extract.json>')
  const extracted = path.join(workDir, 'extracted')
  const extract = runNode([
    path.join(toolsDir, 'extract-reference-component.mjs'),
    '--extract', extractManifest,
    '--out', extracted,
    '--project-root', projectRoot,
    '--force',
  ], 'reference extraction', true)
  if (extract.status !== 0) die(`reference extraction failed (exit ${extract.status})\n${extract.stdout || ''}\n${extract.stderr || ''}`)
  // The fragment is an extraction/provenance artifact, not part of the
  // component package contract. Keep it next to the work bundle; the adapter
  // must inline any markup it actually needs.
  const referenceFragment = path.join(extracted, 'reference-fragment.html')
  if (fs.existsSync(referenceFragment)) {
    fs.copyFileSync(referenceFragment, path.join(workDir, 'reference-fragment.html'))
    fs.rmSync(referenceFragment)
  }
  const bundle = path.join(workDir, 'files.json')
  const convert = runNode([
    path.join(toolsDir, 'component-package-to-files.mjs'),
    '--package', extracted,
    '--out', bundle,
  ], 'reference package conversion', true)
  if (convert.status !== 0) die(`reference package conversion failed (exit ${convert.status})\n${convert.stdout || ''}\n${convert.stderr || ''}`)
  const applied = applyBundle(bundle)
  if (applied.status !== 0) die(`reference apply failed (exit ${applied.status})\n${applied.stdout || ''}\n${applied.stderr || ''}`)
  writeJson(reportPath, { schemaVersion: '1.0', componentId, mode, strategy: 'reference-verbatim', attempts: 1, files: bundle, staging: path.resolve(staging, componentId) })
  console.log(`OK component generation — ${componentId} reference-verbatim extracted`)
  console.log(applied.stdout.trim())
  process.exit(0)
}

const evidenceArgs = [
  buildEvidencePath,
  '--component', componentId,
  '--brief', briefPath,
  '--mode', mode,
  '--registry', registryPath,
  '--exemplar', exemplarId,
  '--out', evidencePath,
]
if (stylePath) evidenceArgs.push('--style', stylePath)
if (styleFullPath) evidenceArgs.push('--style-full', styleFullPath)
const built = runNode(evidenceArgs, 'build component evidence')
if (built.status !== 0) die(`build component evidence failed (exit ${built.status})`)
const baseEvidence = readData(evidencePath)

function mockFile(kind, attempt, target = '') {
  if (!mockDir) return ''
  const stem = kind === 'full' ? 'component-files' : `component-file-${String(target).replace(/[^a-zA-Z0-9._-]+/g, '-')}`
  const candidates = attempt > 1
    ? [path.join(mockDir, `${stem}-repair.json`), path.join(mockDir, `${stem}.json`)]
    : [path.join(mockDir, `${stem}.json`)]
  const found = candidates.find((file) => fs.existsSync(path.resolve(file)))
  if (!found) die(`mock response not found: ${candidates.join(', ')}`)
  return found
}
function callSingleShot(modeName, evidence, output, kind, target, attempt) {
  const attemptEvidence = attempt === 1 ? evidence : {
    ...evidence,
    repair: { errors, previous: raw },
  }
  const evidenceFile = path.join(
    workDir,
    kind === 'full'
      ? `evidence-attempt-${attempt}.json`
      : `evidence-${String(target).replace(/[^a-zA-Z0-9._-]+/g, '-')}-attempt-${attempt}.json`,
  )
  writeJson(evidenceFile, attemptEvidence)
  const callArgs = [
    singleShotPath, '--mode', modeName,
    '--evidence', evidenceFile,
    '--out', output,
    // The outer component loop owns repair attempts. Let each file request
    // fail once instead of multiplying 600 s timeouts inside one attempt.
    '--max-attempts', '1',
    ...modelArgs,
  ]
  const mock = mockFile(kind, attempt, target)
  if (mock) callArgs.push('--mock-response', mock)
  return runNode(callArgs, `component ${modeName} attempt ${attempt}`, true)
}
function applyBundle(bundlePath) {
  return runNode([
    applyPath,
    '--files', bundlePath,
    '--staging', staging,
    '--project-root', projectRoot,
    '--generate-baselines',
    '--sanitize-provenance',
    ...(force ? ['--force'] : []),
    ...(skipBrowser ? ['--skip-browser'] : []),
    ...(sandbox ? ['--sandbox'] : []),
  ], 'component apply', true)
}

if (!mockDir) {
  const config = runNode([singleShotPath, '--check-config', ...modelArgs], 'single-shot config')
  if (config.status !== 0) die(`single-shot config failed (exit ${config.status})`)
}

let errors = []
let raw = null
let attempts = 0
let lastFiles = new Map()
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  attempts = attempt
  let applied = null
  if (strategy === 'full') {
    const call = callSingleShot('component-files', baseEvidence, outPath, 'full', '', attempt)
    if (call.status !== 0) {
      errors = `${call.stdout || ''}\n${call.stderr || ''}`.trim().split(/\r?\n/).filter(Boolean)
    } else {
      raw = readData(outPath)
      applied = applyBundle(outPath)
      if (applied.status === 0) {
        writeJson(reportPath, { schemaVersion: '1.0', componentId, mode, strategy, attempts, files: outPath, staging: path.resolve(staging, componentId) })
        console.log(`OK component generation — ${componentId} ${mode}, ${attempts} attempt(s), strategy ${strategy}`)
        console.log(applied.stdout.trim())
        process.exit(0)
      }
      errors = `${applied.stdout || ''}\n${applied.stderr || ''}`.trim().split(/\r?\n/).filter(Boolean)
    }
  } else {
    // files strategy: manifest first, then one call per generated file.
    // On a retry, reuse files not named in the failure output and regenerate
    // only the file(s) the gate blamed.
    const failing = new Set()
    if (attempt > 1 && lastFiles.size) {
      for (const filePath of new Set([...lastFiles.keys(), 'component.json'])) {
        if (errors.some((line) => line.includes(filePath))) failing.add(filePath)
      }
      // A missing story state is a stories-file failure even though the error
      // names the baseline PNG, not the HTML file. Regenerate only stories and
      // keep the validated runtime/styles/tests from the previous attempt.
      if (errors.some((line) => /story state not found|FAIL capture baselines|capture baselines failed/i.test(line))) {
        for (const filePath of lastFiles.keys()) {
          if (filePath.startsWith('stories/')) failing.add(filePath)
        }
      }
    }
    const reuse = attempt > 1 && lastFiles.size > 0 && failing.size > 0
    const files = new Map()
    const callFile = (target) => {
      const evidence = {
        ...baseEvidence,
        filePath: target,
        fileKind: target === 'component.json' ? 'manifest' : target.split('/')[0],
        manifest: files.has('component.json') ? JSON.parse(files.get('component.json')) : null,
        generatedFiles: Object.fromEntries(files),
      }
      const out = path.join(workDir, `file-${target.replace(/[^a-zA-Z0-9._-]+/g, '-')}.json`)
      const call = callSingleShot('component-file', evidence, out, 'file', target, attempt)
      if (call.status !== 0) throw new Error(`${call.stdout || ''}\n${call.stderr || ''}`.trim())
      const file = readData(out)
      if (file.path !== target) throw new Error(`model returned ${file.path}, expected ${target}`)
      if (typeof file.content !== 'string' || !file.content.length) throw new Error(`${target}: empty content`)
      return file.content
    }
    try {
      const manifestText = reuse && lastFiles.has('component.json') && !failing.has('component.json')
        ? lastFiles.get('component.json')
        : callFile('component.json')
      files.set('component.json', manifestText)
      let manifest
      try {
        manifest = JSON.parse(manifestText)
      } catch (error) {
        throw new Error(`component.json: ${error.message}`)
      }
      const schema = validateWithSchema(
        fileURLToPath(new URL('../schemas/component-package.schema.json', import.meta.url)),
        manifest,
      )
      if (!schema.ok) throw new Error(`component.json schema:\n${schema.errors.join('\n')}`)
      if (manifest.id !== componentId) throw new Error(`component.json id ${manifest.id} != ${componentId}`)
      if (mode === 'extend' && baseEvidence.existing?.manifest?.version) {
        try {
          if (compareSemver(manifest.version, baseEvidence.existing.manifest.version) <= 0) {
            throw new Error(`component version ${manifest.version} must be greater than existing ${baseEvidence.existing.manifest.version}`)
          }
        } catch (error) {
          throw new Error(`component.json version: ${error.message}`)
        }
      }
      const targets = [...new Set([
        manifest.implementation,
        ...(manifest.styles || []),
        ...(manifest.tests || []),
        ...(manifest.stories || []),
      ].filter(Boolean))]
      if (!targets.length) throw new Error('manifest lists no implementation/styles/tests/stories files')
      for (const target of targets) {
        if (files.has(target)) continue
        if (reuse && lastFiles.has(target) && !failing.has(target)) {
          files.set(target, lastFiles.get(target))
        } else {
          files.set(target, callFile(target))
        }
      }
      // Extend keeps support files that the manifest does not list (for
      // example stories/fixtures.js). Regenerated manifest targets always win.
      if (mode === 'extend' && baseEvidence.existing?.files) {
        const allowed = /^(component\.json|runtime\.js|styles\.css|tests\/[A-Za-z0-9._-]+\.(mjs|js)|stories\/[A-Za-z0-9._/-]+\.(html|css|js)|assets\/[A-Za-z0-9._/-]+|baselines\/[A-Za-z0-9._-]+\.(png|jpg|jpeg|webp))$/
        for (const [filePath, content] of Object.entries(baseEvidence.existing.files)) {
          if (!files.has(filePath) && allowed.test(filePath) && typeof content === 'string') {
            files.set(filePath, content)
          }
        }
      }
      const bundle = {
        id: componentId,
        files: [...files].map(([filePath, content]) => ({ path: filePath, content })),
      }
      writeJson(outPath, bundle)
      raw = bundle
      // Keep this attempt's files so the next attempt can reuse every file
      // the gate did not blame.
      lastFiles = new Map(files)
      applied = applyBundle(outPath)
      if (applied.status === 0) {
        writeJson(reportPath, { schemaVersion: '1.0', componentId, mode, strategy, attempts, files: outPath, staging: path.resolve(staging, componentId) })
        console.log(`OK component generation — ${componentId} ${mode}, ${attempts} attempt(s), strategy ${strategy}, ${files.size} file(s)`)
        console.log(applied.stdout.trim())
        process.exit(0)
      }
      errors = `${applied.stdout || ''}\n${applied.stderr || ''}`.trim().split(/\r?\n/).filter(Boolean)
    } catch (error) {
      errors = String(error.message || error).trim().split(/\r?\n/).filter(Boolean)
    }
  }
  console.error(`component generation attempt ${attempt} failed:`)
  for (const error of errors) console.error(`  ${error}`)
}
die(`component ${componentId} is still invalid after ${attempts} attempt(s):\n${errors.map((error) => `  - ${error}`).join('\n')}`)
