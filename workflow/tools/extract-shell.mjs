#!/usr/bin/env node
// Extract a reference courseware into a reusable shell package.
//
// Ingestion copies the reference source and assets byte-for-byte into
// source/ (for fidelity hashes), then produces site/ with one narrow change:
// the lesson's embedded slide array is replaced by the COURSEWARE_SHELL_DATA
// data hook. Illustrations are copied into reference/ only; a generated deck
// must supply fresh variants (see generate-shell-art.mjs).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
function flag(name) { return args.includes(name) }

const referenceDir = path.resolve(opt('--reference'))
const outDir = path.resolve(opt('--out', `shells/${opt('--id', 'branch-choice')}`))
const id = opt('--id', 'branch-choice')
const name = opt('--name', '')
const version = opt('--version', '0.1.0')
const profileArg = opt('--profile', 'branch-v1')
const artDir = opt('--art-dir')
const baselineArg = opt('--baseline')
const indexFile = path.resolve(opt('--index', path.join(path.dirname(outDir), 'index.json')))
const force = flag('--force')

if (!referenceDir || !fs.existsSync(path.join(referenceDir, 'index.html'))) {
  console.error(`usage: node extract-shell.mjs --reference <courseware-dir> --out shells/<id> [--id <id>] [--name <name>] [--profile <profile>] [--art-dir <dir>] [--force]`)
  console.error(`reference dir must contain index.html: ${referenceDir}`)
  process.exit(2)
}
if (!/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error(`FAIL shell id must match ^[a-z][a-z0-9-]*$: ${id}`)
  process.exit(2)
}

const profileFile = path.join(here, 'shell-profiles', `${profileArg}.mjs`)
if (!fs.existsSync(profileFile)) {
  console.error(`FAIL profile not found: ${profileFile}`)
  process.exit(2)
}
const { default: profile } = await import(`${new URL(`file://${profileFile}`).href}?v=${Date.now()}`)
const blockDir = path.join(here, 'shell-profiles', profile.id)

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
}
function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
}
function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}
function readBlock(file) {
  const full = path.join(blockDir, file)
  if (!fs.existsSync(full)) throw new Error(`profile block missing: ${full}`)
  const text = fs.readFileSync(full, 'utf8')
  return text.endsWith('\n') ? text : `${text}\n`
}
function fail(message) {
  console.error(`FAIL ${message}`)
  process.exit(1)
}

if (fs.existsSync(outDir)) {
  const entries = fs.readdirSync(outDir).filter((n) => n !== '.DS_Store')
  if (entries.length && !force) {
    console.error(`FAIL output directory is not empty: ${outDir} (pass --force to replace)`)
    process.exit(1)
  }
  if (force) fs.rmSync(outDir, { recursive: true, force: true })
}
fs.mkdirSync(outDir, { recursive: true })

// 1. Copy originals for the fidelity ledger.
const sourceRoot = path.join(outDir, 'source')
const sourceFiles = []
for (const rel of profile.copy.files) {
  const src = path.join(referenceDir, rel)
  if (!fs.existsSync(src)) fail(`reference file missing: ${rel}`)
  copyFile(src, path.join(sourceRoot, rel))
  sourceFiles.push(`source/${rel}`)
}
for (const rel of profile.copy.assetFiles || []) {
  const src = path.join(referenceDir, rel)
  if (!fs.existsSync(src)) fail(`reference asset missing: ${rel}`)
  copyFile(src, path.join(sourceRoot, rel))
  sourceFiles.push(`source/${rel}`)
}
for (const rel of profile.copy.dirs || []) {
  const src = path.join(referenceDir, rel)
  if (!fs.existsSync(src)) fail(`reference directory missing: ${rel}`)
  for (const file of walk(src)) {
    const child = path.relative(referenceDir, file).split(path.sep).join('/')
    copyFile(file, path.join(sourceRoot, child))
    sourceFiles.push(`source/${child}`)
  }
}

// 2. Build the runnable site from the copied originals.
const siteDir = path.join(outDir, 'site')
for (const rel of profile.copy.files) {
  if (rel === 'lesson.js') continue
  copyFile(path.join(sourceRoot, rel), path.join(siteDir, rel))
}
for (const rel of profile.copy.assetFiles || []) {
  copyFile(path.join(sourceRoot, rel), path.join(siteDir, rel))
}
for (const rel of profile.copy.dirs || []) {
  const src = path.join(sourceRoot, rel)
  for (const file of walk(src)) {
    const child = path.relative(sourceRoot, file)
    copyFile(file, path.join(siteDir, child))
  }
}

// 3. Transform lesson.js: content data out, shell data in.
let lesson = fs.readFileSync(path.join(sourceRoot, 'lesson.js'), 'utf8')
const start = lesson.indexOf(profile.lesson.contentStart)
const end = lesson.indexOf(profile.lesson.contentEnd)
if (start < 0) fail(`lesson.js: contentStart marker not found: ${profile.lesson.contentStart}`)
if (end < 0 || end <= start) fail(`lesson.js: contentEnd marker not found after contentStart`)
lesson = `${lesson.slice(0, start)}${readBlock(profile.lesson.loaderFile)}${lesson.slice(end)}`

for (const replacement of profile.lesson.replacements || []) {
  if (!lesson.includes(replacement.find)) fail(`lesson.js: replacement target not found: ${replacement.find.slice(0, 80)}`)
  lesson = lesson.split(replacement.find).join(replacement.replace)
}
const lines = lesson.split('\n')
for (const spec of profile.lesson.replaceLines || []) {
  const matcher = spec.match instanceof RegExp ? spec.match : new RegExp(spec.match)
  let hits = 0
  for (let i = 0; i < lines.length; i += 1) {
    if (matcher.test(lines[i])) {
      lines[i] = readBlock(spec.file).replace(/\n$/, '')
      hits += 1
    }
  }
  if (hits !== 1) fail(`lesson.js: expected exactly one line matching ${spec.match}, found ${hits}`)
}
lesson = lines.join('\n')
for (const spec of profile.lesson.insertBefore || []) {
  if (!lesson.includes(spec.marker)) fail(`lesson.js: insertBefore marker not found: ${spec.marker}`)
  lesson = lesson.replace(spec.marker, `${readBlock(spec.file)}\n${spec.marker}`)
}
for (const spec of profile.lesson.insertBeforeTail || []) {
  const at = lesson.lastIndexOf(spec.marker)
  if (at < 0) fail(`lesson.js: tail marker not found: ${spec.marker}`)
  lesson = `${lesson.slice(0, at)}${readBlock(spec.file)}\n${lesson.slice(at)}`
}
if (lesson.includes('const slides = [')) fail('lesson.js: reference slide data still present after transformation')
fs.writeFileSync(path.join(siteDir, 'lesson.js'), lesson)

// 4. Patch index.html: load shell data before the renderer.
const siteIndexFile = path.join(siteDir, 'index.html')
let html = fs.readFileSync(siteIndexFile, 'utf8')
const scriptTag = '<script src="lesson.js"></script>'
if (!html.includes(scriptTag)) fail('index.html: <script src="lesson.js"></script> not found')
html = html.replace(scriptTag, `<script src="deck.js"></script>\n  <script src="shell-art-data.js"></script>\n  ${scriptTag}`)
html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>互动课堂</title>')
html = html.replace(/<div class="brand">[\s\S]*?<\/div>/, '<div class="brand" id="brand">C++ <span>互动课堂</span></div>')
if (!html.includes('id="brand"')) fail('index.html: brand markup was not parameterized')
if (!html.includes('<link rel="icon"')) {
  html = html.replace('</head>', '  <link rel="icon" href="data:,">\n</head>')
}
for (const replacement of profile.htmlReplacements || []) {
  if (!html.includes(replacement.find)) fail(`index.html: replacement target not found: ${replacement.find.slice(0, 80)}`)
  html = html.split(replacement.find).join(replacement.replace)
}
fs.writeFileSync(siteIndexFile, html)

// 5. Stubs and the preview deck. The deck exercises the shell's declared
// slide types so the package can be checked before any lesson is placed in it.
const defaultMeta = {
  title: '空白课件',
  brandMain: 'C++',
  brandAccent: '互动课堂',
  lessonLabel: '',
  kicker: '智创学社 · 方块世界',
  endKicker: '智创学社 · 方块世界 · 探索完成',
  monitorTitle: 'Lesson.cpp',
  endMonitorTitle: '本课收获',
  coverCode: 'if (condition) {\n  choose();\n}',
  coverOutput: 'condition → choice → action',
  endCode: 'if (learned) {\n  create();\n}',
  endOutput: 'See you next time!',
  recap: ['会观察', '会判断', '会实践', '会总结'],
}
const previewMeta = { ...defaultMeta, ...(profile.deck.meta || {}) }
const deckStub = `// Generated by workflow/tools/extract-shell.mjs. This preview deck exercises
// every native slide type. A production deck replaces this file with the
// approved storyboard data.
window.COURSEWARE_SHELL_DATA = ${JSON.stringify({ meta: previewMeta, slides: profile.deck.slides }, null, 2)};
`
fs.writeFileSync(path.join(siteDir, 'deck.js'), deckStub)
fs.writeFileSync(path.join(siteDir, 'shell-art-data.js'), `// Intentionally empty at ingestion. generate-shell-art.mjs (or prepare-shell-site.mjs)
// fills this with per-lesson variants; reference/ is never copied into site/.
window.COURSEWARE_SHELL_ART = {};
`)
fs.writeFileSync(path.join(siteDir, 'narration-plan.js'), `// Shell stub: lesson narration is supplied per deck.
window.COURSEWARE_NARRATION_PLAN = { version: 1, pages: [] };
`)
fs.writeFileSync(path.join(siteDir, 'voice-manifest.js'), `// Shell stub: lesson audio files are supplied per deck.
window.COURSEWARE_VOICE_MANIFEST = {
  version: 1,
  voices: [
    { id: 'xiaolai', name: '小来老师', voice: 'zh-CN-XiaoxiaoNeural' },
    { id: 'xiaochuang', name: '小创老师', voice: 'zh-CN-YunyangNeural' },
    { id: 'xiaozhi', name: '小智', voice: 'zh-CN-YunxiaNeural' },
    { id: 'xiaowei', name: '小未', voice: 'zh-CN-XiaoyiNeural' },
  ],
  pages: [],
};
`)

// 6. Reference art for style comparison only. Never copied into site/.
const illustrations = []
if (artDir) {
  if (!fs.existsSync(artDir)) fail(`art dir not found: ${artDir}`)
  fs.mkdirSync(path.join(outDir, 'reference'), { recursive: true })
  for (const art of profile.illustrations || []) {
    const base = path.basename(art.reference)
    const src = path.join(artDir, base)
    if (!fs.existsSync(src)) fail(`reference art missing: ${src}`)
    copyFile(src, path.join(outDir, art.reference))
    illustrations.push({ ...art, referenceSha256: sha256(src), referenceBytes: fs.statSync(src).size })
  }
} else {
  for (const art of profile.illustrations || []) illustrations.push({ ...art, referenceSha256: '', referenceBytes: 0 })
}

// 7. Baseline. The blank preview screenshot is preferred; the reference art
// keeps validate-style-pack --check-baselines usable before a screenshot exists.
fs.mkdirSync(path.join(outDir, 'baselines'), { recursive: true })
const baselineDest = path.join(outDir, 'baselines', 'shell.png')
if (baselineArg) {
  if (!fs.existsSync(baselineArg)) fail(`baseline not found: ${baselineArg}`)
  copyFile(baselineArg, baselineDest)
} else if (illustrations[0]?.referenceSha256) {
  copyFile(path.join(outDir, illustrations[0].reference), baselineDest)
} else {
  fs.writeFileSync(baselineDest, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ))
}

// 8. Manifests.
const now = new Date().toISOString()
writeJson(path.join(outDir, 'SOURCE.json'), {
  schemaVersion: '1.0',
  description: 'Byte-for-byte reference source copied at ingestion. The site/ renderer is transformed; these hashes anchor the original shell.',
  reference: {
    label: 'reference courseware supplied by the user',
    profile: profile.id,
    entry: 'index.html',
  },
  generatedAt: now,
  files: sourceFiles.map((file) => {
    const full = path.join(outDir, file)
    return { file, sha256: sha256(full), bytes: fs.statSync(full).size }
  }),
})

const components = (profile.components || []).map((c) => ({
  id: c.id,
  name: c.name,
  category: c.category,
  status: 'core',
  kind: 'reference',
  propsSchema: { type: 'object', additionalProperties: true },
  states: c.states || ['default'],
  whenToUse: c.whenToUse,
  whenNotToUse: c.whenNotToUse,
  learningFunction: c.learningFunction,
  accessibility: { keyboard: '键盘可达', focus: '可见焦点', contrast: 'AA' },
  baseline: 'baselines/shell.png',
  sourceTypes: [c.type],
  implementation: `site/lesson.js#renderContent:${c.type}`,
}))

writeJson(path.join(outDir, 'style-pack.full.json'), {
  id,
  version,
  name: name || profile.name,
  kind: 'reference-shell',
  description: profile.description,
  components,
  layouts: profile.layouts || [],
})

// Freeze the full pack exactly as freeze-style-pack.mjs does: pack bytes plus
// every declared baseline. A later edit invalidates a production run.
const packFile = path.join(outDir, 'style-pack.full.json')
const freezeHash = crypto.createHash('sha256')
freezeHash.update(fs.readFileSync(packFile))
const baselineFiles = []
for (const component of components) {
  const baseline = path.resolve(outDir, component.baseline)
  const rel = path.relative(outDir, baseline)
  baselineFiles.push(rel)
}
baselineFiles.sort()
for (const rel of baselineFiles) {
  freezeHash.update(rel)
  freezeHash.update(fs.readFileSync(path.join(outDir, rel)))
}
writeJson(path.join(outDir, 'style-pack.freeze.json'), {
  id,
  version,
  sourceHash: freezeHash.digest('hex'),
  frozenAt: now,
  packPath: path.relative(process.cwd(), packFile),
  components: components.length,
  layouts: (profile.layouts || []).length,
  baselineFiles,
})

writeJson(path.join(outDir, 'style-pack.manifest.json'), {
  id,
  version,
  name: name || profile.name,
  kind: 'reference-shell',
  source: 'site',
  description: profile.description,
  components: components.map((c) => ({ id: c.id, status: c.status, name: c.name, category: c.category, sourceTypes: c.sourceTypes })),
  layouts: profile.layouts || [],
})

const fidelityComponents = {
  'app-shell': {
    sourceTypes: [],
    selectors: profile.fidelity.shellSelectors,
  },
}
for (const c of profile.components || []) {
  fidelityComponents[c.id] = {
    sourceTypes: [c.type],
    selectors: profile.fidelity.typeSelectors?.[c.type] || ['.slide-inner'],
  }
}
writeJson(path.join(outDir, 'fidelity.json'), {
  schemaVersion: '1.0',
  description: 'Shell fidelity contract: selectors are checked against the rendered shell; source hashes live in SOURCE.json.',
  viewports: {
    'desktop-1440x900': { width: 1440, height: 900, stage: { width: 1380, height: 742 }, topbarHeight: 60, footerHeight: 66 },
  },
  shell: {
    selectors: profile.fidelity.shellSelectors,
    requiredCss: profile.fidelity.requiredCss,
  },
  animations: {},
  components: fidelityComponents,
})

writeJson(path.join(outDir, 'shell.json'), {
  schemaVersion: '1.0',
  id,
  name: name || profile.name,
  version,
  profile: profile.id,
  description: profile.description,
  createdAt: now,
  source: {
    label: 'reference courseware supplied by the user',
    entry: 'site/index.html',
    lesson: 'site/lesson.js',
    sourceManifest: 'SOURCE.json',
    fidelity: 'fidelity.json',
    stylePack: 'style-pack.manifest.json',
    stylePackFull: 'style-pack.full.json',
    stylePackFreeze: 'style-pack.freeze.json',
  },
  viewport: { width: 1440, height: 900 },
  dataContract: {
    globals: ['COURSEWARE_SHELL_DATA', 'COURSEWARE_SHELL_ART', 'COURSEWARE_NARRATION_PLAN', 'COURSEWARE_VOICE_MANIFEST'],
    deck: { meta: 'object', slides: 'array' },
    slideTypes: profile.slideTypes,
    debug: 'COURSEWARE_DEBUG',
  },
  assets: {
    static: 'site/assets',
    postprocess: profile.artPostprocess || null,
    illustrations: illustrations.map((art) => ({
      slot: art.slot,
      reference: art.reference,
      referenceSha256: art.referenceSha256,
      referenceBytes: art.referenceBytes,
      selector: art.selector,
      className: art.className || 'pixel-student generated-mascot',
      alt: art.alt,
      ratio: art.ratio,
      size: art.size,
      blend: art.blend,
      prompt: art.prompt,
    })),
  },
  policy: {
    ingestion: 'reference shell source and illustration crops are copied into the library for fidelity',
    generation: 'every illustration slot must be regenerated per lesson; reference/ must never be copied into a generated site',
    narration: 'narration-plan.js and voice-manifest.js are lesson inputs, not shell inputs',
  },
  licensing: {
    referenceUse: 'authorized by the user for local courseware production',
    redistribution: 'reference source and assets are not cleared for redistribution',
  },
})

// 9. Library index.
let index = { schemaVersion: '1.0', shells: [] }
if (fs.existsSync(indexFile)) {
  try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')) } catch { /* rewritten below */ }
}
index.shells = (index.shells || []).filter((entry) => entry.id !== id)
index.shells.push({
  id,
  name: name || profile.name,
  version,
  path: path.relative(path.dirname(indexFile), outDir).split(path.sep).join('/'),
  profile: profile.id,
  slideTypes: profile.slideTypes,
})
index.shells.sort((a, b) => a.id.localeCompare(b.id))
index.updatedAt = now
writeJson(indexFile, index)

// 10. Syntax gate.
for (const file of ['lesson.js', 'deck.js', 'shell-art-data.js', 'narration-plan.js', 'voice-manifest.js']) {
  try {
    execFileSync(process.execPath, ['--check', path.join(siteDir, file)], { stdio: 'pipe' })
  } catch (error) {
    fail(`${file} failed node --check:\n${error.stderr?.toString() || error.message}`)
  }
}

console.log(`OK shell ${id} -> ${path.relative(process.cwd(), outDir) || outDir}`)
console.log(`   source files: ${sourceFiles.length} (hashed in SOURCE.json)`)
console.log(`   slide types: ${profile.slideTypes.length}`)
console.log(`   components: ${components.length}`)
console.log(`   illustrations: ${illustrations.length}`)
console.log(`   index: ${path.relative(process.cwd(), indexFile) || indexFile}`)
