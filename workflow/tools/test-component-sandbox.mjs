#!/usr/bin/env node
// Verify that model-authored tests run with the repository hidden.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const tools = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(tools, '../..')
const bwrap = ['/usr/bin/bwrap', '/bin/bwrap'].find((file) => fs.existsSync(file))
if (!bwrap) {
  console.log('SKIP component sandbox (bwrap not installed)')
  process.exit(0)
}
const staging = fs.mkdtempSync(path.join(root, 'registry', '.tmp-component-sandbox-'))
const packageDir = path.join(staging, 'code-anatomy')
try {
  fs.cpSync(path.join(root, 'registry/components/code-anatomy'), packageDir, { recursive: true })
  const manifestPath = path.join(packageDir, 'component.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.tests = [...manifest.tests, 'tests/sandbox.spec.mjs']
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  const hostRoot = path.resolve(tools, '../..')
  fs.writeFileSync(
    path.join(packageDir, 'tests/sandbox.spec.mjs'),
    `import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('sandbox hides the repository but exposes tools', () => {
  assert.equal(fs.existsSync(${JSON.stringify(hostRoot)}), false)
  assert.equal(fs.existsSync('/project/workflow/tools/run-component-checks.mjs'), true)
})
`,
  )
  const result = spawnSync(process.execPath, [
    path.join(tools, 'run-component-checks.mjs'),
    '--package', packageDir,
    '--project-root', root,
    '--sandbox',
  ], { encoding: 'utf8', cwd: root })
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr)
    process.exit(1)
  }
  assert.match(result.stdout, /sandbox hides the repository/)
  console.log('PASS component test sandbox')
} finally {
  fs.rmSync(staging, { recursive: true, force: true })
}
