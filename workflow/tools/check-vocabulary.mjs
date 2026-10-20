import { fileURLToPath } from 'node:url'
import { readData, validateWithSchema, fail, ok } from './lib.mjs'
import { parseScript } from './script-lib.mjs'

const rawArgs = process.argv.slice(2)
const positionals = []
let scriptPath = ''
for (let i = 0; i < rawArgs.length; i += 1) {
  const arg = rawArgs[i]
  if (arg === '--script') {
    scriptPath = rawArgs[i + 1] || ''
    i += 1
  } else if (arg.startsWith('--')) {
    console.error(`unknown option ${arg}`)
    process.exit(2)
  } else {
    positionals.push(arg)
  }
}
const [storyboardPath, stylePath, registryPath] = positionals
if (!storyboardPath || !stylePath) {
  console.error(
    'usage: node check-vocabulary.mjs <storyboard.yml> <style-pack-manifest.json> [component-registry.json] [--script <courseware.md>]',
  )
  process.exit(2)
}

const storyboard = readData(storyboardPath)
const style = readData(stylePath)
const registry = registryPath ? readData(registryPath) : null
const errors = []
const warnings = []

const storyCheck = validateWithSchema(
  fileURLToPath(new URL('../schemas/storyboard.schema.json', import.meta.url)),
  storyboard,
)
for (const e of storyCheck.errors) errors.push(`storyboard ${e}`)

const styleCheck = validateWithSchema(
  fileURLToPath(new URL('../schemas/style-pack-manifest.schema.json', import.meta.url)),
  style,
)
for (const e of styleCheck.errors) errors.push(`style pack ${e}`)

if (registry) {
  const registryCheck = validateWithSchema(
    fileURLToPath(new URL('../schemas/component-registry.schema.json', import.meta.url)),
    registry,
  )
  for (const e of registryCheck.errors) errors.push(`component registry ${e}`)
  if (
    !errors.length &&
    registry.stylePack &&
    (registry.stylePack.id !== style.id || registry.stylePack.version !== (style.version || ''))
  ) {
    errors.push(
      `component registry targets style pack ${registry.stylePack.id}@${registry.stylePack.version}, but style pack is ${style.id}@${style.version || '(no version)'}`,
    )
  }
}

if (errors.length) {
  fail('schema validation', errors)
  process.exit(1)
}

const components = new Set()
const generated = new Set()
// Layout ids may be bare strings or {id, description} objects.
const layouts = new Set(
  (style.layouts || []).map((l) => (typeof l === 'string' ? l : l?.id)).filter(Boolean),
)
for (const c of style.components || []) {
  // Style-pack entries marked `generated` describe a known design pattern
  // only; their implementation must come from the component registry. Without
  // this split a deck could use a widget that has no bundled implementation.
  if (c.kind === 'generated') generated.add(c.id)
  else components.add(c.id)
}
const deprecated = new Set()
if (registry) {
  for (const c of registry.components || []) {
    components.add(c.id)
    if (c.status === 'deprecated') deprecated.add(c.id)
  }
}

// A component declared new/extend in the approved script is built on the first
// page that needs it and registered core only after that page is approved.
// Until then it is allowed here so the storyboard can be projected page by page.
const pending = new Set()
if (scriptPath) {
  const script = parseScript(scriptPath)
  for (const slide of script.slides) {
    for (const item of slide.machine?.componentPlan || []) {
      if (item.status === 'new' || item.status === 'extend') pending.add(item.id)
    }
  }
}

for (const slide of storyboard.slides) {
  if (slide.status === 'SKIP') continue
  for (const c of slide.components || []) {
    if (!components.has(c) && pending.has(c)) {
      warnings.push(`slide ${slide.id} uses "${c}" declared new/extend; it must be built before this page is implemented`)
      continue
    }
    if (!components.has(c)) {
      errors.push(
        generated.has(c)
          ? `slide ${slide.id} uses generated component "${c}" but it is not registered core`
          : `slide ${slide.id} uses unregistered component "${c}"`,
      )
    } else if (deprecated.has(c)) {
      errors.push(`slide ${slide.id} uses deprecated component "${c}"`)
    }
  }
  if (!layouts.has(slide.layout)) {
    errors.push(`slide ${slide.id} uses unregistered layout "${slide.layout}"`)
  }
  for (const forbidden of ['style', 'css', 'html', 'className']) {
    if (Object.prototype.hasOwnProperty.call(slide, forbidden)) {
      errors.push(
        `slide ${slide.id} has per-lesson "${forbidden}" override; forbidden`,
      )
    }
  }
}

if (errors.length) fail('style vocabulary', errors)
else
  ok(
    'style vocabulary',
    `${storyboard.slides.length} slide(s), ${components.size} component(s), ${layouts.size} layout(s), ${pending.size} pending build(s)`,
  )
for (const w of warnings) console.log(`WARN ${w}`)

if (errors.length) process.exit(1)
