#!/usr/bin/env node
import path from 'node:path'
import { recordComponentUsage } from './registry-lib.mjs'
import { fail, ok } from './lib.mjs'
import { assertScriptApproved, DEFAULT_SCRIPT_APPROVAL } from './approval-lib.mjs'

const args = process.argv.slice(2)
function option(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const registryPath = option('--registry')
const storyboardPath = option('--storyboard')
const lesson = option('--lesson')
const scriptPath = option('--script')
const approvalPath = option('--approval', DEFAULT_SCRIPT_APPROVAL)
if (!registryPath || !storyboardPath || !lesson) {
  console.error(
    'usage: node record-component-usage.mjs --registry <registry.json> --storyboard <storyboard.yml> --lesson <id> [--script <courseware.md>] [--approval review/script-approval.json]',
  )
  process.exit(2)
}
if (scriptPath) {
  try {
    assertScriptApproved(scriptPath, { approvalPath })
  } catch (error) {
    fail('component usage', [error.message])
    process.exit(1)
  }
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
