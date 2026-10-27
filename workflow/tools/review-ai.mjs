#!/usr/bin/env node
// Single-shot text self-review for brief / script / component-plan.
//
// This replaces the old `prompt` steps that sent a coding agent into the
// repository. The reviewer receives one evidence JSON and one skeleton, makes
// exactly one model request, and returns one structured JSON object. It has no
// tools and cannot edit files. The harness owns all hashes and deterministic
// fields.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { readData, validateWithSchema } from './lib.mjs'
import {
  endpointFor,
  headersFor,
  parseJsonText,
} from './page-review-lib.mjs'
import {
  buildReviewPrompt,
  mergeReview,
  REVIEW_MODES,
  validateReviewOutput,
  writeReviewMarkdown,
} from './review-ai-lib.mjs'

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
function fail(message, code = 1) {
  console.error(`FAIL review AI — ${message}`)
  process.exit(code)
}
function expandHome(file) {
  const value = String(file || '')
  if (value === '~') return process.env.HOME || process.env.USERPROFILE || value
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(process.env.HOME || process.env.USERPROFILE || '', value.slice(2))
  }
  return value
}
function defaultConfigPath() {
  const local = path.join(process.cwd(), '.courseware', 'page-review.json')
  if (fs.existsSync(local)) return local
  return path.join(os.homedir(), '.config', 'courseware', 'page-review.json')
}

const mode = opt('--mode')
const evidencePath = opt('--evidence')
const reviewJsonPath = opt('--review-json')
const mdPath = opt('--md') || reviewJsonPath.replace(/\.json$/i, '.md')
const configPath =
  opt('--config') || process.env.COURSEWARE_REVIEW_CONFIG || defaultConfigPath()
const zcodeConfigPath =
  opt('--zcode-config') || process.env.COURSEWARE_REVIEW_ZCODE_CONFIG || ''
const zcodeProviderId = opt('--zcode-provider') || ''
const checkConfig = flag('--check-config')
const dryRun = flag('--dry-run')
const jsonOut = flag('--json')
const mockResponsePath = opt('--mock-response')
const requestOut = opt('--request-out')

if (!REVIEW_MODES.includes(mode) && !checkConfig) {
  console.error(
    `usage: node review-ai.mjs --mode <${REVIEW_MODES.join('|')}> --evidence <json> --review-json <json> [options]\n` +
      '       node review-ai.mjs --check-config\n\n' +
      'options: --config <file> --api <anthropic-messages|openai-chat> --base-url <url> --model <id>\n' +
      '         --api-key-env <name> --api-key-file <file> --max-tokens <n> --timeout-ms <n>\n' +
      '         --max-attempts <n> --zcode-config <provider_config.json> --zcode-provider <provider-id>\n' +
      '         --md <file> --dry-run --request-out <file> --mock-response <file> --json',
  )
  process.exit(2)
}
if (!checkConfig && (!mode || !evidencePath || !reviewJsonPath)) {
  console.error('--mode, --evidence and --review-json are required')
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

function zcodeConfigCandidates(value) {
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map(expandHome)
}
function readZcodeProvider(file, providerId) {
  const candidates = zcodeConfigCandidates(file)
  let data = null
  let used = ''
  let lastError = null
  for (const candidate of candidates) {
    try {
      data = readData(candidate)
      used = candidate
      break
    } catch (error) {
      lastError = error
    }
  }
  if (!data) {
    throw new Error(`cannot read ${candidates.join(' or ') || '(no path)'}: ${lastError?.message || 'not found'}`)
  }
  const rules = data?.config?.providerConfigRules?.providerRules || []
  const chosen = providerId
    ? rules.find((rule) => rule.providerId === providerId)
    : rules.find((rule) => rule.enabled === true) ||
      rules.find((rule) => rule.enabled !== false) ||
      rules[0]
  if (!chosen) throw new Error(`provider ${providerId} not found in ${used}`)
  const apiType = String(chosen.config?.api?.type || '')
  const api =
    apiType === 'anthropic-messages'
      ? 'anthropic-messages'
      : apiType === 'openai-chat' || apiType === 'openai'
        ? 'openai-chat'
        : ''
  if (!api) throw new Error(`provider ${chosen.providerId} uses unsupported api.type ${apiType || '(missing)'}`)
  const baseUrl = chosen.config?.api?.baseUrl || ''
  const apiKey = chosen.config?.access?.apiKey || ''
  if (!baseUrl || !apiKey) throw new Error(`provider ${chosen.providerId} is missing baseUrl or apiKey`)
  const models = data?.config?.modelConfigRules?.providerModelRules || []
  const rule =
    models.find((item) => item.providerId === chosen.providerId && item.config?.enabled !== false) ||
    models.find((item) => item.providerId === chosen.providerId)
  if (!rule?.modelId) throw new Error(`provider ${chosen.providerId} has no model rule`)
  return { api, baseUrl, model: rule.modelId, apiKey, providerId: chosen.providerId }
}

const zcode = zcodeConfigPath
  ? readZcodeProvider(zcodeConfigPath, zcodeProviderId)
  : null
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
const apiKeyEnv = opt('--api-key-env') || fileConfig.apiKeyEnv || 'COURSEWARE_REVIEW_API_KEY'
const apiKeyFile =
  opt('--api-key-file') ||
  fileConfig.apiKeyFile ||
  path.join(os.homedir(), '.config', 'courseware', 'page-review.key')
const maxTokens = Number(opt('--max-tokens') || fileConfig.maxTokens || 8192)
const timeoutMs = Number(opt('--timeout-ms') || fileConfig.timeoutMs || 120000)
const maxAttempts = Math.max(1, Number(opt('--max-attempts') || fileConfig.maxAttempts || 3) || 3)
const auth = opt('--auth') || fileConfig.auth || (api === 'anthropic-messages' ? 'x-api-key' : 'bearer')

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
if (process.env[apiKeyEnv]?.trim()) {
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
  }
}

const configErrors = []
if (!['anthropic-messages', 'openai-chat'].includes(api)) configErrors.push(`api must be anthropic-messages or openai-chat, got ${api}`)
if (!model) configErrors.push('model is missing')
if (!Number.isInteger(maxTokens) || maxTokens <= 0) configErrors.push(`maxTokens must be positive, got ${maxTokens}`)
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) configErrors.push(`timeoutMs must be positive, got ${timeoutMs}`)
if (!mockResponsePath && !baseUrl) configErrors.push('baseUrl is missing')
if (!dryRun && !mockResponsePath && !apiKey) configErrors.push(`API key is missing; set ${apiKeyEnv}`)
const configLabel = `api=${api} model=${model || '(missing)'} baseUrl=${baseUrl || '(missing)'} key=${apiKey ? apiKeySource : '(missing)'}`
if (checkConfig) {
  if (configErrors.length) fail(`config is incomplete: ${configErrors.join('; ')}\n  ${configLabel}`, 2)
  console.log(`OK review AI config — ${configLabel}`)
  process.exit(0)
}
if (configErrors.length) fail(`config is incomplete: ${configErrors.join('; ')}\n  ${configLabel}`, 2)

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
const prompt = buildReviewPrompt({ mode, evidence, skeleton })
const promptSha256 = crypto.createHash('sha256').update(prompt.promptText).digest('hex')
const evidenceSha256 = crypto.createHash('sha256').update(fs.readFileSync(evidencePath)).digest('hex')
const endpoint = endpointFor(api, baseUrl || 'http://localhost')

function bodyFor() {
  if (api === 'anthropic-messages') {
    return {
      model,
      max_tokens: maxTokens,
      system: prompt.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt.userText }] }],
    }
  }
  return {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.userText },
    ],
    response_format: { type: 'json_object' },
  }
}
const requestBody = bodyFor()
if (requestOut) {
  fs.mkdirSync(path.dirname(path.resolve(requestOut)), { recursive: true })
  fs.writeFileSync(path.resolve(requestOut), JSON.stringify({
    endpoint,
    api,
    model,
    maxTokens,
    promptBytes: Buffer.byteLength(prompt.promptText, 'utf8'),
    system: prompt.system,
    userText: prompt.userText,
  }, null, 2))
}
if (dryRun) {
  if (jsonOut) process.stdout.write(`${JSON.stringify({ ok: true, dryRun: true, endpoint, model, promptBytes: Buffer.byteLength(prompt.promptText, 'utf8') })}\n`)
  else console.log(`OK review AI dry run — ${mode} ${model} ${Buffer.byteLength(prompt.promptText, 'utf8')} bytes`)
  process.exit(0)
}

function parseModelResponse(response) {
  if (api === 'anthropic-messages') {
    if (response?.stop_reason === 'max_tokens') throw new Error('Anthropic response hit max_tokens; increase maxTokens')
    const content = Array.isArray(response?.content)
      ? response.content.map((block) => block?.text || '').join('\n')
      : String(response?.content || '')
    if (!content.trim()) throw new Error('Anthropic response is empty')
    return { raw: parseJsonText(content), responseId: response?.id || '', usage: response?.usage || {} }
  }
  if (response?.choices?.[0]?.finish_reason === 'length') throw new Error('OpenAI response hit the output limit; increase maxTokens')
  const message = response?.choices?.[0]?.message || {}
  const content = typeof message.content === 'string'
    ? message.content
    : Array.isArray(message.content)
      ? message.content.map((part) => part?.text || '').join('\n')
      : ''
  if (!content.trim()) throw new Error('OpenAI response is empty')
  return { raw: parseJsonText(content), responseId: response?.id || '', usage: response?.usage || {} }
}

async function callModel() {
  const started = performance.now()
  let attempt = 0
  let lastError = null
  while (attempt < maxAttempts) {
    attempt += 1
    if (mockResponsePath) {
      const response = readData(mockResponsePath)
      const parsed = parseModelResponse(response)
      return { ...parsed, attempts: attempt, durationMs: performance.now() - started }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: headersFor({ api, apiKey, auth }),
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })
      clearTimeout(timer)
      const rawText = await response.text()
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${rawText.slice(0, 500)}`)
      let json
      try {
        json = JSON.parse(rawText)
      } catch {
        throw new Error(`model endpoint returned non-JSON: ${rawText.slice(0, 300)}`)
      }
      const parsed = parseModelResponse(json)
      return { ...parsed, attempts: attempt, durationMs: performance.now() - started }
    } catch (error) {
      clearTimeout(timer)
      lastError = error
      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 750 * attempt))
    }
  }
  throw lastError || new Error('model request failed')
}

let modelResult
try {
  modelResult = await callModel()
} catch (error) {
  const rawOut = reviewJsonPath.replace(/\.json$/i, '.raw.json')
  fs.mkdirSync(path.dirname(path.resolve(rawOut)), { recursive: true })
  fs.writeFileSync(path.resolve(rawOut), `${JSON.stringify({ error: error.message }, null, 2)}\n`)
  fail(`${error.message}; raw diagnostic saved to ${rawOut}`)
}
let output
try {
  output = validateReviewOutput(modelResult.raw)
} catch (error) {
  fail(error.message)
}
const review = mergeReview({
  mode,
  skeleton,
  output,
  meta: {
    api,
    model,
    durationMs: Math.round(modelResult.durationMs || 0),
    attempts: modelResult.attempts || 0,
    usage: modelResult.usage || {},
    promptSha256,
    evidenceSha256,
    ...(modelResult.responseId ? { responseId: modelResult.responseId } : {}),
  },
})
const schemaPath = fileURLToPath(new URL('../schemas/self-review.schema.json', import.meta.url))
const { ok, errors } = validateWithSchema(schemaPath, review)
if (!ok) fail(`merged review is invalid: ${errors.join('; ')}`)
fs.mkdirSync(path.dirname(path.resolve(reviewJsonPath)), { recursive: true })
fs.writeFileSync(path.resolve(reviewJsonPath), `${JSON.stringify(review, null, 2)}\n`)
writeReviewMarkdown(review, mdPath)
const summary = {
  ok: true,
  mode,
  verdict: review.verdict,
  issues: review.issues.length,
  blocking: review.issues.filter((issue) => issue.severity === 'blocking').length,
  model,
  api,
  durationMs: modelResult.durationMs,
  attempts: modelResult.attempts,
  usage: modelResult.usage || {},
  promptBytes: Buffer.byteLength(prompt.promptText, 'utf8'),
  reviewJson: reviewJsonPath,
  reviewMd: mdPath,
}
if (jsonOut) process.stdout.write(`${JSON.stringify(summary)}\n`)
else console.log(`OK review AI — ${mode} ${review.verdict}, ${review.issues.length} issue(s), ${summary.durationMs} ms`)
