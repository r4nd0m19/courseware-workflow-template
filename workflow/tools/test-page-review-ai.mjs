#!/usr/bin/env node
// Tests for the single-shot page review tool. No real model or API key is used:
// local HTTP servers return provider-shaped responses, and the tool is invoked
// as a child process exactly like the workflow does.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const toolsDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(toolsDir, '..', '..')
const tool = path.join(toolsDir, 'page-review-ai.mjs')
const cacheTool = path.join(toolsDir, 'page-review-cache.mjs')
const checkTool = path.join(toolsDir, 'check-self-review.mjs')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-page-review-ai-'))
const stagingName = `staging-test-${process.pid}`
const stagingDir = path.join(root, 'registry', stagingName)

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lQn5WQAAAABJRU5ErkJggg==',
  'base64',
)
const pngPath = path.join(tmp, 'S01.png')
fs.writeFileSync(pngPath, png)

const evidencePath = path.join(tmp, 'evidence.json')
const skeletonPath = path.join(tmp, 'skeleton.json')
const deckPath = path.join(tmp, 'deck.json')
fs.writeFileSync(deckPath, JSON.stringify({ slides: [{ id: 'S01', type: 'blank', title: '测试页' }] }))

const signals = {
  contentRefs: 0,
  tableRows: 0,
  tableCols: 0,
  textRows: 1,
  textBlocks: 1,
  codeLines: 0,
  codeBlocks: 0,
  bulletItems: 0,
  narrationSentences: 1,
  narrationChars: 2,
  screenChars: 4,
}
const evidence = {
  lessonSlug: 'smoke',
  section: { id: 'S01', title: '测试页', slides: ['S01'], start: 0, count: 1 },
  scriptSlides: [
    {
      id: 'S01',
      title: '测试页',
      screenContent: '屏幕内容',
      interactionDesign: '点击',
      narration: '旁白',
      transition: '',
      interaction: null,
      componentPlan: null,
    },
  ],
  density: { slides: [{ slideId: 'S01', signals }] },
  referenceAdaptation: { entries: [] },
  checks: [{ name: 'density', status: 'pass', summary: 'ok' }],
  screenshots: [{ slideId: 'S01', png: pngPath, aiImage: '' }],
}
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
const evidenceSha = crypto
  .createHash('sha256')
  .update(fs.readFileSync(evidencePath))
  .digest('hex')
const skeleton = {
  stage: 'page-S01',
  artifactPaths: [evidencePath],
  reviewedArtifacts: [{ path: evidencePath, sha256: evidenceSha }],
  density: [{ slideId: 'S01', semanticUnits: [], signals, verdict: 'fail', notes: '' }],
  concepts: [{ conceptId: 'C01', verdict: 'pass', evidence: 'deterministic', slideIds: ['S01'] }],
  automatedChecks: [{ name: 'density', status: 'pass', notes: 'ok' }],
  checklist: [
    { item: 'interaction produces the declared evidence (not just watch/next)', status: 'n/a' },
    {
      item: 'visual layout and interaction are understandable; no obvious crowding or misread',
      status: 'n/a',
    },
    {
      item: 'staged component behavior matches its brief (only if components are listed)',
      status: 'n/a',
    },
    { item: 'no placeholder, no personal data', status: 'n/a' },
  ],
  issues: [],
  referenceAdaptation: '确定性参考适配：本页映射无。',
  verdict: 'fail',
  reviewedAt: '2026-10-22T00:00:00Z',
}
fs.writeFileSync(skeletonPath, JSON.stringify(skeleton, null, 2))

const passOutput = {
  density: [
    {
      slideId: 'S01',
      semanticUnits: [{ label: '单位', evidence: '屏幕只讲一个点' }],
      verdict: 'pass',
      notes: '',
    },
  ],
  checklist: [
    { index: 0, status: 'pass' },
    { index: 1, status: 'pass' },
    { index: 2, status: 'n/a' },
    { index: 3, status: 'pass' },
  ],
  issues: [],
  verdict: 'pass',
}

function anthropicResponse(output) {
  return {
    id: 'msg_test',
    content: [{ type: 'tool_use', name: 'submit_page_review', input: output }],
    usage: { input_tokens: 10, output_tokens: 20 },
  }
}
function openaiResponse(output) {
  return {
    id: 'chatcmpl_test',
    choices: [
      {
        message: {
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'submit_page_review', arguments: JSON.stringify(output) },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  }
}

function cleanEnv(extra = {}) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('COURSEWARE_REVIEW_')) delete env[key]
  }
  delete env.TEST_REVIEW_KEY
  return { ...env, ...extra }
}

function runTool(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tool, ...args], {
      cwd: root,
      env: cleanEnv(env),
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

function runNode(script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      env: cleanEnv(),
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

function readBody(request) {
  return new Promise((resolve) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => resolve(body))
  })
}

async function withServer(handler, fn) {
  const server = http.createServer(async (request, response) => {
    try {
      await handler(request, response)
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: error.message } }))
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function reviewPath(name) {
  return path.join(tmp, `${name}.json`)
}
function freshSkeleton(name) {
  const file = reviewPath(name)
  fs.copyFileSync(skeletonPath, file)
  return file
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

let failed = 0
let total = 0
async function test(name, fn) {
  total += 1
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error.stack || error.message)
  }
}

const baseArgs = (review, extra = []) => [
  '--api', 'anthropic-messages',
  '--model', 'vision-test',
  '--lesson-slug', 'smoke',
  '--section', 'S01',
  '--evidence', evidencePath,
  '--review-json', review,
  ...extra,
]

await test('config preflight fails closed without a model config', async () => {
  const result = await runTool(['--check-config', '--config', path.join(tmp, 'missing.json')])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /config is incomplete/)
  assert.match(result.stderr, /model is missing/)
})

await test('config preflight accepts a file config and a relative key file', async () => {
  const keyFile = path.join(tmp, 'page-review.key')
  fs.writeFileSync(keyFile, 'test-key\n', { mode: 0o600 })
  const configFile = path.join(tmp, 'page-review.json')
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      api: 'anthropic-messages',
      baseUrl: 'https://example.invalid',
      model: 'vision-test',
      apiKeyFile: 'page-review.key',
    }),
  )
  const result = await runTool(['--check-config', '--config', configFile])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /OK page review AI config/)
  assert.match(result.stdout, /model=vision-test/)
  assert.match(result.stdout, /key=file:/)
})

await test('dry run builds one request with one output tool and inline image', async () => {
  const requestOut = path.join(tmp, 'request.json')
  const result = await runTool(
    baseArgs(freshSkeleton('dry'), [
      '--base-url', 'https://example.invalid',
      '--dry-run',
      '--request-out', requestOut,
    ]),
  )
  assert.equal(result.code, 0)
  const request = readJson(requestOut)
  assert.equal(request.images.length, 1)
  assert.equal(request.images[0].mediaType, 'image/png')
  assert.equal(request.tool.name, 'submit_page_review')
  assert.match(request.system, /NO tools/)
  assert.match(request.userText, /Evidence bundle/)
  assert.ok(request.requestBytes > request.promptBytes)
})

await test('Anthropic request/response is a single tool-forced call', async () => {
  const seen = []
  await withServer(
    async (request, response) => {
      const body = JSON.parse(await readBody(request))
      seen.push({ path: request.url, body })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(anthropicResponse(passOutput)))
    },
    async (url) => {
      const review = freshSkeleton('anthropic')
      const result = await runTool(
        baseArgs(review, [
          '--base-url', url,
          '--api-key-env', 'TEST_REVIEW_KEY',
        ]),
        { TEST_REVIEW_KEY: 'test-key' },
      )
      assert.equal(result.code, 0, result.stderr)
      assert.equal(seen.length, 1)
      assert.equal(seen[0].path, '/v1/messages')
      assert.equal(seen[0].body.tools.length, 1)
      assert.equal(seen[0].body.tools[0].name, 'submit_page_review')
      assert.equal(seen[0].body.tool_choice.type, 'tool')
      assert.deepEqual(
        seen[0].body.messages[0].content.map((block) => block.type),
        ['text', 'image'],
      )
      assert.ok(!JSON.stringify(seen[0].body).includes('Bash'))
      const reviewJson = readJson(review)
      assert.equal(reviewJson.verdict, 'pass')
      assert.equal(reviewJson.reviewMeta.mode, 'single-shot')
      assert.equal(reviewJson.reviewMeta.attempts, 1)
      assert.equal(reviewJson.reviewMeta.imageCount, 1)
      assert.match(reviewJson.reviewMeta.promptSha256, /^[a-f0-9]{64}$/)
      assert.equal(reviewJson.reviewMeta.usage.total_tokens, 30)
    },
  )
})

await test('blocking issues force fail and fixed is always false', async () => {
  const mock = path.join(tmp, 'mock-block.json')
  fs.writeFileSync(
    mock,
    JSON.stringify(
      anthropicResponse({
        ...passOutput,
        checklist: [
          { index: 0, status: 'pass' },
          { index: 1, status: 'fail', notes: '拥挤' },
          { index: 2, status: 'n/a' },
          { index: 3, status: 'pass' },
        ],
        issues: [{ description: '版面拥挤', severity: 'blocking', fixed: true }],
        verdict: 'pass',
      }),
    ),
  )
  const review = freshSkeleton('blocking')
  const result = await runTool(
    baseArgs(review, ['--mock-response', mock]),
  )
  assert.equal(result.code, 0, result.stderr)
  const reviewJson = readJson(review)
  assert.equal(reviewJson.verdict, 'fail')
  assert.equal(reviewJson.issues[0].fixed, false)
  assert.ok(reviewJson.issues.some((issue) => /强制改为 fail/.test(issue.description)))
  const check = await runNode(checkTool, [review])
  assert.equal(check.code, 1)
})

await test('OpenAI-compatible request/response is a single tool-forced call', async () => {
  const seen = []
  await withServer(
    async (request, response) => {
      const body = JSON.parse(await readBody(request))
      seen.push({ path: request.url, body })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(openaiResponse(passOutput)))
    },
    async (url) => {
      const review = freshSkeleton('openai')
      const result = await runTool(
        [
          '--api', 'openai-chat',
          '--base-url', `${url}/v1`,
          '--model', 'vision-test',
          '--api-key-env', 'TEST_REVIEW_KEY',
          '--evidence', evidencePath,
          '--review-json', review,
        ],
        { TEST_REVIEW_KEY: 'test-key' },
      )
      assert.equal(result.code, 0, result.stderr)
      assert.equal(seen.length, 1)
      assert.equal(seen[0].path, '/v1/chat/completions')
      assert.equal(seen[0].body.tools[0].function.name, 'submit_page_review')
      assert.deepEqual(
        seen[0].body.messages[1].content.map((block) => block.type),
        ['text', 'image_url'],
      )
      assert.ok(
        seen[0].body.messages[1].content[1].image_url.url.startsWith('data:image/png;base64,'),
      )
      assert.equal(readJson(review).verdict, 'pass')
    },
  )
})

await test('tool rejection falls back once to JSON output', async () => {
  const seen = []
  await withServer(
    async (request, response) => {
      const body = JSON.parse(await readBody(request))
      seen.push(body)
      if (body.tools) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'tools are not supported' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          id: 'msg_json',
          content: [{ type: 'text', text: JSON.stringify(passOutput) }],
          usage: { input_tokens: 1, output_tokens: 2 },
        }),
      )
    },
    async (url) => {
      const review = freshSkeleton('fallback')
      const result = await runTool(
        baseArgs(review, [
          '--base-url', url,
          '--api-key-env', 'TEST_REVIEW_KEY',
        ]),
        { TEST_REVIEW_KEY: 'test-key' },
      )
      assert.equal(result.code, 0, result.stderr)
      assert.equal(seen.length, 2)
      assert.ok(seen[0].tools)
      assert.ok(!seen[1].tools)
      const reviewJson = readJson(review)
      assert.equal(reviewJson.verdict, 'pass')
      assert.equal(reviewJson.reviewMeta.structuredOutput, 'json')
      assert.match(reviewJson.reviewMeta.fallbackReason, /HTTP 400/)
      assert.equal(reviewJson.reviewMeta.attempts, 2)
    },
  )
})

await test('DSML tool text falls back once to JSON mode', async () => {
  const seen = []
  await withServer(
    async (request, response) => {
      const body = JSON.parse(await readBody(request))
      seen.push(body)
      response.writeHead(200, { 'content-type': 'application/json' })
      if (body.tools) {
        response.end(
          JSON.stringify({
            id: 'msg_dsml',
            content: [
              {
                type: 'text',
                text: '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="submit_page_review">\n<｜｜DSML｜｜ parameter name="verdict" string="true">pass</｜｜DSML｜｜ parameter>\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>',
              },
            ],
          }),
        )
        return
      }
      response.end(
        JSON.stringify({
          id: 'msg_json_after_dsml',
          content: [{ type: 'text', text: JSON.stringify(passOutput) }],
          usage: { input_tokens: 1, output_tokens: 2 },
        }),
      )
    },
    async (url) => {
      const review = freshSkeleton('dsml')
      const result = await runTool(
        baseArgs(review, [
          '--base-url', url,
          '--api-key-env', 'TEST_REVIEW_KEY',
        ]),
        { TEST_REVIEW_KEY: 'test-key' },
      )
      assert.equal(result.code, 0, result.stderr)
      assert.equal(seen.length, 2)
      assert.ok(seen[0].tools)
      assert.ok(!seen[1].tools)
      const reviewJson = readJson(review)
      assert.equal(reviewJson.verdict, 'pass')
      assert.equal(reviewJson.reviewMeta.structuredOutput, 'json')
      assert.match(reviewJson.reviewMeta.fallbackReason, /DSML/)
      assert.equal(reviewJson.reviewMeta.attempts, 2)
    },
  )
})

await test('max_tokens stop fails with an actionable error', async () => {
  const mock = path.join(tmp, 'mock-maxtokens.json')
  fs.writeFileSync(
    mock,
    JSON.stringify({
      id: 'msg_maxtokens',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'still reasoning' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 1, output_tokens: 4096 },
    }),
  )
  const result = await runTool(
    baseArgs(freshSkeleton('maxtokens'), ['--mock-response', mock]),
  )
  assert.equal(result.code, 1)
  assert.match(result.stderr, /maxTokens/)
})

await test('invalid model output fails closed and saves the raw response', async () => {
  const mock = path.join(tmp, 'mock-invalid.json')
  fs.writeFileSync(
    mock,
    JSON.stringify(anthropicResponse({ density: [], checklist: [], issues: [], verdict: 'pass' })),
  )
  const review = freshSkeleton('invalid')
  const result = await runTool(baseArgs(review, ['--mock-response', mock]))
  assert.equal(result.code, 1)
  assert.match(result.stderr, /does not match the page-review schema/)
  assert.ok(fs.existsSync(path.join(tmp, 'page-review-raw-S01.json')))
  assert.equal(readJson(review).verdict, 'fail')
})

await test('missing screenshot fails closed instead of making a text-only review', async () => {
  const missingEvidence = path.join(tmp, 'evidence-missing.json')
  fs.writeFileSync(
    missingEvidence,
    JSON.stringify({
      ...evidence,
      screenshots: [{ slideId: 'S01', png: path.join(tmp, 'nope.png'), aiImage: '' }],
    }),
  )
  const mock = path.join(tmp, 'mock-pass.json')
  fs.writeFileSync(mock, JSON.stringify(anthropicResponse(passOutput)))
  const result = await runTool([
    '--api', 'anthropic-messages',
    '--model', 'vision-test',
    '--evidence', missingEvidence,
    '--review-json', freshSkeleton('missing-image'),
    '--mock-response', mock,
  ])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /not found|no readable screenshot/)
})

await test('OpenAI JSON mode uses response_format and no tools', async () => {
  const seen = []
  await withServer(
    async (request, response) => {
      const body = JSON.parse(await readBody(request))
      seen.push(body)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          id: 'chatcmpl_json',
          choices: [{ message: { content: JSON.stringify(passOutput) } }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }),
      )
    },
    async (url) => {
      const review = freshSkeleton('openai-json')
      const result = await runTool(
        [
          '--api', 'openai-chat',
          '--base-url', `${url}/v1`,
          '--model', 'vision-test',
          '--api-key-env', 'TEST_REVIEW_KEY',
          '--structured-output', 'json',
          '--evidence', evidencePath,
          '--review-json', review,
        ],
        { TEST_REVIEW_KEY: 'test-key' },
      )
      assert.equal(result.code, 0, result.stderr)
      assert.equal(seen.length, 1)
      assert.equal(seen[0].response_format.type, 'json_object')
      assert.ok(!seen[0].tools)
      assert.equal(readJson(review).verdict, 'pass')
    },
  )
})

await test('staged component files are hashed into the review', async () => {
  fs.mkdirSync(path.join(stagingDir, 'comp-x'), { recursive: true })
  fs.writeFileSync(
    path.join(stagingDir, 'comp-x', 'component.json'),
    JSON.stringify({
      id: 'comp-x',
      name: '演示组件',
      description: '点击后显示结果',
      interactionLevels: ['modify'],
      whenToUse: '需要学生操作时',
    }),
  )
  fs.writeFileSync(path.join(stagingDir, 'comp-x', 'runtime.js'), 'export const x = 1\n')
  fs.writeFileSync(path.join(stagingDir, 'comp-x', 'styles.css'), '.x { color: red }\n')
  const mock = path.join(tmp, 'mock-pass.json')
  fs.writeFileSync(mock, JSON.stringify(anthropicResponse(passOutput)))
  const review = freshSkeleton('component')
  const result = await runTool(
    baseArgs(review, [
      '--mock-response', mock,
      '--component-staging', `registry/${stagingName}`,
      '--unregistered', 'comp-x',
    ]),
  )
  assert.equal(result.code, 0, result.stderr)
  const reviewJson = readJson(review)
  const paths = reviewJson.reviewedArtifacts.map((artifact) => artifact.path)
  assert.ok(paths.includes(`registry/${stagingName}/comp-x/component.json`))
  assert.ok(paths.includes(`registry/${stagingName}/comp-x/runtime.js`))
  const check = await runNode(checkTool, [review])
  assert.equal(check.code, 0, check.stderr)
})

await test('page review cache invalidates when a staged component changes', async () => {
  const review = reviewPath('component')
  const cacheDir = path.join(tmp, 'cache')
  const cacheArgs = [
    '--lesson-slug', 'smoke',
    '--section', 'S01',
    '--evidence', evidencePath,
    '--deck', deckPath,
    '--registry', path.join(tmp, 'missing-registry.json'),
    '--staging', `registry/${stagingName}`,
    '--unregistered', 'comp-x',
    '--cache-dir', cacheDir,
    '--json',
  ]
  const store = await runNode(cacheTool, ['--mode', 'store', ...cacheArgs, '--review-json', review])
  assert.equal(store.code, 0, store.stderr)
  const fresh = freshSkeleton('cache-check')
  const hit = await runNode(cacheTool, ['--mode', 'check', ...cacheArgs, '--review-json', fresh])
  assert.equal(hit.code, 0, hit.stderr)
  assert.equal(JSON.parse(hit.stdout).reuse, true)
  assert.equal(readJson(fresh).reviewMeta.cached, true)
  fs.writeFileSync(path.join(stagingDir, 'comp-x', 'runtime.js'), 'export const x = 2\n')
  const freshAgain = freshSkeleton('cache-check-2')
  const miss = await runNode(cacheTool, ['--mode', 'check', ...cacheArgs, '--review-json', freshAgain])
  assert.equal(miss.code, 0, miss.stderr)
  assert.equal(JSON.parse(miss.stdout).reuse, false)
})

fs.rmSync(stagingDir, { recursive: true, force: true })
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${total - failed}/${total} page-review-ai tests passed`)
process.exit(failed ? 1 : 0)
