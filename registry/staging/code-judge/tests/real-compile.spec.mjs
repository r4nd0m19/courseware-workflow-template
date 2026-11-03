import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(new URL('../../../../workflow/tools/package.json', import.meta.url))
const { chromium } = require('playwright-core')
const { resolveChrome } = await import(
  pathToFileURL(path.resolve(fileURLToPath(new URL('../../../../workflow/tools/chrome.mjs', import.meta.url)))).href
)

const packageDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const projectRoot = path.resolve(packageDir, '..', '..', '..')
const runtimeDir = path.join(projectRoot, 'judge-runtime')
const clangWasm = path.join(runtimeDir, 'browsercc', 'clang.wasm')
const skipReason = process.env.COURSEWARE_SANDBOX_CHILD === '1'
  ? 'sandbox hides judge-runtime'
  : !fs.existsSync(clangWasm)
    ? 'judge-runtime/browsercc is not installed (run node judge-runtime/install.mjs)'
    : false

const indexHtml = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>code-judge real compile</title>
<link rel="stylesheet" href="./styles.css">
</head>
<body style="margin:0;padding:24px;background:#eef6df">
<div id="host"></div>
<script>
  window.CoursewareComponents = {
    register: function (id, implementation) { this._registry = this._registry || {}; this._registry[id] = implementation },
    get: function (id) { return (this._registry || {})[id] },
  }
</script>
<script src="./runtime.js"></script>
<script src="./fixtures.js"></script>
<script>
  var props = Object.assign({}, window.CODE_JUDGE_FIXTURES.sum, {
    runtimeBaseUrl: '/judge-runtime/',
    starterCode: '#include <iostream>\\nusing namespace std;\\nint main(){int a,b;cin>>a>>b;cout<<a+b<<"\\\\n";return 0;}\\n'
  })
  var host = document.getElementById('host')
  host.innerHTML = window.CoursewareComponents.get('code-judge').render(props)
  window.CoursewareComponents.get('code-judge').bind(host, props)
</script>
</body>
</html>`

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.tar': 'application/x-tar',
}

function startServer(siteDir) {
  const roots = [
    ['/judge-runtime/', runtimeDir],
    ['/', siteDir],
  ]
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      const [prefix, dir] = roots.find(([key]) => url.pathname.startsWith(key)) || roots[1]
      let relative = decodeURIComponent(url.pathname.slice(prefix.length))
      if (!relative || relative.endsWith('/')) relative += 'index.html'
      const file = path.resolve(dir, relative)
      const root = path.resolve(dir)
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end('forbidden')
        return
      }
      fs.readFile(file, (error, data) => {
        if (error) {
          response.writeHead(404).end('not found')
          return
        }
        response.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
        response.end(data)
      })
    } catch {
      response.writeHead(400).end('bad request')
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}/`,
      close: () => new Promise((done) => {
        server.closeAllConnections?.()
        server.close(() => done())
      }),
    }))
  })
}

test('code-judge: the real browser toolchain compiles and passes the visible tests', { skip: skipReason }, async () => {
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-code-judge-'))
  fs.copyFileSync(path.join(packageDir, 'runtime.js'), path.join(siteDir, 'runtime.js'))
  fs.copyFileSync(path.join(packageDir, 'styles.css'), path.join(siteDir, 'styles.css'))
  fs.copyFileSync(path.join(packageDir, 'stories', 'fixtures.js'), path.join(siteDir, 'fixtures.js'))
  fs.writeFileSync(path.join(siteDir, 'index.html'), indexHtml)
  const server = await startServer(siteDir)
  const browser = await chromium.launch({
    executablePath: resolveChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
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
    await page.locator('[data-role="run"]').click()
    await page.waitForFunction(
      () => /全部通过/.test(document.querySelector('[data-role="summary"]')?.textContent || ''),
      null,
      { timeout: 240000 },
    )
    assert.equal(await page.locator('.code-judge-test.is-ac').count(), 3)
    assert.match(await page.locator('[data-role="test-actual"]').first().innerText(), /5/)
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await server.close()
    fs.rmSync(siteDir, { recursive: true, force: true })
  }
})
