#!/usr/bin/env node
import path from 'node:path'
import { registerPackage } from './registry-lib.mjs'
import { fail, ok } from './lib.mjs'

const args = process.argv.slice(2)
function option(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const packageDir = option('--package')
const registryPath = option('--registry')
const lesson = option('--lesson')
const approvedBy = option('--approved-by')
const projectRoot = option('--project-root')
const update = args.includes('--update')
const dryRun = args.includes('--dry-run')
if (!packageDir || !registryPath) {
  console.error(
    'usage: node register-component.mjs --package <dir> --registry <registry.json> [--lesson <id>] [--approved-by <name>] [--project-root <dir>] [--update] [--dry-run]',
  )
  process.exit(2)
}
try {
  const result = registerPackage({
    registryPath,
    packageDir: path.resolve(packageDir),
    lesson,
    approvedBy,
    update,
    dryRun,
    projectRoot: projectRoot ? path.resolve(projectRoot) : '',
  })
  const verb = result.updated ? 'updated' : 'registered'
  ok(
    `component ${dryRun ? `would be ${verb}` : verb}`,
    `${result.id}@${result.version} → registry ${result.registryVersion}${dryRun ? ' (dry run)' : ''}`,
  )
} catch (err) {
  fail('component registration', [err.message])
  process.exit(1)
}
