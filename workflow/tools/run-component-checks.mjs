#!/usr/bin/env node
// Deterministic acceptance checks for one staged component package.
//
// This is the component-generation gate: manifest contract, package files,
// package tests and (when present) browser interaction tests. Story HTML and
// baselines are required by the package checker; tests exercise the stories.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { readData } from './lib.mjs'

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
const packageDir = path.resolve(opt('--package'))
const projectRoot = path.resolve(opt('--project-root', process.cwd()))
const skipBrowser = flag('--skip-browser')
const sandbox = flag('--sandbox')
if (!opt('--package')) {
  console.error('usage: node run-component-checks.mjs --package <component-dir> [--project-root <dir>] [--skip-browser] [--sandbox]')
  process.exit(2)
}
const manifestPath = path.join(packageDir, 'component.json')
if (!fs.existsSync(manifestPath)) {
  console.error(`FAIL component checks — ${manifestPath} not found`)
  process.exit(1)
}
const manifest = readData(manifestPath)
const run = (label, command, commandArgs, options = {}) => {
  console.log(`\n== ${label}`)
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || packageDir,
    stdio: 'inherit',
    timeout: options.timeout || 120000,
    env: { ...process.env, ...(options.env || {}) },
  })
  if (result.error) {
    console.error(`FAIL ${label}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`FAIL ${label} (exit ${result.status})`)
    process.exit(result.status || 1)
  }
}

run('component package contract', process.execPath, [
  path.join(projectRoot, 'workflow/tools/check-component-package.mjs'),
  packageDir,
  '--project-root', projectRoot,
])

const testFiles = (manifest.tests || [])
  .map((relative) => path.resolve(packageDir, relative))
  .filter((file) => fs.existsSync(file))
  .filter((file) => {
    if (!skipBrowser) return true
    const text = fs.readFileSync(file, 'utf8')
    return !/playwright|chromium/i.test(text)
  })
if (!testFiles.length) {
  console.error('FAIL component checks — no runnable test files')
  process.exit(1)
}
if (!sandbox) {
  run('component tests', process.execPath, ['--test', ...testFiles], {
    cwd: packageDir,
    env: { COURSEWARE_PROJECT_ROOT: projectRoot },
  })
} else {
  const bwrap = ['/usr/bin/bwrap', '/bin/bwrap'].find((file) => fs.existsSync(file))
  if (!bwrap) {
    console.error('FAIL component checks — --sandbox requires bubblewrap (bwrap)')
    process.exit(1)
  }
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-component-sandbox-'))
  const sandboxPackage = `/project/registry/staging/${manifest.id}`
  const bind = [
    '--dir', '/project',
    '--dir', '/project/registry',
    '--dir', '/project/registry/staging',
    '--dir', '/project/workflow',
  ]
  for (const dir of ['/usr', '/bin', '/lib', '/lib64', '/etc', '/sys']) {
    if (fs.existsSync(dir)) bind.push('--ro-bind', dir, dir)
  }
  bind.push('--dir', '/root')
  if (fs.existsSync('/root/.nvm')) bind.push('--ro-bind', '/root/.nvm', '/root/.nvm')
  if (fs.existsSync(path.join(projectRoot, 'workflow/tools'))) {
    bind.push('--ro-bind', path.join(projectRoot, 'workflow/tools'), '/project/workflow/tools')
  }
  const chromeFile = path.join(projectRoot, 'workflow/tools/chrome-path.txt')
  const chromePath = fs.existsSync(chromeFile) ? fs.readFileSync(chromeFile, 'utf8').trim() : ''
  if (chromePath && fs.existsSync(chromePath)) {
    const chromeDir = path.dirname(chromePath)
    let current = '/'
    for (const part of chromeDir.split('/').filter(Boolean).slice(0, -1)) {
      current = current === '/' ? `/${part}` : `${current}/${part}`
      bind.push('--dir', current)
    }
    bind.push('--ro-bind', chromeDir, chromeDir)
  }
  bind.push('--ro-bind', packageDir, sandboxPackage)
  const sandboxTests = testFiles.map((file) => path.join(sandboxPackage, path.relative(packageDir, file)))
  const nodePath = path.dirname(process.execPath)
  const bwrapArgs = [
    '--die-with-parent',
    '--unshare-all',
    '--new-session',
    '--clearenv',
    ...bind,
    '--dev', '/dev',
    '--proc', '/proc',
    '--tmpfs', '/tmp',
    '--dir', '/tmp/home',
    '--setenv', 'PATH', `${nodePath}:/usr/local/bin:/usr/bin:/bin`,
    '--setenv', 'HOME', '/tmp/home',
    '--setenv', 'COURSEWARE_PROJECT_ROOT', '/project',
    '--chdir', '/project',
    process.execPath,
    '--test',
    ...sandboxTests,
  ]
  try {
    run('component tests (sandbox)', bwrap, bwrapArgs, { cwd: sandboxRoot })
  } finally {
    fs.rmSync(sandboxRoot, { recursive: true, force: true })
  }
}

console.log(`\nOK component checks — ${manifest.id}@${manifest.version}, ${testFiles.length} test file(s)`)
