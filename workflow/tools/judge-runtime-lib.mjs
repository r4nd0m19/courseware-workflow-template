// Shared helper for shipping the pure-browser judge runtime with a lesson site.
//
// A deck that mounts `code-judge` needs the browsercc/Clang WASM toolchain and
// the WASI shim next to the site. The runtime is large (~91MB) and deliberately
// gitignored, so the production build copies it only when the deck asks for it
// and fails closed with install instructions when it is missing.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(HERE, '..', '..')
export const DEFAULT_RUNTIME_BASE = 'judge-runtime/'

// Files without which the workers cannot start. Sizes catch a truncated
// download; the installer verifies the full SHA-256 of every browsercc asset.
const REQUIRED_FILES = [
  'compile-worker.js',
  'run-worker.js',
  'codemirror.bundle.js',
  'wasi-shim/index.js',
  'browsercc/index.js',
  'browsercc/clang.js',
  'browsercc/clang.wasm',
  'browsercc/lld.js',
  'browsercc/lld.wasm',
  'browsercc/sysroot.tar',
]
const MIN_BYTES = {
  'browsercc/clang.wasm': 1_000_000,
  'browsercc/lld.wasm': 1_000_000,
  'browsercc/sysroot.tar': 1_000_000,
  'codemirror.bundle.js': 100_000,
}

export function readDeck(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function deckSlides(deck) {
  return Array.isArray(deck?.slides)
    ? deck.slides
    : Array.isArray(deck?.COURSEWARE_SLIDES)
      ? deck.COURSEWARE_SLIDES
      : []
}

export function deckUsesCodeJudge(deck) {
  return deckSlides(deck).some((slide) => slide?.component === 'code-judge')
}

function normalizeBase(value, label) {
  const raw = String(value || DEFAULT_RUNTIME_BASE).trim()
  if (!raw) return DEFAULT_RUNTIME_BASE
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) {
    throw new Error(`${label}: runtimeBaseUrl must stay inside the site, got "${raw}"`)
  }
  if (raw.startsWith('/')) {
    throw new Error(`${label}: runtimeBaseUrl must be relative to the site root, got "${raw}"`)
  }
  const cleaned = raw.replace(/^\.\//, '').replace(/\/+$/, '')
  const parts = cleaned.split('/')
  if (!cleaned || parts.some((part) => part === '..' || part === '.')) {
    throw new Error(`${label}: runtimeBaseUrl must be a plain relative directory, got "${raw}"`)
  }
  return `${cleaned}/`
}

// Returns the set of site-relative directories that must receive the runtime.
export function judgeRuntimeBases(deck) {
  const bases = new Set()
  for (const [index, slide] of deckSlides(deck).entries()) {
    if (slide?.component !== 'code-judge') continue
    bases.add(normalizeBase(slide?.props?.runtimeBaseUrl, `slide ${slide.id || `#${index + 1}`}`))
  }
  return [...bases]
}

export function checkJudgeRuntime(runtimeDir) {
  const errors = []
  if (!fs.existsSync(runtimeDir)) {
    errors.push(`judge runtime directory missing: ${runtimeDir}`)
    return { ok: false, errors }
  }
  for (const relative of REQUIRED_FILES) {
    const file = path.join(runtimeDir, relative)
    if (!fs.existsSync(file)) {
      errors.push(`judge runtime file missing: ${relative}`)
      continue
    }
    const size = fs.statSync(file).size
    const min = MIN_BYTES[relative] || 1
    if (size < min) errors.push(`judge runtime file is truncated: ${relative} (${size} bytes)`)
  }
  return { ok: errors.length === 0, errors }
}

function walk(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

function linkOrCopy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  try {
    fs.linkSync(source, target)
  } catch {
    fs.copyFileSync(source, target)
  }
}

// Copy (or hardlink) the runtime into each site-relative base. Hardlinks keep
// repeated lesson builds fast and do not duplicate the 91MB WASM assets.
export function copyJudgeRuntime({ deck, siteDir, runtimeDir = path.join(PROJECT_ROOT, 'judge-runtime') }) {
  const check = checkJudgeRuntime(runtimeDir)
  if (!check.ok) {
    throw new Error(
      `${check.errors.join('\n')}\nRun: node judge-runtime/install.mjs  (downloads browsercc; not committed)`,
    )
  }
  const bases = judgeRuntimeBases(deck)
  const copied = []
  for (const base of bases) {
    const targetRoot = path.resolve(siteDir, base)
    const siteRoot = path.resolve(siteDir)
    if (targetRoot !== siteRoot && !targetRoot.startsWith(`${siteRoot}${path.sep}`)) {
      throw new Error(`runtimeBaseUrl escapes the site: ${base}`)
    }
    for (const file of walk(runtimeDir)) {
      const relative = path.relative(runtimeDir, file)
      const target = path.join(targetRoot, relative)
      linkOrCopy(file, target)
      copied.push(path.relative(siteDir, target))
    }
  }
  return { bases, files: copied }
}

export function verifyJudgeRuntimeSite(siteDir, base = DEFAULT_RUNTIME_BASE) {
  const check = checkJudgeRuntime(path.resolve(siteDir, base))
  return check
}

export function judgeRuntimeInstallHint() {
  return 'node judge-runtime/install.mjs'
}
