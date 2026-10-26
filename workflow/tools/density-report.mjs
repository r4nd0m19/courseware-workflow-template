#!/usr/bin/env node
import { buildDensityReport, readSlideIds } from './density-lib.mjs'

const rawArgs = process.argv.slice(2)
const options = { slides: null, json: false }
const positionals = []
for (let i = 0; i < rawArgs.length; i += 1) {
  const arg = rawArgs[i]
  if (arg === '--slides') {
    options.slides = readSlideIds(rawArgs[i + 1] || '')
    i += 1
  } else if (arg === '--json') {
    options.json = true
  } else if (arg.startsWith('--')) {
    console.error(`unknown option ${arg}`)
    process.exit(2)
  } else {
    positionals.push(arg)
  }
}

const [scriptPath, storyboardPath = ''] = positionals
if (!scriptPath) {
  console.error(
    'usage: node density-report.mjs <courseware.md> [storyboard.yml] [--slides S04,S05,S06] [--json]',
  )
  process.exit(2)
}

let report
try {
  report = buildDensityReport(scriptPath, storyboardPath || null, options.slides)
} catch (err) {
  console.error(`FAIL density report — ${err.message}`)
  process.exit(1)
}

if (options.json) {
  const payload = {
    script: report.script,
    storyboard: report.storyboard,
    slides: report.slides.map((slide) => ({
      slideId: slide.slideId,
      semanticUnits: [],
      signals: slide.signals,
      complexity: slide.complexity,
      verdict: 'pass',
      notes: '',
    })),
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  process.exit(0)
}

console.log('屏幕  引用 表行 表列 文本行 代码行 要点 旁白句 屏幕字符')
for (const slide of report.slides) {
  const s = slide.signals
  console.log(
    [
      slide.slideId.padEnd(4),
      String(s.contentRefs).padStart(4),
      String(s.tableRows).padStart(4),
      String(s.tableCols).padStart(4),
      String(s.textRows).padStart(6),
      String(s.codeLines).padStart(6),
      String(s.bulletItems).padStart(4),
      String(s.narrationSentences).padStart(6),
      String(s.screenChars).padStart(8),
    ].join(' '),
  )
}
console.log(
  '\n这些是客观信号，不是结论。请为每一屏写出 semanticUnits（本屏要求学生新建立的语义联系），' +
    '再判定 pass / exception / fail；超过 1 个单元必须拆分，或标为 exception 并写明理由。',
)
