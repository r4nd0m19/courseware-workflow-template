import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(new URL('../../../../workflow/tools/package.json', import.meta.url))
const { chromium } = require('playwright-core')
const { resolveChrome } = await import(
  pathToFileURL(path.resolve(fileURLToPath(new URL('../../../../workflow/tools/chrome.mjs', import.meta.url)))).href
)

const storyUrl = pathToFileURL(fileURLToPath(new URL('../stories/index.html', import.meta.url))).href
const staticUrl = pathToFileURL(fileURLToPath(new URL('../stories/static.html', import.meta.url))).href

// Replace the real compiler/runner with a deterministic fake. The fake keeps
// the component's worker protocol, so the UI and result rendering are still
// exercised; real compilation is covered by real-compile.spec.mjs.
const fakeWorkers = () => {
  window.__fakeWrong = false
  window.__fakeHang = false
  window.__fakeCompileShouldFail = false
  window.__fakeWorkers = []
  window.Worker = class FakeWorker {
    constructor(url) {
      this.url = String(url)
      this.onmessage = null
      this.onerror = null
      this.terminated = false
      window.__fakeWorkers.push(this)
    }
    postMessage(data) {
      if (this.url.includes('compile-worker')) {
        setTimeout(() => {
          if (window.__fakeCompileShouldFail) {
            this.onmessage && this.onmessage({
              data: { ok: true, module: null, compileOutput: 'main.cpp:3:1: error: 故意制造的编译错误' },
            })
          } else {
            this.onmessage && this.onmessage({ data: { ok: true, module: { fake: true }, compileOutput: '' } })
          }
        }, 10)
        return
      }
      if (window.__fakeHang) return
      const numbers = String((data && data.input) || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(Number)
      const sum = numbers.reduce((total, value) => total + value, 0)
      const stdout = window.__fakeWrong ? '-1\n' : `${sum}\n`
      setTimeout(() => {
        this.onmessage && this.onmessage({
          data: { ok: true, exitCode: 0, stdout, stderr: '', outputLimitExceeded: false },
        })
      }, 10)
    }
    terminate() {
      this.terminated = true
    }
  }
}

async function withPage(url, fn) {
  const browser = await chromium.launch({
    executablePath: resolveChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  })
  await context.addInitScript(fakeWorkers)
  const page = await context.newPage()
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
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 })
    await fn(page)
  } finally {
    await browser.close()
  }
  assert.deepEqual(errors, [])
}

async function waitForText(page, selector, pattern) {
  await page.waitForFunction(
    ({ selector, source }) => {
      const element = document.querySelector(selector)
      return !!element && new RegExp(source).test(element.textContent || '')
    },
    { selector, source: pattern.source },
    { timeout: 15000 },
  )
}

async function editorText(page, id) {
  return page.evaluate((id) => {
    const root = document.getElementById(id)
    if (!root) return ''
    const textarea = root.querySelector('textarea')
    if (textarea) return textarea.value
    return root.querySelector('.cm-content')?.innerText || ''
  }, id)
}

test('code-judge: interactive story runs all visible tests and shows actual output', async () => {
  await withPage(storyUrl, async (page) => {
    const root = page.locator('#judge-sum')
    await root.locator('[data-role="run"]').waitFor()
    assert.equal(await root.locator('[data-role="test-state"]').count(), 3)
    assert.deepEqual(await root.locator('[data-role="test-state"]').allInnerTexts(), ['待运行', '待运行', '待运行'])
    assert.match(await root.locator('[data-role="summary"]').innerText(), /还没运行/)

    await root.locator('[data-role="run"]').click()
    await waitForText(page, '#judge-sum [data-role="summary"]', /全部通过/)
    assert.equal(await root.locator('.code-judge-test.is-ac').count(), 3)
    assert.deepEqual(await root.locator('[data-role="test-state"]').allInnerTexts(), ['通过', '通过', '通过'])
    assert.equal(await root.locator('[data-role="test-actual"]:visible').count(), 3)
    assert.match(await root.locator('[data-role="test-actual"]').first().innerText(), /5/)
    assert.match(await root.locator('[data-role="status"]').innerText(), /全部通过/)
  })
})

test('code-judge: a wrong answer is reported per test without recompiling', async () => {
  await withPage(storyUrl, async (page) => {
    const root = page.locator('#judge-sum')
    await root.locator('[data-role="run"]').waitFor()
    await root.locator('[data-role="run"]').click()
    await waitForText(page, '#judge-sum [data-role="summary"]', /全部通过/)

    await page.evaluate(() => {
      window.__fakeWrong = true
    })
    await root.locator('[data-role="run"]').click()
    await waitForText(page, '#judge-sum [data-role="summary"]', /答案错误/)
    assert.equal(await root.locator('.code-judge-test.is-wa').count(), 3)
    assert.match(await root.locator('[data-role="summary"]').innerText(), /0\/3/)
    assert.match(await root.locator('[data-role="test-actual"]').first().innerText(), /-1/)
  })
})

test('code-judge: compile failure shows the compiler output and does not run tests', async () => {
  await withPage(storyUrl, async (page) => {
    await page.evaluate(() => {
      window.__fakeCompileShouldFail = true
    })
    const root = page.locator('#judge-sum')
    await root.locator('[data-role="run"]').click()
    await waitForText(page, '#judge-sum [data-role="summary"]', /编译未通过/)
    assert.equal(await root.locator('[data-role="compile-details"]').isVisible(), true)
    assert.match(await root.locator('[data-role="compile-output"]').innerText(), /故意制造的编译错误/)
    assert.deepEqual(await root.locator('[data-role="test-state"]').allInnerTexts(), ['待运行', '待运行', '待运行'])
  })
})

test('code-judge: reset restores the starter code and clears results', async () => {
  await withPage(storyUrl, async (page) => {
    const root = page.locator('#judge-sum')
    await root.locator('[data-role="run"]').waitFor()
    await root.locator('[data-role="run"]').click()
    await waitForText(page, '#judge-sum [data-role="summary"]', /全部通过/)

    await root.locator('[data-role="reset"]').click()
    assert.match(await editorText(page, 'judge-sum'), /#include <iostream>|int main/)
    assert.match(await root.locator('[data-role="summary"]').innerText(), /还没运行/)
    assert.deepEqual(await root.locator('[data-role="test-state"]').allInnerTexts(), ['待运行', '待运行', '待运行'])
  })
})

test('code-judge: Ctrl+Enter starts a run from the editor', async () => {
  await withPage(storyUrl, async (page) => {
    const root = page.locator('#judge-sum')
    await root.locator('[data-role="run"]').waitFor()
    // The editor bundle loads lazily; wait briefly so the key press lands on
    // the final editor element instead of the textarea being replaced.
    await page.waitForSelector('#judge-sum .cm-editor', { timeout: 3000 }).catch(() => null)
    const editor = page.locator('#judge-sum .cm-content, #judge-sum textarea').first()
    await editor.click()
    await page.keyboard.press('Control+Enter')
    await waitForText(page, '#judge-sum [data-role="summary"]', /全部通过/)
  })
})

test('code-judge: leaving the page terminates a running worker', async () => {
  await withPage(storyUrl, async (page) => {
    const root = page.locator('#judge-sum')
    await root.locator('[data-role="run"]').waitFor()
    await page.evaluate(() => {
      window.__fakeHang = true
    })
    await root.locator('[data-role="run"]').click()
    await page.waitForFunction(
      () => window.__fakeWorkers.some((worker) => worker.url.includes('run-worker') && !worker.terminated),
      null,
      { timeout: 10000 },
    )
    // The shell replaces #slide.innerHTML when the learner turns the page.
    await page.evaluate(() => {
      document.getElementById('judge-sum').remove()
    })
    await page.waitForFunction(
      () => window.__fakeWorkers
        .filter((worker) => worker.url.includes('run-worker'))
        .every((worker) => worker.terminated),
      null,
      { timeout: 10000 },
    )
  })
})

test('code-judge: static story keeps every test visible and offers no controls', async () => {
  await withPage(staticUrl, async (page) => {
    const root = page.locator('#static-sum')
    await root.locator('.code-judge-static').waitFor()
    assert.equal(await root.locator('[data-role="run"]').count(), 0)
    assert.equal(await root.locator('[data-role="textarea"]').count(), 0)
    assert.equal(await root.locator('[data-test-id]').count(), 3)
    assert.match(await root.innerText(), /输入/)
    assert.match(await root.innerText(), /期望输出/)
    assert.match(await root.innerText(), /int main/)
  })
})
