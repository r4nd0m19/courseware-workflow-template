#!/usr/bin/env node
// Build the compact evidence package for structured component generation.
//
// This is deliberately separate from the model call: the model receives one
// brief, one existing component (for extend) and one exemplar package, not a
// repository to explore.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readData } from './lib.mjs'
import { loadRegistry, resolveInside } from './registry-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')
    ? args[index + 1]
    : fallback
}
const componentId = opt('--component')
const briefPath = opt('--brief')
const mode = opt('--mode', 'new')
const registryPath = opt('--registry', 'registry/index.json')
const stylePath = opt('--style')
const styleFullPath = opt('--style-full')
const exemplarId = opt('--exemplar', 'code-anatomy')
const outPath = opt('--out')
if (!componentId || !briefPath || !outPath) {
  console.error(
    'usage: node build-component-evidence.mjs --component <id> --brief <component-brief.md> [--mode new|extend|reference-verbatim] [--registry registry/index.json] [--style <manifest>] [--style-full <full>] [--exemplar <id>] --out <evidence.json>',
  )
  process.exit(2)
}
if (!['new', 'extend', 'reference-verbatim'].includes(mode)) {
  console.error(`unsupported mode ${mode}`)
  process.exit(2)
}
function readText(file) {
  return fs.existsSync(path.resolve(file)) ? fs.readFileSync(path.resolve(file), 'utf8') : ''
}
function packageFiles(packageDir) {
  const files = []
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) files.push(full)
    }
  }
  walk(packageDir)
  return files
}
function componentPackage(entry) {
  if (!entry) return null
  const loaded = loadRegistry(registryPath)
  const packageDir = resolveInside(loaded.registryDir, entry.package)
  if (!fs.existsSync(packageDir)) return null
  const manifest = readData(path.join(packageDir, 'component.json'))
  const textFiles = {}
  for (const file of packageFiles(packageDir)) {
    const relative = path.relative(packageDir, file).split(path.sep).join('/')
    if (!/\.(json|js|mjs|css|html|md)$/.test(relative)) continue
    textFiles[relative] = fs.readFileSync(file, 'utf8')
  }
  return { id: manifest.id, package: entry.package, manifest, files: textFiles }
}

let registry
try {
  registry = loadRegistry(registryPath)
} catch {
  registry = { index: { components: [] }, registryDir: path.dirname(path.resolve(registryPath)) }
}
const entry = (registry.index.components || []).find((item) => item.id === componentId) || null
const existing = mode === 'extend' || mode === 'reference-verbatim' ? componentPackage(entry) : null
if (mode === 'extend' && !existing) {
  console.error(`FAIL component evidence — extend requires an existing registered component ${componentId}`)
  process.exit(1)
}
const exemplarEntry = (registry.index.components || []).find((item) => item.id === exemplarId) || null
const exemplar = exemplarId && exemplarId !== componentId ? componentPackage(exemplarEntry) : null
const style = stylePath && fs.existsSync(path.resolve(stylePath)) ? readData(stylePath) : null
const styleFull = styleFullPath && fs.existsSync(path.resolve(styleFullPath)) ? readData(styleFullPath) : null

const evidence = {
  schemaVersion: '1.0',
  mode,
  componentId,
  brief: { path: briefPath, text: readText(briefPath) },
  existing,
  exemplar,
  style: style ? { path: stylePath, manifest: style, full: styleFull } : null,
  allowedFiles: [
    'component.json',
    'runtime.js',
    'styles.css',
    'tests/<name>.spec.mjs',
    'stories/<name>.html',
    'assets/<name>',
    'baselines/<name>.png',
  ],
  limits: {
    maxFiles: 200,
    maxFileBytes: 8 * 1024 * 1024,
    maxTotalBytes: 20 * 1024 * 1024,
  },
  rules: [
    '只返回文件包 JSON，不返回 Markdown 代码块或解释。',
    'runtime.js 必须是浏览器原生 UMD/IIFE，并调用 window.CoursewareComponents.register(id, { render, bind })。',
    'component.json 的 propsSchema 必须 additionalProperties=false；不得写 style/className/html/innerHTML/on*。',
    '样式只能使用风格包 token/变量；不得覆盖页面级样式。',
    '必须提供 tests/ 与 stories/；交互组件必须有 interactionModel.transitions。',
    'reference-verbatim 模式的 CSS/DOM/JS 必须来自参考源码，不得重画。',
    '禁止网络请求、Node 内置模块、child_process、eval、new Function、外部字体/图片 URL。',
    '不要写 baselines；Node 会在 stories 通过后生成/记录基线。',
  ],
}
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(path.resolve(outPath), `${JSON.stringify(evidence, null, 2)}\n`)
console.log(`OK component evidence — ${componentId} ${mode}${existing ? ` (existing ${existing.manifest.version})` : ''}`)
