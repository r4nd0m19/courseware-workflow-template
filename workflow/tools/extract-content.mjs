#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { validateWithSchema } from './lib.mjs'

const args = process.argv.slice(2)
const crawlDir = args.find((a) => !a.startsWith('--'))
function opt(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
if (!crawlDir) {
  console.error(`usage: node extract-content.mjs <crawl-dir> [options]

Options:
  --out <file>           output content pack (default: <crawl-dir>/content-pack.draft.json)
  --lesson-id <id>       lesson id (default: reference-lesson)
  --lesson-title <text>  lesson title (default: first page title)
  --audience <text>      audience (default: empty)
  --max-items <n>        item cap (default: 500)
`)
  process.exit(2)
}

const outFile = path.resolve(
  opt('--out', path.join(crawlDir, 'content-pack.draft.json')),
)
const maxItems = Number(opt('--max-items', '500'))
const crawl = JSON.parse(fs.readFileSync(path.join(crawlDir, 'crawl.json'), 'utf8'))
const pages = crawl.pages.map((p) =>
  JSON.parse(fs.readFileSync(path.join(crawlDir, 'pages', `${String(p.page).padStart(3, '0')}.json`), 'utf8')),
)

const lessonTitle =
  opt('--lesson-title', pages.find((p) => p.title)?.title || 'Reference lesson')
const lessonId = opt('--lesson-id', 'reference-lesson')
const audience = opt('--audience', '')

const counters = { K: 0, E: 0, Q: 0, S: 0, P: 0, N: 0 }
const items = []
const seen = new Set()
const report = {
  source: crawl.sourceUrl,
  capturedAt: crawl.capturedAt,
  pages: pages.length,
  stoppedReason: crawl.stoppedReason,
  duplicatesSkipped: 0,
  byKind: {},
  sensitivePages: [],
  quizzesWithoutAnswer: [],
  examplesWithoutOutput: [],
}

function sensitive(text) {
  const s = String(text || '')
  return (
    /[\w.+-]+@[\w-]+\.[\w.]+/.test(s) ||
    /1[3-9]\d{9}/.test(s) ||
    /\d{17}[\dXx]/.test(s) ||
    /(姓名|学号|身份证|手机号|住址|家庭住址)/.test(s)
  )
}

function add(kind, page, fields, prefix) {
  const id = `${prefix}${String(++counters[prefix]).padStart(2, '0')}`
  const allText = [fields.text, fields.code, ...(fields.options || []).map((o) => o.text)]
    .filter(Boolean)
    .join('\n')
  const personal = sensitive(allText)
  const notes = []
  if (personal) {
    notes.push('personal data detected; redact or exclude before implementation')
    if (!report.sensitivePages.includes(page.page)) report.sensitivePages.push(page.page)
  }
  if (kind === 'quiz' && !(fields.options || []).some((o) => o.correct)) {
    notes.push('correct answer not detected; review page HTML')
    report.quizzesWithoutAnswer.push({ page: page.page, title: fields.title })
  }
  if (kind === 'example' && !fields.output) {
    notes.push('output not detected; review page text/output blocks')
    report.examplesWithoutOutput.push({ page: page.page, title: fields.title })
  }
  const item = {
    id,
    kind,
    title: fields.title,
    required: true,
    sourcePage: page.page,
    sourceUrl: page.url,
    sensitivity: personal ? 'personal' : 'internal',
    reviewStatus: 'draft',
    notes: notes.join('; ') || 'draft; review',
    ...fields,
  }
  if (item.options && item.options.length < 2) {
    delete item.options
    item.kind = 'knowledge'
  }
  items.push(item)
  report.byKind[kind] = (report.byKind[kind] || 0) + 1
}

for (const page of pages) {
  if (items.length >= maxItems) break
  const title = (page.title || page.headings?.[0] || `Page ${page.page}`).trim()
  const text = (page.text || '').trim()
  const code = page.codeBlocks?.[0] || ''
  const options = page.options || []
  const output = page.outputBlocks?.[0] || ''

  let kind
  let prefix
  if (options.length >= 2) {
    kind = 'quiz'
    prefix = 'Q'
  } else if (code) {
    kind = 'example'
    prefix = 'E'
  } else if (/目录|小结|总结|章节|模块|课程结构/.test(title)) {
    kind = 'structure'
    prefix = 'S'
  } else if (text) {
    kind = 'knowledge'
    prefix = 'K'
  } else {
    continue
  }

  const normalized = `${kind}|${title}|${(text || code).slice(0, 200)}`
  if (seen.has(normalized)) {
    report.duplicatesSkipped += 1
    continue
  }
  seen.add(normalized)

  if (kind === 'quiz') {
    add(
      'quiz',
      page,
      {
        title,
        text: text.slice(0, 5000),
        options: options
          .filter((o) => o.text)
          .slice(0, 8)
          .map((o) => ({
            text: o.text.slice(0, 300),
            correct: !!o.correct,
            ...(o.feedback ? { feedback: o.feedback.slice(0, 500) } : {}),
          })),
      },
      'Q',
    )
  } else if (kind === 'example') {
    add(
      'example',
      page,
      {
        title,
        text: text.slice(0, 5000),
        code: code.slice(0, 20000),
        ...(output ? { output: output.slice(0, 2000) } : {}),
      },
      'E',
    )
  } else {
    add(kind, page, { title, text: text.slice(0, 8000) }, prefix)
  }
}

const pack = {
  version: '0.1.0-draft',
  source: crawl.sourceUrl,
  lesson: {
    id: lessonId,
    title: lessonTitle,
    ...(audience ? { audience } : {}),
  },
  items,
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify(pack, null, 2))
const reportFile = outFile.replace(/\.json$/i, '') + '.report.json'
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))

const schemaPath = new URL('../schemas/content-pack.schema.json', import.meta.url)
  .pathname
const check = validateWithSchema(schemaPath, pack)
console.log(`items: ${items.length}`, report.byKind)
console.log(`sensitive pages: ${report.sensitivePages.length}`)
console.log(`quizzes without detected answer: ${report.quizzesWithoutAnswer.length}`)
console.log(`examples without detected output: ${report.examplesWithoutOutput.length}`)
console.log(`wrote ${outFile}`)
console.log(`report ${reportFile}`)
if (!check.ok) {
  console.error('draft does not satisfy content-pack.schema.json:')
  for (const e of check.errors) console.error(`  ${e}`)
  process.exit(1)
}
console.log('schema OK (draft; review before use)')
