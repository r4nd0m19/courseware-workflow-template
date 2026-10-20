#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const workflowSource = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)

function flag(name) {
  return argv.includes(name)
}
function option(name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
function help() {
  console.log(`Usage: node workflow/install.mjs [options]

One-click install for the courseware workflow (harness-agnostic).

Options:
  --integration <claude|codex>  Spec Kit integration (default: claude)
  --project <path>              Project root (default: parent of workflow/)
  --force                       Re-copy workflow/ and re-init if needed
  --skip-deps                   Skip npm install for workflow/tools
  --no-smoke                    Skip post-install smoke tests
  --dry-run                     Print commands without executing
  -h, --help                    Show this help

Run from the courseware repo, or pass --project for another Spec Kit project.
`)
  process.exit(0)
}
if (flag('-h') || flag('--help')) help()

const integration = option('--integration', 'claude')
if (!['claude', 'codex'].includes(integration)) {
  console.error(`Unsupported integration "${integration}". Use claude or codex.`)
  process.exit(2)
}
const projectRoot = path.resolve(option('--project', path.resolve(workflowSource, '..')))
const force = flag('--force')
const skipDeps = flag('--skip-deps')
const noSmoke = flag('--no-smoke')
const dryRun = flag('--dry-run')

// Ensure the project root exists before any command runs with it as cwd.
if (!dryRun) fs.mkdirSync(projectRoot, { recursive: true })

function log(msg) {
  console.log(`\n== ${msg}`)
}
function run(cmd, args, opts = {}) {
  const cwd = opts.cwd || projectRoot
  console.log(`$ (${path.relative(process.cwd(), cwd) || '.'}) ${cmd} ${args.join(' ')}`)
  if (dryRun) return { status: 0 }
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...(opts.env || {}) },
    shell: process.platform === 'win32',
  })
  if (res.error) {
    console.error(`Failed to start ${cmd}: ${res.error.message}`)
    process.exit(1)
  }
  if (res.status !== 0) {
    console.error(`${cmd} exited with code ${res.status}`)
    process.exit(res.status || 1)
  }
  return res
}
function capture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd || projectRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env || {}) },
    shell: process.platform === 'win32',
  })
  return { status: res.status, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim() }
}
function copyWorkflow() {
  const dest = path.join(projectRoot, 'workflow')
  if (path.resolve(dest) === path.resolve(workflowSource)) {
    console.log('workflow/ already in project root; no copy needed')
    return dest
  }
  if (dryRun) {
    console.log(`would copy workflow/ -> ${dest}`)
    return dest
  }
  if (fs.existsSync(dest)) {
    if (!force) {
      console.log('workflow/ already exists in project; keeping it (use --force to overwrite)')
      return dest
    }
    fs.rmSync(dest, { recursive: true, force: true })
  }
  fs.mkdirSync(projectRoot, { recursive: true })
  fs.cpSync(workflowSource, dest, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(workflowSource, src)
      return !rel.split(path.sep).includes('node_modules') && !rel.split(path.sep).includes('.venv')
    },
  })
  console.log(`copied workflow/ -> ${dest}`)
  return dest
}

if (Number(process.versions.node.split('.')[0]) < 18) {
  console.error(`Node >= 18 required, found ${process.versions.node}`)
  process.exit(2)
}

const spec = capture('specify', ['--version'], { cwd: process.cwd() })
if (spec.status !== 0) {
  console.error('Spec Kit CLI (specify) not found on PATH.')
  console.error('Install it first, e.g.: pipx install specify-cli')
  process.exit(2)
}
console.log(`Spec Kit: ${spec.stdout || 'detected'}`)

const workflowDir = copyWorkflow()
const toolsDir = path.join(workflowDir, 'tools')
const presetDir = path.join(workflowDir, 'preset')
const workflowYaml = path.join(workflowDir, 'workflows/courseware-production.yml')
const specifyEnv = { SPECIFY_INIT_DIR: projectRoot }

log('Spec Kit project')
if (!fs.existsSync(path.join(projectRoot, '.specify'))) {
  run('specify', ['init', '.', '--integration', integration, '--non-interactive', '--force'])
} else {
  console.log(`.specify already exists; keeping current integration (requested: ${integration})`)
  console.log(
    `To add ${integration} alongside the current integration: specify integration install ${integration}`,
  )
}

log('Install preset')
run('specify', ['preset', 'add', '--dev', presetDir], { env: specifyEnv })

log('Install workflow')
run('specify', ['workflow', 'add', '--dev', workflowYaml], { env: specifyEnv })

if (!skipDeps) {
  log('Install workflow tool dependencies')
  const hasLock = fs.existsSync(path.join(toolsDir, 'package-lock.json'))
  run('npm', [hasLock ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd: toolsDir })
} else {
  console.log('skipped tool dependencies (--skip-deps)')
}

log('Detect Chromium for overflow gate')
const chromeCandidates = [
  process.env.CHROME_PATH,
  path.join(os.homedir(), '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean)
const chrome = chromeCandidates.find((p) => {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
})
if (chrome) {
  if (!dryRun) fs.writeFileSync(path.join(toolsDir, 'chrome-path.txt'), chrome + '\n')
  console.log(`using CHROME_PATH=${chrome}`)
} else {
  console.warn('Chromium not found. Set CHROME_PATH or install Playwright Chromium:')
  console.warn(`  cd ${toolsDir} && npx playwright install chromium`)
}

if (!noSmoke) {
  log('Smoke tests')
  run(process.execPath, [path.join(toolsDir, 'smoke-test.mjs')])
  run('specify', ['workflow', 'info', 'courseware-production'], { env: specifyEnv })
} else {
  console.log('skipped smoke tests (--no-smoke)')
}

log('Done')
console.log(`Project:    ${projectRoot}`)
console.log(`Integration:${integration}`)
console.log(`Preset:     ${presetDir}`)
console.log(`Workflow:   ${workflowYaml}`)
console.log(`Tools:      ${toolsDir}`)
console.log('\nNext:')
console.log('  1. Put the content reference through R0-C to produce content-pack.json')
console.log('  2. Run: specify workflow run courseware-production -i integration=' + integration + ' -i lesson=... -i content_pack=... -i courseware_script=... -i review_sections=... -i component_registry=registry/index.json -i storyboard=... -i style_pack=... -i deck_url=... -i page_count=...')
console.log('  3. The workflow creates/validates registry/, writes courseware.md via speckit.script, and projects storyboard.yml from it.')
console.log('  4. Keep workflow/tools/node_modules and chrome-path.txt out of git.')
