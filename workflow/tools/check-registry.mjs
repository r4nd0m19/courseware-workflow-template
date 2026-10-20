#!/usr/bin/env node
import path from 'node:path'
import { fail, ok } from './lib.mjs'
import { loadRegistryPackages } from './registry-lib.mjs'

const args = process.argv.slice(2)
function option(name) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : ''
}
const registryPath = args.find((a) => !a.startsWith('--') && a !== option('--style-pack') && a !== option('--project-root'))
const stylePackPath = option('--style-pack')
const projectRoot = option('--project-root')
if (!registryPath) {
  console.error('usage: node check-registry.mjs <registry.json> [--style-pack <manifest>] [--project-root <dir>]')
  process.exit(2)
}

let loaded
try {
  loaded = loadRegistryPackages(path.resolve(registryPath), {
    stylePackPath: stylePackPath ? path.resolve(stylePackPath) : '',
    projectRoot: projectRoot ? path.resolve(projectRoot) : '',
  })
} catch (err) {
  fail('component registry', [err.message])
  process.exit(1)
}

const errors = []
const warnings = []
for (const pkg of loaded.packages) {
  for (const e of pkg.errors) errors.push(`component ${pkg.entry.id}: ${e}`)
  for (const w of pkg.warnings) warnings.push(`component ${pkg.entry.id}: ${w}`)
  if (!pkg.manifest) continue
  if (pkg.manifest.id !== pkg.entry.id) {
    errors.push(`registry entry ${pkg.entry.id} points to package ${pkg.manifest.id}`)
  }
  if (pkg.manifest.version !== pkg.entry.version) {
    errors.push(`registry entry ${pkg.entry.id} version ${pkg.entry.version} != package ${pkg.manifest.version}`)
  }
  if (pkg.manifest.status !== pkg.entry.status) {
    errors.push(`registry entry ${pkg.entry.id} status ${pkg.entry.status} != package ${pkg.manifest.status}`)
  }
  const expectedPackage = `components/${pkg.entry.id}`
  if (pkg.entry.package !== expectedPackage) {
    warnings.push(`registry entry ${pkg.entry.id} package is "${pkg.entry.package}" (expected "${expectedPackage}")`)
  }
}

const summary = `${loaded.index.components.length} component(s), registry ${loaded.index.registryId}@${loaded.index.version}, style pack ${loaded.index.stylePack.id}@${loaded.index.stylePack.version}`
if (errors.length) {
  fail('component registry', errors)
  for (const w of warnings) console.error(`WARN ${w}`)
  process.exit(1)
}
ok('component registry', summary)
for (const w of warnings) console.log(`WARN ${w}`)
