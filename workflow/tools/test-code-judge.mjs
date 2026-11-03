#!/usr/bin/env node
// End-to-end check for the pure-browser judge: assemble a real shell site from
// the demo deck, copy the runtime the same way build-shell-site does, and run
// the component in headless Chromium against the actual Clang/LLD WASM build.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { copyJudgeRuntime, judgeRuntimeBases, readDeck, verifyJudgeRuntimeSite } from './judge-runtime-lib.mjs'
import { serveDir } from './shell-lib.mjs'

// Pure helper assertions run even when the 91MB toolchain is not installed.
assert.deepEqual(judgeRuntimeBases({ slides: [{ component: 'code-judge' }] }), ['judge-runtime/'])
assert.deepEqual(
  judgeRuntimeBases({ COURSEWARE_SLIDES: [{ component: 'code-judge' }] }),
  ['judge-runtime/'],
)
assert.deepEqual(
  judgeRuntimeBases({ slides: [{ component: 'code-judge', props: { runtimeBaseUrl: './assets/judge/' } }] }),
  ['assets/judge/'],
)
assert.throws(() => judgeRuntimeBases({ slides: [{ component: 'code-judge', props: { runtimeBaseUrl: 'https://cdn.example.com/' } }] }), /inside the site/)
assert.throws(() => judgeRuntimeBases({ slides: [{ component: 'code-judge', props: { runtimeBaseUrl: '../runtime/' } }] }), /plain relative/)
assert.deepEqual(judgeRuntimeBases({ slides: [{ component: 'code-anatomy' }] }), [])

const require = createRequire(new URL('./package.json', import.meta.url))
const { chromium } = require('playwright-core')
const { resolveChrome } = await import(pathToFileURL(path.resolve(fileURLToPath(new URL('./chrome.mjs', import.meta.url)))).href)

const toolsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(toolsDir, '..', '..')
const deckPath = path.join(projectRoot, 'workflow', 'examples', 'code-judge-demo', 'deck.json')
const runtimeDir = path.join(projectRoot, 'judge-runtime')
const skipReason = process.env.COURSEWARE_SANDBOX_CHILD === '1'
  ? 'sandbox hides judge-runtime'
  : !fs.existsSync(path.join(runtimeDir, 'browsercc', 'clang.wasm'))
    ? 'judge-runtime/browsercc is not installed (run node judge-runtime/install.mjs)'
    : ''

if (skipReason) {
  console.log(`SKIP code-judge site integration — ${skipReason}`)
  process.exit(0)
}

function run(script, args, label) {
  const result = spawnSync(process.execPath, [path.join(toolsDir, script), ...args], {
    encoding: 'utf8',
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
  if (result.status !== 0) {
    console.error(`FAIL ${label} (exit ${result.status})\n${output}`)
    process.exit(1)
  }
  return output
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-code-judge-site-'))
const siteDir = path.join(tmp, 'site')
let server
let browser
try {
  run(
    'prepare-shell-site.mjs',
    [
      '--shell', 'branch-choice',
      '--deck', deckPath,
      '--out', siteDir,
      '--allow-missing-art',
      '--force',
    ],
    'prepare-shell-site',
  )
  run(
    'sync-deck-components.mjs',
    [
      '--registry', path.join(projectRoot, 'registry', 'index.json'),
      '--staging', path.join(projectRoot, 'registry', 'staging'),
      '--out', path.join(siteDir, 'components.bundle.js'),
      '--css-out', path.join(siteDir, 'components.bundle.css'),
      '--site', siteDir,
    ],
    'sync-deck-components',
  )

  const deck = readDeck(deckPath)
  const copied = copyJudgeRuntime({ deck, siteDir })
  assert.deepEqual(copied.bases, ['judge-runtime/'])
  assert.deepEqual(verifyJudgeRuntimeSite(siteDir).errors, [])

  server = await serveDir(siteDir, 0)
  const wasmHead = await fetch(new URL('judge-runtime/browsercc/clang.wasm', server.url), { method: 'HEAD' })
  assert.equal(wasmHead.headers.get('content-type'), 'application/wasm')

  browser = await chromium.launch({
    executablePath: resolveChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !/favicon/i.test(message.text()) &&
      !/Failed to load resource/i.test(message.text())
    ) {
      errors.push(`console: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  await page.goto(server.url, { waitUntil: 'networkidle', timeout: 60000 })
  await page.evaluate(() => window.COURSEWARE_DEBUG?.go(0))
  const root = page.locator('.code-judge')
  await root.waitFor({ timeout: 30000 })
  await root.locator('[data-role="run"]').click()
  await page.waitForFunction(
    () => /全部通过/.test(document.querySelector('.code-judge [data-role="summary"]')?.textContent || ''),
    null,
    { timeout: 240000 },
  )
  assert.equal(await root.locator('.code-judge-test.is-ac').count(), 3)
  assert.match(await root.locator('[data-role="test-actual"]').first().innerText(), /5/)
  assert.match(await root.locator('[data-role="summary"]').innerText(), /3\/3/)
  assert.deepEqual(errors, [])
  console.log(`OK code-judge site integration — ${copied.files.length} runtime file(s), 3/3 tests passed`)
} finally {
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  fs.rmSync(tmp, { recursive: true, force: true })
}
