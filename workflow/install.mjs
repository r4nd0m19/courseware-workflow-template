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
  --integration <claude|codex|zcode>  Spec Kit integration (default: claude)
  --project <path>              Project root (default: parent of workflow/)
  --force                       Re-copy workflow/ and re-init if needed
  --skip-deps                   Skip npm install for workflow/tools
  --no-smoke                    Skip post-install smoke tests
  --no-zcode                    Do not remove the legacy ZCode approval server entry
                                (review gates no longer use the MCP panel)
  --dry-run                     Print commands without executing
  -h, --help                    Show this help

Run from the courseware repo, or pass --project for another Spec Kit project.
`)
  process.exit(0)
}
if (flag('-h') || flag('--help')) help()

const integration = option('--integration', 'claude')
if (!['claude', 'codex', 'zcode'].includes(integration)) {
  console.error(`Unsupported integration "${integration}". Use claude, codex, or zcode.`)
  process.exit(2)
}
const projectRoot = path.resolve(option('--project', path.resolve(workflowSource, '..')))
const force = flag('--force')
const skipDeps = flag('--skip-deps')
const noSmoke = flag('--no-smoke')
const dryRun = flag('--dry-run')
const noZcode = flag('--no-zcode')

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
      // Windows Node passes `\\?\`-prefixed paths to the filter; path.relative
      // against the plain source root would return the absolute path instead
      // of the relative one. Strip the prefix before comparing.
      const normalize = (value) => {
        let p = String(value)
        if (process.platform === 'win32' && p.startsWith('\\\\?\\')) {
          p = p.slice(4)
          if (p.startsWith('UNC\\')) p = `\\\\${p.slice(4)}`
        }
        return path.resolve(p)
      }
      const rel = path.relative(normalize(workflowSource), normalize(src))
      const parts = rel.split(path.sep)
      if (path.isAbsolute(rel) || parts.includes('..')) return false
      return !parts.includes('node_modules') && !parts.includes('.venv')
    },
  })
  console.log(`copied workflow/ -> ${dest}`)
  return dest
}

// Spec Kit loads custom step types from .specify/workflows/steps/<dir>/ before
// `workflow add` validates a YAML, so the gui-gate package must be installed
// first. Copy regular files: Spec Kit refuses symlinked step packages.
function installGuiGateStep() {
  const src = path.join(workflowDir, 'steps', 'gui-gate')
  const dest = path.join(projectRoot, '.specify', 'workflows', 'steps', 'gui-gate')
  const files = ['step.yml', '__init__.py']
  for (const name of files) {
    if (!fs.existsSync(path.join(src, name))) {
      console.error(`gui-gate step package is incomplete: missing ${path.join(src, name)}`)
      process.exit(1)
    }
  }
  if (dryRun) {
    console.log(`would install gui-gate step -> ${dest}`)
    return
  }
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  for (const name of files) fs.copyFileSync(path.join(src, name), path.join(dest, name))
  console.log(`installed gui-gate step -> ${dest}`)
}

// Early versions configured a ZCode MCP App approval panel. Review gates now
// use a review file/link plus the harness's native question UI, so remove the
// stale server entry (and only that entry) from an existing workspace config.
function cleanupZcodeConfig() {
  if (noZcode) {
    console.log('left .zcode/config.json untouched (--no-zcode)')
    return
  }
  const configPath = path.join(projectRoot, '.zcode', 'config.json')
  if (!fs.existsSync(configPath)) {
    console.log('no .zcode/config.json; nothing to clean up')
    return
  }
  let config
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (error) {
    console.error(`refusing to edit unparseable ${configPath}: ${error.message}`)
    process.exit(1)
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    console.error(`refusing to edit ${configPath}: expected a JSON object`)
    process.exit(1)
  }
  const servers = config.mcp && config.mcp.servers
  if (
    !servers ||
    typeof servers !== 'object' ||
    Array.isArray(servers) ||
    !('courseware-approval' in servers)
  ) {
    console.log('no legacy courseware-approval MCP server entry; nothing to clean up')
    return
  }
  delete servers['courseware-approval']
  if (dryRun) {
    console.log(`would remove legacy courseware-approval from ${configPath}`)
    return
  }
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  console.log(`removed legacy courseware-approval MCP server from ${configPath}`)
}

if (Number(process.versions.node.split('.')[0]) < 18) {
  console.error(`Node >= 18 required, found ${process.versions.node}`)
  process.exit(2)
}

const specifyBin = process.env.SPECIFY_BIN || 'specify'
const spec = capture(specifyBin, ['--version'], { cwd: process.cwd() })
if (spec.status !== 0) {
  console.error(`Spec Kit CLI not found (${specifyBin}).`)
  console.error('Install it first, e.g.: pipx install specify-cli')
  console.error('If it is installed but not on PATH, set SPECIFY_BIN to the specify executable.')
  process.exit(2)
}
console.log(`Spec Kit: ${spec.stdout || 'detected'}`)

// The zcode integration dispatches workflow prompt/command steps through the
// ZCode CLI (`zcode -p`). Warn early instead of letting AI steps fail later.
if (integration === 'zcode') {
  const zcodeCli = capture(process.platform === 'win32' ? 'where.exe' : 'which', ['zcode'])
  if (zcodeCli.status !== 0) {
    console.warn(
      'zcode CLI was not found on PATH. Install the ZCode CLI and ensure `zcode -p` works before running workflow prompt steps.',
    )
  } else {
    console.log(`ZCode CLI: ${zcodeCli.stdout}`)
  }
}

const workflowDir = copyWorkflow()
const startHereSource = path.join(workflowSource, 'START-HERE.md')
const startHereTarget = path.join(projectRoot, 'START-HERE.md')
if (fs.existsSync(startHereSource) && !fs.existsSync(startHereTarget)) {
  if (!dryRun) fs.copyFileSync(startHereSource, startHereTarget)
  console.log(`installed START-HERE.md -> ${startHereTarget}`)
}
const toolsDir = path.join(workflowDir, 'tools')
const presetDir = path.join(workflowDir, 'preset')
const workflowYaml = path.join(workflowDir, 'workflows/courseware-production.yml')
const specifyEnv = { SPECIFY_INIT_DIR: projectRoot }

log('Spec Kit project')
if (!fs.existsSync(path.join(projectRoot, '.specify'))) {
  run(specifyBin, ['init', '.', '--integration', integration, '--non-interactive', '--force'])
} else {
  console.log(`.specify already exists; keeping current integration (requested: ${integration})`)
  console.log(
    `To add ${integration} alongside the current integration: specify integration install ${integration}`,
  )
}

log('Install gui-gate step type')
installGuiGateStep()

log('Install preset')
// `preset add` refuses to replace an installed preset. `preset update` is the
// supported remove-and-add path in both Spec Kit 1.0.x and 1.2.x, so use it
// when re-running the installer.
const presetInstalled = fs.existsSync(path.join(projectRoot, '.specify', 'presets', 'courseware'))
const presetArgs = presetInstalled
  ? ['preset', 'update', 'courseware', '--dev', presetDir]
  : ['preset', 'add', '--dev', presetDir]
run(specifyBin, presetArgs, { env: specifyEnv })

log('Install workflow')
run(specifyBin, ['workflow', 'add', '--dev', workflowYaml], { env: specifyEnv })

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

log('Clean up legacy ZCode approval server')
cleanupZcodeConfig()

if (!noSmoke) {
  log('Smoke tests')
  run(process.execPath, [path.join(toolsDir, 'smoke-test.mjs')])
  run(specifyBin, ['workflow', 'info', 'courseware-production'], { env: specifyEnv })
} else {
  console.log('skipped smoke tests (--no-smoke)')
}

log('Done')
console.log(`Project:    ${projectRoot}`)
console.log(`Integration:${integration}`)
console.log(`Preset:     ${presetDir}`)
console.log(`Workflow:   ${workflowYaml}`)
console.log(`Tools:      ${toolsDir}`)
console.log('\nNext (teacher-facing):')
console.log('  1. No restart is needed. Open START-HERE.md or tell the agent: "开始做课件".')
console.log('  2. Put the lesson notes / webpage / Word / PDF / images in the project; the agent handles the rest.')
console.log('  3. When the agent asks for a choice, click "通过，继续" or "不通过，需要改".')
console.log('\nAgent-only details: see AGENTS.md and workflow/README.md (do not show them to the teacher).')
