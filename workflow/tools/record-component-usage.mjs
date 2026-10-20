#!/usr/bin/env node
import path from 'node:path'
import { recordComponentUsage } from './registry-lib.mjs'
import { fail, ok } from './lib.mjs'

const args = process.argv.slice(2)
function option(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const registryPath = option('--registry')
const storyboardPath = option('--storyboard')
const lesson = option('--lesson')
if (!registryPath || !storyboardPath || !lesson) {
  console.error(
    'usage: node record-component-usage.mjs --registry <registry.json> --storyboard <storyboard.yml> --lesson <id>',
  )
  process.exit(2)
}
try {
  const result = recordComponentUsage({
    registryPath: path.resolve(registryPath),
    storyboardPath: path.resolve(storyboardPath),
    lesson,
  })
  if (result.changes.length === 0) {
    ok('component usage', 'no change')
  } else {
    ok('component usage', `${result.changes.join(', ')} → ${lesson} (registry ${result.registryVersion})`)
  }
} catch (err) {
  fail('component usage', [err.message])
  process.exit(1)
}
