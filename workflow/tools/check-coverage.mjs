import { fileURLToPath } from 'node:url'
import { readData, validateWithSchema, fail, ok } from './lib.mjs'

const [contentPath, storyboardPath, waiverPath] = process.argv.slice(2)
if (!contentPath || !storyboardPath) {
  console.error(
    'usage: node check-coverage.mjs <content-pack.json> <storyboard.yml> [waivers.json]',
  )
  process.exit(2)
}

const content = readData(contentPath)
const storyboard = readData(storyboardPath)
const errors = []

const contentCheck = validateWithSchema(
  fileURLToPath(new URL('../schemas/content-pack.schema.json', import.meta.url)),
  content,
)
for (const e of contentCheck.errors) errors.push(`content pack ${e}`)

const storyCheck = validateWithSchema(
  fileURLToPath(new URL('../schemas/storyboard.schema.json', import.meta.url)),
  storyboard,
)
for (const e of storyCheck.errors) errors.push(`storyboard ${e}`)

if (errors.length) {
  fail('schema validation', errors)
  process.exit(1)
}

const known = new Set(content.items.map((i) => i.id))
const required = content.items.filter((i) => i.required).map((i) => i.id)
const activeSlides = storyboard.slides.filter((s) => s.status !== 'SKIP')
const referenced = new Set(activeSlides.flatMap((s) => s.contentRefs || []))

const unknown = [...referenced].filter((id) => !known.has(id))
for (const id of unknown) errors.push(`storyboard references unknown content item ${id}`)

let waivers = new Set()
if (waiverPath) {
  const raw = readData(waiverPath)
  const list = Array.isArray(raw) ? raw : raw.waivers || []
  waivers = new Set(
    list.map((w) => (typeof w === 'string' ? w : w.id)).filter(Boolean),
  )
  for (const id of waivers) {
    if (!known.has(id)) errors.push(`waiver references unknown content item ${id}`)
    if (!required.includes(id)) errors.push(`waiver targets a non-required item ${id}`)
  }
}

const missing = required.filter((id) => !referenced.has(id) && !waivers.has(id))
for (const id of missing) {
  const item = content.items.find((i) => i.id === id)
  errors.push(`missing required content item ${id} (${item?.kind}: ${item?.title})`)
}

const covered = required.length - missing.length
const summary = `${covered}/${required.length} required items covered, ${waivers.size} waiver(s)`
if (errors.length) fail('content coverage', errors)
else ok('content coverage', summary)

if (errors.length) process.exit(1)
