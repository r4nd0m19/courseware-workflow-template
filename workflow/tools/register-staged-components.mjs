#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { loadRegistry, registerPackage } from './registry-lib.mjs'
import { fail, ok } from './lib.mjs'
import { assertScriptApproved, DEFAULT_SCRIPT_APPROVAL } from './approval-lib.mjs'
import { pageGateApproval, requireProductionRun } from './review-guard.mjs'

const args = process.argv.slice(2)
function option(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const registryPath = option('--registry')
const lesson = option('--lesson')
const approvedBy = option('--approved-by')
const projectRoot = option('--project-root')
const stagingArg = option('--staging')
const onlyArg = option('--only')
const only = new Set(onlyArg.split(',').map((s) => s.trim()).filter(Boolean))
const scriptPath = option('--script')
const approvalPath = option('--approval', DEFAULT_SCRIPT_APPROVAL)
const sectionId = option('--section')
const manual = args.includes('--manual')
const clean = args.includes('--clean')
const dryRun = args.includes('--dry-run')
if (!registryPath) {
  console.error(
    'usage: node register-staged-components.mjs --registry <registry.json> [--staging <dir>] [--only <id,id>] [--lesson <id>] [--approved-by <name>] [--project-root <dir>] [--script <courseware.md>] [--approval review/script-approval.json] [--section <id>] [--clean] [--dry-run] [--manual]',
  )
  process.exit(2)
}
if (!manual) {
  requireProductionRun({ tool: 'register-staged-components', manual })
  const approval = pageGateApproval({ sectionId })
  if (!approval.ok) {
    fail('component registration', [
      `${approval.reason}; register components only after the review-page gate approves that page`,
    ])
    process.exit(1)
  }
}
if (scriptPath) {
  try {
    assertScriptApproved(scriptPath, { approvalPath })
  } catch (error) {
    fail('component registration', [error.message])
    process.exit(1)
  }
}

let loaded
try {
  loaded = loadRegistry(registryPath)
} catch (err) {
  fail('component registration', [err.message])
  process.exit(1)
}
const stagingDir = stagingArg
  ? path.resolve(stagingArg)
  : path.join(loaded.registryDir, 'staging')
if (!fs.existsSync(stagingDir)) {
  ok('staged components', 'none')
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

const results = []
const errors = []
for (const dir of packages) {
  const manifestFile = path.join(dir, 'component.json')
  let manifestId = ''
  try {
    manifestId = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).id || ''
  } catch {
    errors.push(`${path.basename(dir)}: invalid component.json`)
    continue
  }
  if (only.size && !only.has(manifestId)) continue
  try {
    results.push(
      registerPackage({
        registryPath,
        packageDir: dir,
        lesson,
        approvedBy,
        update: true,
        dryRun,
        projectRoot: projectRoot ? path.resolve(projectRoot) : '',
      }),
    )
    if (clean && !dryRun) fs.rmSync(dir, { recursive: true, force: true })
  } catch (err) {
    errors.push(`${path.basename(dir)}: ${err.message}`)
  }
}
if (errors.length) {
  fail('component registration', errors)
  process.exit(1)
}
ok(
  `staged components ${dryRun ? 'would be registered' : 'registered'}`,
  results.map((r) => `${r.id}@${r.version} (registry ${r.registryVersion})`).join(', '),
)
