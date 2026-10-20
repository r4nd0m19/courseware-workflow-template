#!/usr/bin/env node
// One-command production build for the shell path.
//
// This wrapper exists because a lesson site must never be assembled with the
// shell's inline reference illustrations. `prepare-shell-site` is fail-closed
// by default, and this wrapper adds the art provenance gate, the component
// bundle, and the rendered shell/art checks in the only order that is safe.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { assertScriptApproved, DEFAULT_SCRIPT_APPROVAL } from './approval-lib.mjs'

const toolsDir = path.dirname(new URL(import.meta.url).pathname)
const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
function flag(name) { return args.includes(name) }

function usage() {
  console.error(
    'usage: node build-shell-site.mjs --script <courseware.md> --shell shells/<id> --deck <deck.json> --art <art-manifest.json> --out <site-dir> ' +
      '[--approval review/script-approval.json] [--narration <narration.json>] [--audio-dir <dir>] [--registry <registry.json>] [--staging <staging-dir>] [--force]',
  )
  process.exit(2)
}
function fail(message) {
  console.error(`FAIL ${message}`)
  process.exit(1)
}
function run(script, scriptArgs, label) {
  const result = spawnSync(process.execPath, [path.join(toolsDir, script), ...scriptArgs], { stdio: 'inherit' })
  if (result.error) fail(`${label}: ${result.error.message}`)
  if (result.status !== 0) fail(`${label} failed (exit ${result.status})`)
}

const shell = opt('--shell')
const deck = opt('--deck')
const art = opt('--art')
const out = opt('--out')
const script = opt('--script')
const approval = opt('--approval', DEFAULT_SCRIPT_APPROVAL)
const narration = opt('--narration')
const audioDir = opt('--audio-dir')
const registry = opt('--registry')
const staging = opt('--staging')
const force = flag('--force')

if (!shell || !deck || !out) usage()
if (!script) fail('--script is required: the lesson site may only be built from a hash-approved courseware.md')
try {
  assertScriptApproved(script, { approvalPath: approval })
} catch (error) {
  fail(`script approval: ${error.message}`)
}
if (!art) fail('--art is required: every lesson illustration slot must be generated for this lesson (run generate-shell-art.mjs)')
if (!fs.existsSync(art)) fail(`art manifest not found: ${art}`)
if (!fs.existsSync(deck)) fail(`deck not found: ${deck}`)

// 1. Provenance gate before any file is copied.
run('check-shell-art.mjs', ['--shell', shell, '--art', art, '--require-all'], 'shell art gate')

// 2. Assemble the site. prepare-shell-site is fail-closed on missing art.
const prepareArgs = [
  '--shell', shell,
  '--deck', deck,
  '--art', art,
  '--out', out,
]
if (narration) prepareArgs.push('--narration', narration)
if (audioDir) prepareArgs.push('--audio-dir', audioDir)
if (force) prepareArgs.push('--force')
run('prepare-shell-site.mjs', prepareArgs, 'prepare-shell-site')

// 3. Inject the component bundle and host, then verify the rendered site.
if (registry) {
  const bundleArgs = [
    '--registry', registry,
    '--out', path.join(out, 'components.bundle.js'),
    '--css-out', path.join(out, 'components.bundle.css'),
    '--site', out,
  ]
  if (staging) bundleArgs.push('--staging', staging)
  // The shell copy starts without generated files, so write them first and
  // then verify the just-written bundle against the registry.
  run('sync-deck-components.mjs', bundleArgs, 'sync-deck-components')
  run('sync-deck-components.mjs', [...bundleArgs, '--check'], 'sync-deck-components check')
}
run('check-shell.mjs', ['--shell', shell, '--site', out, '--require-art'], 'shell site gate')
run('check-shell-art.mjs', ['--shell', shell, '--art', art, '--site', out, '--require-all'], 'shell art site gate')

console.log(`OK shell lesson site — ${out}`)
