import { fileURLToPath } from 'node:url'
import { readData, validateWithSchema, fail, ok } from './lib.mjs'

const [storyboardPath, contentPath] = process.argv.slice(2)
if (!storyboardPath || !contentPath) {
  console.error(
    'usage: node check-teaching.mjs <storyboard.yml> <content-pack.json>',
  )
  process.exit(2)
}

const storyboard = readData(storyboardPath)
const content = readData(contentPath)
const errors = []

const storyCheck = validateWithSchema(
  fileURLToPath(new URL('../schemas/storyboard.schema.json', import.meta.url)),
  storyboard,
)
for (const e of storyCheck.errors) errors.push(`storyboard ${e}`)

const contentCheck = validateWithSchema(
  fileURLToPath(new URL('../schemas/content-pack.schema.json', import.meta.url)),
  content,
)
for (const e of contentCheck.errors) errors.push(`content pack ${e}`)

if (errors.length) {
  fail('schema validation', errors)
  process.exit(1)
}

for (const item of content.items) {
  if (item.reviewStatus !== 'reviewed') {
    errors.push(
      `content item ${item.id} (${item.title}) is not reviewed (reviewStatus=${item.reviewStatus || 'missing'})`,
    )
  }
}

const active = storyboard.slides.filter((s) => s.status !== 'SKIP')
const seenIds = new Set()
for (const slide of active) {
  if (seenIds.has(slide.id)) errors.push(`duplicate slide id ${slide.id}`)
  seenIds.add(slide.id)
}

const objectives = new Map()
let answerLevel = 0
let watchLevel = 0
for (const slide of active) {
  const rec = objectives.get(slide.objectiveId) || {
    objective: slide.objective,
    slides: [],
    answer: 0,
    watch: 0,
  }
  rec.slides.push(slide.id)
  if (slide.interaction) {
    if (slide.interaction.level === 'watch') {
      rec.watch += 1
      watchLevel += 1
    } else {
      rec.answer += 1
      answerLevel += 1
    }
  }
  objectives.set(slide.objectiveId, rec)
}

for (const [id, rec] of objectives) {
  if (rec.answer === 0) {
    errors.push(
      `objective ${id} has no answer-level interaction (I3); slides: ${rec.slides.join(', ')}`,
    )
  }
}

let quizCount = 0
for (const item of content.items) {
  if (item.kind !== 'quiz') continue
  quizCount += 1
  const options = item.options || []
  const correct = options.filter((o) => o.correct).length
  const quizType = item.quizType || 'single'
  if (quizType === 'multi') {
    if (correct < 1) {
      errors.push(`${item.id} (${item.title}): multi-select quiz needs at least one correct option`)
    }
  } else if (correct !== 1) {
    errors.push(`${item.id} (${item.title}): exactly one correct option required, got ${correct}`)
  }
  options.forEach((o, i) => {
    if (!o.feedback || !o.feedback.trim()) {
      errors.push(`${item.id} (${item.title}): option ${i + 1} has no feedback (I5)`)
    }
  })
}

const summary = `${active.length} slide(s), ${objectives.size} objective(s), ${answerLevel} answer-level, ${watchLevel} watch-level, ${quizCount} quiz item(s)`
if (errors.length) fail('teaching gates', errors)
else ok('teaching gates', summary)

if (errors.length) process.exit(1)
