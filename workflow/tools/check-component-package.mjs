#!/usr/bin/env node
import path from 'node:path'
import fs from 'node:fs'
import { fail, ok } from './lib.mjs'
import { inspectPackage } from './registry-lib.mjs'

const args = process.argv.slice(2)
const projectRootIndex = args.indexOf('--project-root')
const projectRoot =
  projectRootIndex >= 0 && args[projectRootIndex + 1] ? path.resolve(args[projectRootIndex + 1]) : ''
const positional = args.filter(
  (a, i) => !a.startsWith('--') && !(projectRootIndex >= 0 && i === projectRootIndex + 1),
)
const target = positional[0]
if (!target) {
  console.error('usage: node check-component-package.mjs <package-dir-or-component.json> [--project-root <dir>]')
  process.exit(2)
}
const packageDir = fs.statSync(target).isDirectory()
  ? path.resolve(target)
  : path.dirname(path.resolve(target))
const { errors, warnings, manifest } = inspectPackage(packageDir, { projectRoot })
if (errors.length) {
  fail('component package', errors)
  for (const w of warnings) console.error(`WARN ${w}`)
  process.exit(1)
}
ok(
  'component package',
  `${manifest.id}@${manifest.version} (${manifest.status}, ${manifest.category}, ${manifest.interactionLevels.join('/')})`,
)
for (const w of warnings) console.log(`WARN ${w}`)
