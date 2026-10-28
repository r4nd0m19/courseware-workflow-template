#!/usr/bin/env node
// Capture component story baselines named <story>-<width>x<height>.png.
// New generated components have no model-authored PNGs; Node captures the
// deterministic story states before the package gate runs.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readData } from './lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
const flag = (name) => args.includes(name)
const packageDir = path.resolve(opt('--package'))
const projectRoot = path.resolve(opt('--project-root', process.cwd()))
const onlyMissing = flag('--only-missing')
const sandbox = flag('--sandbox')
if (!opt('--package')) {
  console.error('usage: node capture-component-baselines.mjs --package <component-dir> [--project-root <dir>] [--only-missing] [--sandbox]')
  process.exit(2)
}
const manifest = readData(path.join(packageDir, 'component.json'))
const targets = []
for (const baseline of manifest.baselines || []) {
  const name = path.basename(baseline)
  const match = name.match(/^(.*)-(\d+)x(\d+)\.png$/)
  if (!match) {
    console.error(`FAIL capture baselines — cannot parse baseline name ${baseline} (expected <story>-<width>x<height>.png)`)
    process.exit(1)
  }
  const absolute = path.resolve(packageDir, baseline)
  if (onlyMissing && fs.existsSync(absolute)) continue
  targets.push({ story: match[1], width: Number(match[2]), height: Number(match[3]), file: absolute })
}
if (!targets.length) {
  console.log('OK capture baselines — nothing missing')
  process.exit(0)
}

if (sandbox && process.env.COURSEWARE_SANDBOX_CHILD !== '1') {
  const bwrap = ['/usr/bin/bwrap', '/bin/bwrap'].find((file) => fs.existsSync(file))
  if (!bwrap) {
    console.error('FAIL capture baselines — --sandbox requires bubblewrap (bwrap)')
    process.exit(1)
  }
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-baseline-sandbox-'))
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
  // The package is writable inside the sandbox so screenshots can land there.
  bind.push('--bind', packageDir, sandboxPackage)
  const nodePath = path.dirname(process.execPath)
  const result = spawnSync(bwrap, [
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
    '--setenv', 'COURSEWARE_SANDBOX_CHILD', '1',
    '--chdir', '/project',
    process.execPath,
    '/project/workflow/tools/capture-component-baselines.mjs',
    '--package', sandboxPackage,
    '--project-root', '/project',
    '--only-missing',
  ], { encoding: 'utf8', cwd: sandboxRoot })
  if (result.status !== 0) {
    console.error(result.stdout || '')
    console.error(result.stderr || '')
    fs.rmSync(sandboxRoot, { recursive: true, force: true })
    console.error('FAIL capture baselines — sandbox run failed')
    process.exit(1)
  }
  process.stdout.write(result.stdout || '')
  fs.rmSync(sandboxRoot, { recursive: true, force: true })
  process.exit(0)
}

const requireFromTools = createRequire(path.join(projectRoot, 'workflow/tools/package.json'))
const { chromium } = requireFromTools('playwright-core')
const chromeFile = path.join(projectRoot, 'workflow/tools/chrome-path.txt')
const executablePath = fs.existsSync(chromeFile)
  ? fs.readFileSync(chromeFile, 'utf8').trim()
  : process.env.CHROME_PATH || undefined
const stories = (manifest.stories || []).map((relative) => path.resolve(packageDir, relative))
const done = new Set()
const browser = await chromium.launch({ executablePath, headless: true })
try {
  for (const storyFile of stories) {
    if (!fs.existsSync(storyFile)) continue
    const page = await browser.newPage()
    await page.goto(pathToFileURL(storyFile).href)
    await page.waitForFunction(() => window.__storiesReady === true || document.querySelector('[data-story]'), { timeout: 5000 }).catch(() => {})
    for (const target of targets) {
      if (done.has(target.file)) continue
      const locator = page.locator(`#story-${target.story}`)
      if ((await locator.count()) === 0) continue
      await page.setViewportSize({ width: target.width, height: target.height })
      fs.mkdirSync(path.dirname(target.file), { recursive: true })
      await locator.screenshot({ path: target.file })
      done.add(target.file)
      console.log(`captured ${path.relative(packageDir, target.file)}`)
    }
    await page.close()
  }
} finally {
  await browser.close()
}
const missing = targets.filter((target) => !done.has(target.file))
if (missing.length) {
  console.error(`FAIL capture baselines — story state not found for: ${missing.map((target) => path.basename(target.file)).join(', ')}`)
  process.exit(1)
}
console.log(`OK capture baselines — ${targets.length} image(s)`)
