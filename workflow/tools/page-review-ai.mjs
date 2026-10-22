#!/usr/bin/env node
// Single-shot page self-review.
//
// This tool replaces the old `prompt` step that sent the evidence bundle to a
// coding-agent CLI (`zcode -p` / `claude -p` / `codex exec`). The agent could
// read the repository and run commands even when the prompt said not to. This
// tool makes exactly one model request:
//   evidence JSON + inline screenshots -> one structured JSON object
// The model has no filesystem or command tools. The harness owns all hashes,
// deterministic fields, and file writes.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { readData, validateWithSchema } from './lib.mjs'
import {
  buildPageReviewPrompt,
  buildRequest,
  endpointFor,
  expandHome,
  extractAnthropicOutput,
  extractOpenAIOutput,
  fileSha256,
  headersFor,
  mergePageReview,
  readImagePart,
  readStagedComponents,
  validatePageReviewOutput,
} from './page-review-lib.mjs'

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
function list(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
function fail(message, code = 1) {
  console.error(`FAIL page review AI — ${message}`)
  process.exit(code)
}

function defaultConfigPath() {
  const local = path.join(process.cwd(), '.courseware', 'page-review.json')
  if (fs.existsSync(local)) return local
  return path.join(os.homedir(), '.config', 'courseware', 'page-review.json')
}

const checkConfig = flag('--check-config')
const dryRun = flag('--dry-run')
const jsonOut = flag('--json')
const evidencePath = opt('--evidence')
const reviewJsonPath = opt('--review-json')
const lessonSlug = opt('--lesson-slug', opt('--lesson'))
const section = opt('--section')
const configPath =
  opt('--config') ||
  process.env.COURSEWARE_REVIEW_CONFIG ||
  defaultConfigPath()
const zcodeConfigPath =
  opt('--zcode-config') || process.env.COURSEWARE_REVIEW_ZCODE_CONFIG || ''
const zcodeProviderId = opt('--zcode-provider') || ''
const mockResponsePath = opt('--mock-response')
const componentStaging = opt('--component-staging')
const unregistered = list(opt('--unregistered'))

if (!checkConfig && (!evidencePath || !reviewJsonPath)) {
  console.error(
    'usage: node page-review-ai.mjs --evidence <page-evidence.json> --review-json <self-review-page.json> [options]\n' +
      '       node page-review-ai.mjs --check-config\n\n' +
      'options: --config <file> --api <anthropic-messages|openai-chat> --base-url <url> --model <id>\n' +
      '         --api-key-env <name> --api-key-file <file> --max-tokens <n> --timeout-ms <n> --max-attempts <n>\n' +
      '         --structured-output <tool|json> --image-detail <auto|low|high> --auth <x-api-key|bearer>\n' +
      '         --zcode-config <provider_config.json> --zcode-provider <provider-id>\n' +
      '         --component-staging <dir> --unregistered <id,id> --dry-run --request-out <file>\n' +
      '         --mock-response <provider-response.json> --json\n' +
      'config: --config, COURSEWARE_REVIEW_CONFIG, .courseware/page-review.json, or ~/.config/courseware/page-review.json\n' +
      'zcode:  --zcode-config + --zcode-provider reuse an existing ZCode provider/model/key',
  )
  process.exit(2)
}

function readConfigFile(file) {
  if (!file || !fs.existsSync(expandHome(file))) return {}
  try {
    return readData(expandHome(file))
  } catch (error) {
    fail(`cannot read config ${file}: ${error.message}`, 2)
  }
}

const fileConfig = readConfigFile(configPath)

// Optional convenience for ZCode users: reuse the provider/model/key already
// configured in ZCode instead of creating a second key file. This is explicit
// (--zcode-config / COURSEWARE_REVIEW_ZCODE_CONFIG); it never prints the key.
function readZcodeProvider(file, providerId) {
  let data
  try {
    data = readData(expandHome(file))
  } catch (error) {
    throw new Error(`cannot read ${file}: ${error.message}`)
  }
  const rules = data?.config?.providerConfigRules?.providerRules || []
  if (!rules.length) throw new Error('no providerConfigRules.providerRules')
  const chosen = providerId
    ? rules.find((rule) => rule.providerId === providerId)
    : rules.find((rule) => rule.enabled === true) ||
      rules.find((rule) => rule.enabled !== false) ||
      rules[0]
  if (!chosen) throw new Error(`provider ${providerId} not found`)
  const apiType = String(chosen.config?.api?.type || '')
  const api =
    apiType === 'anthropic-messages'
      ? 'anthropic-messages'
      : apiType === 'openai-chat' || apiType === 'openai'
        ? 'openai-chat'
        : ''
  if (!api) {
    throw new Error(
      `provider ${chosen.providerId} uses unsupported api.type ${apiType || '(missing)'}`,
    )
  }
  const baseUrl = chosen.config?.api?.baseUrl || ''
  const apiKey = chosen.config?.access?.apiKey || ''
  if (!baseUrl || !apiKey) {
    throw new Error(`provider ${chosen.providerId} is missing baseUrl or apiKey`)
  }
  const models = data?.config?.modelConfigRules?.providerModelRules || []
  const modelRule =
    models.find(
      (rule) => rule.providerId === chosen.providerId && rule.config?.enabled !== false,
    ) || models.find((rule) => rule.providerId === chosen.providerId)
  const model = modelRule?.modelId || ''
  if (!model) throw new Error(`provider ${chosen.providerId} has no model rule`)
  return { api, baseUrl, model, apiKey, providerId: chosen.providerId }
}

const effectiveZcodeConfigPath =
  zcodeConfigPath || fileConfig.zcodeConfig || ''
const effectiveZcodeProviderId =
  zcodeProviderId || fileConfig.zcodeProvider || ''

let zcode = null
if (effectiveZcodeConfigPath) {
  try {
    zcode = readZcodeProvider(effectiveZcodeConfigPath, effectiveZcodeProviderId)
  } catch (error) {
    fail(`cannot use ZCode provider config: ${error.message}`, 2)
  }
}

const api =
  opt('--api') ||
  process.env.COURSEWARE_REVIEW_API ||
  zcode?.api ||
  fileConfig.api ||
  'anthropic-messages'
const baseUrl =
  opt('--base-url') ||
  process.env.COURSEWARE_REVIEW_BASE_URL ||
  zcode?.baseUrl ||
  fileConfig.baseUrl ||
  ''
const model =
  opt('--model') ||
  process.env.COURSEWARE_REVIEW_MODEL ||
  zcode?.model ||
  fileConfig.model ||
  (mockResponsePath ? 'mock' : '')
const structuredOutput =
  opt('--structured-output') ||
  process.env.COURSEWARE_REVIEW_STRUCTURED_OUTPUT ||
  fileConfig.structuredOutput ||
  // DeepSeek-compatible endpoints may emit DSML text instead of standard
  // Anthropic tool_use blocks. When reusing a ZCode provider, prefer JSON mode
  // unless the user explicitly chose tool mode.
  (zcode ? 'json' : 'tool')
const apiKeyEnv =
  opt('--api-key-env') ||
  fileConfig.apiKeyEnv ||
  'COURSEWARE_REVIEW_API_KEY'
const apiKeyFile =
  opt('--api-key-file') ||
  fileConfig.apiKeyFile ||
  path.join(os.homedir(), '.config', 'courseware', 'page-review.key')
const maxTokens = Number(
  opt('--max-tokens') || process.env.COURSEWARE_REVIEW_MAX_TOKENS || fileConfig.maxTokens || 8192,
)
const timeoutMs = Number(
  opt('--timeout-ms') || process.env.COURSEWARE_REVIEW_TIMEOUT_MS || fileConfig.timeoutMs || 120000,
)
const maxAttempts = Math.max(
  1,
  Number(opt('--max-attempts') || fileConfig.maxAttempts || 3) || 3,
)
const auth =
  opt('--auth') ||
  fileConfig.auth ||
  (api === 'anthropic-messages' ? 'x-api-key' : 'bearer')
const anthropicVersion =
  opt('--anthropic-version') || fileConfig.anthropicVersion || '2023-06-01'
const imageDetail = opt('--image-detail') || fileConfig.imageDetail || 'auto'

function resolveKeyFile(value) {
  const expanded = expandHome(value)
  if (path.isAbsolute(expanded)) return expanded
  if (opt('--api-key-file')) return path.resolve(expanded)
  if (fileConfig.apiKeyFile && fs.existsSync(expandHome(configPath))) {
    return path.resolve(path.dirname(expandHome(configPath)), expanded)
  }
  return path.resolve(expanded)
}

let apiKey = ''
let apiKeySource = ''
if (process.env[apiKeyEnv] && process.env[apiKeyEnv].trim()) {
  apiKey = process.env[apiKeyEnv].trim()
  apiKeySource = `env:${apiKeyEnv}`
} else if (zcode?.apiKey) {
  apiKey = zcode.apiKey
  apiKeySource = `zcode:${zcode.providerId}`
} else {
  const keyFile = resolveKeyFile(apiKeyFile)
  if (fs.existsSync(keyFile)) {
    apiKey = fs.readFileSync(keyFile, 'utf8').trim()
    apiKeySource = `file:${keyFile}`
    if (apiKey && process.platform !== 'win32') {
      try {
        const mode = fs.statSync(keyFile).mode & 0o777
        if (mode & 0o077) {
          console.error(
            `WARN page review AI — ${keyFile} is readable by group/other (mode ${mode.toString(8)}); chmod 600 is recommended`,
          )
        }
      } catch {
        // The key was already read; a stat failure must not discard it.
      }
    }
  }
}

const configErrors = []
if (!['anthropic-messages', 'openai-chat'].includes(api)) {
  configErrors.push(`api must be anthropic-messages or openai-chat, got ${api}`)
}
if (!model) configErrors.push('model is missing')
if (!['tool', 'json'].includes(structuredOutput)) {
  configErrors.push(`structuredOutput must be tool or json, got ${structuredOutput}`)
}
if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
  configErrors.push(`maxTokens must be a positive integer, got ${maxTokens}`)
}
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  configErrors.push(`timeoutMs must be a positive integer, got ${timeoutMs}`)
}
if (!['x-api-key', 'bearer'].includes(auth)) {
  configErrors.push(`auth must be x-api-key or bearer, got ${auth}`)
}
if (!mockResponsePath) {
  if (!baseUrl) configErrors.push('baseUrl is missing')
  else {
    try {
      new URL(baseUrl)
    } catch {
      configErrors.push(`baseUrl is not a valid URL: ${baseUrl}`)
    }
  }
}
if (!dryRun && !mockResponsePath && !apiKey) {
  configErrors.push(
    `API key is missing; set ${apiKeyEnv} or write ${resolveKeyFile(apiKeyFile)} (chmod 600)`,
  )
}

const configLabel = [
  `api=${api}`,
  `model=${model || '(missing)'}`,
  `baseUrl=${baseUrl || '(missing)'}`,
  `structuredOutput=${structuredOutput}`,
  `key=${apiKey ? apiKeySource : '(missing)'}`,
  ...(zcode ? [`zcode=${zcode.providerId}`] : []),
  `config=${configPath}${fs.existsSync(expandHome(configPath)) ? '' : ' (not found)'}`,
].join(' ')

if (checkConfig) {
  if (configErrors.length) {
    fail(`config is incomplete: ${configErrors.join('; ')}\n  ${configLabel}`, 2)
  }
  console.log(`OK page review AI config — ${configLabel}`)
  process.exit(0)
}
if (configErrors.length) {
  fail(`config is incomplete: ${configErrors.join('; ')}\n  ${configLabel}`, 2)
}

let evidence
let skeleton
try {
  evidence = readData(evidencePath)
} catch (error) {
  fail(`cannot read evidence ${evidencePath}: ${error.message}`)
}
try {
  skeleton = readData(reviewJsonPath)
} catch (error) {
  fail(`cannot read self-review skeleton ${reviewJsonPath}: ${error.message}`)
}

const slides = Array.isArray(evidence.section?.slides) ? evidence.section.slides : []
if (!slides.length) fail(`evidence ${evidencePath} has no section.slides`)
const shots = new Map(
  (Array.isArray(evidence.screenshots) ? evidence.screenshots : []).map((shot) => [
    shot.slideId,
    shot,
  ]),
)
const images = []
function screenshotCandidates(file) {
  const candidates = [path.resolve(file)]
  // Evidence generated on Windows may contain backslash paths. When the same
  // project is reviewed under WSL/Linux, try the POSIX spelling too.
  if (process.platform !== 'win32' && String(file).includes('\\')) {
    candidates.push(path.resolve(String(file).replace(/\\/g, '/')))
  }
  return [...new Set(candidates)]
}
for (const slideId of slides) {
  const shot = shots.get(slideId)
  if (!shot) fail(`evidence has no screenshot entry for ${slideId}`)
  let image = null
  let lastError = null
  for (const candidate of [shot.aiImage, shot.png].filter(Boolean)) {
    for (const file of screenshotCandidates(candidate)) {
      try {
        image = readImagePart(file, slideId)
        break
      } catch (error) {
        lastError = error
      }
    }
    if (image) break
  }
  if (!image) fail(lastError?.message || `no readable screenshot for ${slideId}`)
  images.push(image)
}

let components = { summaries: [], artifacts: [] }
try {
  components = readStagedComponents({
    stagingDir: componentStaging,
    ids: unregistered,
    root: process.cwd(),
  })
} catch (error) {
  fail(error.message)
}

const prompt = buildPageReviewPrompt({
  evidence,
  skeleton,
  images,
  components: components.summaries,
  structuredOutput,
})
const promptSha256 = fileSha256FromString(prompt.promptText)
const evidenceSha256 = fileSha256(evidencePath)
const promptBytes = Buffer.byteLength(prompt.promptText, 'utf8')
const endpoint = endpointFor(api, baseUrl || 'http://localhost')

function fileSha256FromString(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function requestPreview() {
  const body = buildRequest({
    api,
    model,
    system: prompt.system,
    userText: prompt.userText,
    images,
    structuredOutput,
    maxTokens,
    imageDetail,
  })
  return {
    api,
    endpoint,
    model,
    structuredOutput,
    key: apiKey ? apiKeySource : '(missing)',
    promptBytes,
    requestBytes: Buffer.byteLength(JSON.stringify(body), 'utf8'),
    system: prompt.system,
    userText: prompt.userText,
    images: images.map(({ slideId, mediaType, bytes, sha256 }) => ({
      slideId,
      mediaType,
      bytes,
      sha256,
    })),
    tool: Array.isArray(body.tools) ? body.tools[0] : null,
    responseFormat: body.response_format || null,
  }
}

const requestOut =
  opt('--request-out') ||
  (lessonSlug && section
    ? path.join('review', lessonSlug, `page-review-request-${section}.json`)
    : path.join('review', 'page-review-request.json'))

function rawOutputPath() {
  return path.join(
    path.dirname(path.resolve(reviewJsonPath)),
    `page-review-raw-${section || 'page'}.json`,
  )
}
function saveRaw(payload) {
  const file = rawOutputPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
  return file
}

if (dryRun) {
  const preview = requestPreview()
  fs.mkdirSync(path.dirname(path.resolve(requestOut)), { recursive: true })
  fs.writeFileSync(path.resolve(requestOut), `${JSON.stringify(preview, null, 2)}\n`)
  console.log(
    `OK page review request — ${section || 'page'}: ${images.length} image(s), ${promptBytes} prompt bytes, ` +
      `${preview.requestBytes} request bytes; ${requestOut}`,
  )
  process.exit(0)
}

function providerError(raw) {
  const value = String(raw || '').trim()
  try {
    const parsed = JSON.parse(value)
    const error = parsed?.error
    if (typeof error === 'string') return error.slice(0, 500)
    if (error && typeof error === 'object') {
      return String(error.message || JSON.stringify(error)).slice(0, 500)
    }
    return String(parsed?.message || value).slice(0, 500)
  } catch {
    return value.slice(0, 500)
  }
}

async function postModel(body, signal) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: headersFor({ api, apiKey, auth, anthropicVersion }),
    body: JSON.stringify(body),
    signal,
  })
  const raw = await response.text()
  if (!response.ok) {
    return { ok: false, status: response.status, raw }
  }
  try {
    return { ok: true, status: response.status, json: JSON.parse(raw) }
  } catch {
    throw new Error(`model returned non-JSON HTTP body (HTTP ${response.status}): ${providerError(raw)}`)
  }
}

function hasDsmlToolSyntax(response) {
  // DeepSeek-compatible Anthropic endpoints may return a 200 with DSML text
  // instead of a standard tool_use block. Retry once in JSON mode.
  return JSON.stringify(response || {}).includes('｜｜DSML｜｜')
}

async function callModel() {
  let effectiveStructuredOutput = structuredOutput
  let fallbackReason = ''
  let attempts = 0
  const started = performance.now()
  let lastError = null
  while (attempts < maxAttempts) {
    attempts += 1
    const body = buildRequest({
      api,
      model,
      system: prompt.system,
      userText: prompt.userText,
      images,
      structuredOutput: effectiveStructuredOutput,
      maxTokens,
      imageDetail,
    })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const result = await postModel(body, controller.signal)
      if (result.ok) {
        if (
          effectiveStructuredOutput === 'tool' &&
          hasDsmlToolSyntax(result.json) &&
          attempts < maxAttempts
        ) {
          effectiveStructuredOutput = 'json'
          fallbackReason = 'provider returned DSML tool syntax; retried in JSON mode'
          continue
        }
        return {
          response: result.json,
          attempts,
          structuredOutput: effectiveStructuredOutput,
          fallbackReason,
          durationMs: performance.now() - started,
          requestBytes: Buffer.byteLength(JSON.stringify(body), 'utf8'),
        }
      }
      const message = providerError(result.raw)
      lastError = `HTTP ${result.status}: ${message}`
      const toolFallback =
        effectiveStructuredOutput === 'tool' &&
        [400, 404, 422].includes(result.status) &&
        /tool|function|tool_choice|tools/i.test(result.raw)
      if (toolFallback) {
        effectiveStructuredOutput = 'json'
        fallbackReason = lastError
        continue
      }
      if ([429, 500, 502, 503, 504].includes(result.status) && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 750 * attempts))
        continue
      }
      throw new Error(`model request failed (${lastError})`)
    } catch (error) {
      if (error.name === 'AbortError') {
        lastError = `timed out after ${timeoutMs} ms`
        if (attempts < maxAttempts) continue
        throw new Error(`model request ${lastError}`)
      }
      if (error.message.startsWith('model request failed')) throw error
      lastError = error.message
      if (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 750 * attempts))
        continue
      }
      throw new Error(`model request failed: ${lastError}`)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`model request failed after ${attempts} attempt(s): ${lastError || 'unknown error'}`)
}

let modelResult
if (mockResponsePath) {
  let response
  try {
    response = readData(mockResponsePath)
  } catch (error) {
    fail(`cannot read mock response ${mockResponsePath}: ${error.message}`)
  }
  try {
    modelResult =
      api === 'anthropic-messages'
        ? extractAnthropicOutput(response)
        : extractOpenAIOutput(response)
  } catch (error) {
    const rawOut = saveRaw({ error: error.message, response })
    fail(`${error.message}; raw response saved to ${rawOut}`)
  }
  modelResult = {
    ...modelResult,
    attempts: 0,
    structuredOutput,
    fallbackReason: 'mock response',
    durationMs: 0,
    requestBytes: Buffer.byteLength(JSON.stringify(requestPreview()), 'utf8'),
  }
} else {
  let call
  try {
    call = await callModel()
  } catch (error) {
    fail(error.message)
  }
  try {
    const extracted =
      api === 'anthropic-messages'
        ? extractAnthropicOutput(call.response)
        : extractOpenAIOutput(call.response)
    modelResult = { ...extracted, ...call }
  } catch (error) {
    const rawOut = saveRaw({ error: error.message, response: call.response })
    fail(`${error.message}; raw response saved to ${rawOut}`)
  }
}

let output
try {
  output = validatePageReviewOutput(modelResult.raw)
} catch (error) {
  const rawOut = saveRaw({
    error: error.message,
    outputKind: modelResult.outputKind,
    raw: modelResult.raw,
    responseId: modelResult.responseId || '',
  })
  fail(`${error.message}; raw output saved to ${rawOut}`)
}

let baseUrlHost = ''
try {
  baseUrlHost = new URL(baseUrl).host
} catch {
  baseUrlHost = ''
}
const meta = {
  api,
  model,
  baseUrlHost,
  structuredOutput: modelResult.structuredOutput || structuredOutput,
  durationMs: Math.round(modelResult.durationMs || 0),
  attempts: modelResult.attempts ?? 0,
  usage: modelResult.usage || {},
  promptSha256,
  evidenceSha256,
  imageCount: images.length,
  promptBytes,
  ...(modelResult.responseId ? { responseId: modelResult.responseId } : {}),
  ...(modelResult.fallbackReason ? { fallbackReason: modelResult.fallbackReason } : {}),
}

let review
try {
  review = mergePageReview({
    skeleton,
    output,
    meta,
    componentArtifacts: components.artifacts,
  })
} catch (error) {
  fail(error.message)
}
const selfReviewSchema = fileURLToPath(
  new URL('../schemas/self-review.schema.json', import.meta.url),
)
const { ok: reviewValid, errors: reviewErrors } = validateWithSchema(selfReviewSchema, review)
if (!reviewValid) {
  fail(`merged review is invalid: ${reviewErrors.join('; ')}`)
}
fs.mkdirSync(path.dirname(path.resolve(reviewJsonPath)), { recursive: true })
fs.writeFileSync(path.resolve(reviewJsonPath), `${JSON.stringify(review, null, 2)}\n`)

const blocking = review.issues.filter((issue) => issue.severity === 'blocking').length
const summary = {
  ok: true,
  section: section || evidence.section?.id || '',
  verdict: review.verdict,
  issues: review.issues.length,
  blocking,
  densityUnits: review.density.reduce((sum, entry) => sum + entry.semanticUnits.length, 0),
  model,
  api,
  durationMs: meta.durationMs,
  attempts: meta.attempts,
  usage: meta.usage,
  images: images.length,
  promptBytes,
  reviewJson: reviewJsonPath,
  reviewMeta: review.reviewMeta,
}
if (jsonOut) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
} else {
  console.log(
    `${review.verdict === 'pass' ? 'OK' : 'WARN'} page review AI — ${summary.section}: ${review.verdict}` +
      ` (${blocking} blocking, ${summary.densityUnits} unit(s), ${images.length} image(s), ` +
      `${(meta.durationMs / 1000).toFixed(1)} s, ${model})`,
  )
}
