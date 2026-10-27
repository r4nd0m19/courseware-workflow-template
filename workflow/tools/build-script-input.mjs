#!/usr/bin/env node
// Build the compact input package for speckit.script.
//
// The script-generation agent must not explore the repository or read gate
// implementations. This tool gathers the approved brief, content items,
// concept ledger, style vocabulary, registry state, templates and output
// paths into one JSON document. The workflow-mode command only reads this file.
import fs from 'node:fs'
import path from 'node:path'
import { readData } from './lib.mjs'
import { parseFlagValue } from './self-review-lib.mjs'

const args = process.argv.slice(2)
const lessonSlug = parseFlagValue(args, '--lesson-slug')
const lesson = parseFlagValue(args, '--lesson', lessonSlug)
const scriptPath = parseFlagValue(args, '--script')
const reviewSectionsPath = parseFlagValue(args, '--review-sections')
const contentPath = parseFlagValue(args, '--content')
const conceptsPath = parseFlagValue(args, '--concepts')
const stylePath = parseFlagValue(args, '--style')
const styleFullPath = parseFlagValue(args, '--style-full')
const registryPath = parseFlagValue(args, '--registry', 'registry/index.json')
const scriptTemplatePath = parseFlagValue(
  args,
  '--script-template',
  'workflow/preset/templates/script-template.md',
)
const reviewSectionsTemplatePath = parseFlagValue(
  args,
  '--review-sections-template',
  'workflow/preset/templates/review-sections-template.yml',
)
const outPath = parseFlagValue(args, '--out', path.join('review', lessonSlug, 'script-input.json'))
if (!lessonSlug || !scriptPath || !reviewSectionsPath || !contentPath || !conceptsPath || !stylePath) {
  console.error(
    'usage: node build-script-input.mjs --lesson-slug <slug> --lesson <title> --script <courseware.md> --review-sections <review-sections.yml> --content <content-pack.json> --concepts <concepts.yml> --style <style-pack.manifest.json> [--style-full <style-pack.full.json>] [--registry <index.json>] [--script-template <file>] [--review-sections-template <file>] [--out <script-input.json>]',
  )
  process.exit(2)
}

const feature = readData('.specify/feature.json')
const specPath = path.join(feature.feature_directory, 'spec.md')
function readText(file) {
  return fs.existsSync(path.resolve(file)) ? fs.readFileSync(path.resolve(file), 'utf8') : ''
}
function styleComponents(style, full) {
  const source = Array.isArray(full?.components)
    ? full.components
    : Array.isArray(style.components)
      ? style.components
      : Object.values(style.components || {})
  return source.map((component) => ({
    id: component.id,
    name: component.name || component.id,
    category: component.category || '',
    status: component.status || '',
    whenToUse: component.whenToUse || '',
    whenNotToUse: component.whenNotToUse || '',
    learningFunction: component.learningFunction || '',
  }))
}
function styleLayouts(style, full) {
  const source = Array.isArray(full?.layouts)
    ? full.layouts
    : Array.isArray(style.layouts)
      ? style.layouts
      : Object.keys(style.layouts || {})
  return source.map((layout) =>
    typeof layout === 'string'
      ? { id: layout }
      : {
          id: layout.id,
          name: layout.name || layout.id,
          whenToUse: layout.whenToUse || '',
        },
  )
}
const content = readData(contentPath)
const concepts = readData(conceptsPath)
const style = readData(stylePath)
const styleFull = styleFullPath && fs.existsSync(path.resolve(styleFullPath))
  ? readData(styleFullPath)
  : null
const registry = readData(registryPath)
const input = {
  schemaVersion: '1.0',
  lessonSlug,
  lesson,
  spec: { path: specPath, text: readText(specPath) },
  content: {
    path: contentPath,
    items: content.items || [],
  },
  concepts: {
    path: conceptsPath,
    concepts: concepts.concepts || [],
  },
  style: {
    path: stylePath,
    components: styleComponents(style, styleFull),
    layouts: styleLayouts(style, styleFull),
  },
  registry: {
    path: registryPath,
    components: (Array.isArray(registry.components)
      ? registry.components
      : Object.entries(registry.components || {}).map(([id, value]) => ({ id, ...value }))
    ).map((component) => ({
      id: component.id,
      version: component.version,
      status: component.status,
    })),
  },
  templates: {
    script: { path: scriptTemplatePath, text: readText(scriptTemplatePath) },
    reviewSections: { path: reviewSectionsTemplatePath, text: readText(reviewSectionsTemplatePath) },
  },
  outputs: {
    courseware: scriptPath,
    reviewSections: reviewSectionsPath,
  },
  existing: {
    courseware: readText(scriptPath),
    reviewSections: readText(reviewSectionsPath),
  },
  rules: [
    '一屏一个语义边界；放不下就拆屏，不能靠缩小字号或滚动条。',
    '每屏包含：屏幕内容、交互设计、旁白/语音、转场、制作字段。',
    '屏幕内容写学生实际看到的文字/代码/表格/图示，逐字写；旁白另写逐字稿。',
    '每个 required 内容项至少被一个非 SKIP 屏的 contentRefs 引用；不得删减 required 内容。',
    '每个 objective 至少一个 answer 级及以上互动；watch 只能配 observe，并写静态替代和静态理由。',
    '每个误区至少在一个互动中被暴露/反驳，并在错误反馈里点名。',
    '互动形式从内容的学习动作推出；quiz 只用于检索/预测，不按组件凑数。',
    '标题是学生可见标题，不得带“封面：/标题：/第 X 页/Sxx”等制作前缀。',
    '组件只能来自 style.components / registry.components，或明确标为 new/extend 并写组件简报。',
    '不要写 TODO/TBD/待定/占位内容；不要写个人信息。',
  ],
}
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
fs.writeFileSync(path.resolve(outPath), `${JSON.stringify(input, null, 2)}\n`)
console.log(`OK script input — ${outPath}`)
