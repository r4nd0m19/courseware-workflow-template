#!/usr/bin/env node
// Answer-position distribution gate.
//
// The content pack lists the correct option first for every item; if the script
// or deck copies that order, every answer is A and students can stop reading the
// options. This gate checks the *displayed* correct position, not the option
// text. It is intentionally independent of check-teaching/check-script so a
// future renderer or hand edit cannot quietly reintroduce the same order.
//
// Usage:
//   node check-quiz-keys.mjs <courseware.md> --content <content-pack.json>
//     [--slides S03,S06] [--max-share 0.6] [--json]
//   node check-quiz-keys.mjs <deck.json>
//     [--slides S03,S06] [--max-share 0.6] [--json]
import path from 'node:path'
import { parseScript } from './script-lib.mjs'
import { readData } from './lib.mjs'
import {
  checkQuizSequentialLetters,
  collectQuizQuestions,
  letterForIndex,
} from './quiz-lib.mjs'

const args = process.argv.slice(2)
const positionals = []
const options = {
  content: '',
  slides: null,
  maxShare: 0.6,
  json: false,
}

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--content') {
    options.content = args[i + 1] || ''
    i += 1
  } else if (arg === '--slides') {
    const raw = args[i + 1] || ''
    options.slides = new Set(
      raw
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )
    i += 1
  } else if (arg === '--max-share') {
    const value = Number(args[i + 1])
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      console.error('FAIL quiz keys: --max-share must be a number in (0, 1]')
      process.exit(2)
    }
    options.maxShare = value
    i += 1
  } else if (arg === '--json') {
    options.json = true
  } else if (arg.startsWith('--')) {
    console.error(`FAIL quiz keys: unknown option ${arg}`)
    process.exit(2)
  } else {
    positionals.push(arg)
  }
}

const sourcePath = positionals[0]
if (!sourcePath) {
  console.error(`usage: node check-quiz-keys.mjs <courseware.md> --content <content-pack.json>
       [--slides S03,S06] [--max-share 0.6] [--json]
       node check-quiz-keys.mjs <deck.json> [--slides S03,S06] [--max-share 0.6] [--json]`)
  process.exit(2)
}

const errors = []
const warnings = []
const questions = []
const skipped = []

function addQuestion(record) {
  questions.push(record)
}

function readScriptRefs(slide) {
  if (Array.isArray(slide.machine?.contentRefs)) return slide.machine.contentRefs
  const raw = slide.contentLine || ''
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

function runScriptMode() {
  if (!options.content) {
    errors.push('script mode requires --content <content-pack.json>')
    return
  }
  let parsed
  let content
  try {
    parsed = parseScript(sourcePath)
    content = readData(options.content)
  } catch (error) {
    errors.push(error.message)
    return
  }

  const quizItems = (content.items || []).filter((item) => item.kind === 'quiz')
  if (quizItems.length === 0) {
    errors.push(`${options.content}: no quiz items found`)
    return
  }

  const slides = parsed.slides.map((slide) => ({
    id: slide.id,
    screenContent: slide.screenContent,
    interaction: slide.machine?.interaction,
    contentRefs: readScriptRefs(slide),
  }))
  const audit = collectQuizQuestions(slides, quizItems, {
    maxShare: options.maxShare,
    slideIds: options.slides,
  })
  errors.push(...audit.errors, ...audit.distributionErrors)
  warnings.push(...audit.warnings)
  questions.push(...audit.questions)
  skipped.push(...audit.skipped)
}

function runDeckMode() {
  let deck
  try {
    deck = readData(sourcePath)
  } catch (error) {
    errors.push(error.message)
    return
  }
  if (!Array.isArray(deck.slides)) {
    errors.push(`${sourcePath}: expected a deck object with a slides array`)
    return
  }

  for (const slide of deck.slides) {
    if (options.slides && !options.slides.has(slide.id)) continue
    if (slide.component !== 'quiz-bank') continue
    const quizQuestions = slide.props?.questions || []
    if (!Array.isArray(quizQuestions) || quizQuestions.length === 0) {
      errors.push(`${slide.id}: quiz-bank has no questions`)
      continue
    }
    for (const [index, question] of quizQuestions.entries()) {
      const id = question.id || `${slide.id}-Q${index + 1}`
      const quizType = question.quizType || question.type || 'single'
      if (quizType === 'multi') {
        skipped.push({ id, slideId: slide.id, reason: 'multi-select' })
        continue
      }
      const questionOptions = question.options || []
      if (questionOptions.length < 2) {
        errors.push(`${id} (${slide.id}): needs at least 2 options, got ${questionOptions.length}`)
        continue
      }
      const letters = questionOptions.map((option, optionIndex) =>
        typeof option.id === 'string' && /^[A-Z]$/.test(option.id)
          ? option.id
          : letterForIndex(optionIndex),
      )
      const letterErrors = checkQuizSequentialLetters(
        `${id} (${slide.id})`,
        letters,
        questionOptions.length,
      )
      if (letterErrors.length) {
        errors.push(...letterErrors)
        continue
      }
      const correct = questionOptions.filter((option) => option.correct)
      if (correct.length !== 1) {
        errors.push(`${id} (${slide.id}): expected exactly 1 correct option, got ${correct.length}`)
        continue
      }
      const position = questionOptions.findIndex((option) => option.correct)
      addQuestion({
        id,
        slideId: slide.id,
        answer: letters[position],
        position: position + 1,
        optionCount: questionOptions.length,
        source: 'deck',
      })
    }
  }
}

const isJson = path.extname(sourcePath).toLowerCase() === '.json'
if (isJson) runDeckMode()
else runScriptMode()

const distribution = {}
for (const question of questions) {
  distribution[question.answer] = (distribution[question.answer] || 0) + 1
}
const count = questions.length
const maxCount = count ? Math.max(...Object.values(distribution)) : 0
const maxShare = count ? maxCount / count : 0
const allSame = count >= 2 && maxCount === count
// Sections often contain only two questions; for those, only the all-same
// pattern is a real cue. The share threshold applies once a set is large enough
// for a dominant position to be a pattern.
const dominant = count >= 4 && maxShare > options.maxShare

// Script mode gets distribution errors from collectQuizQuestions so the
// generator and the gate share one implementation. Deck mode still computes
// them from its own question list here.
if (isJson) {
  if (allSame) {
    const letter = Object.keys(distribution).find((key) => distribution[key] === count)
    errors.push(
      `all ${count} correct answers are at position ${letter}; reorder the options so students must read every choice`,
    )
  }
  if (dominant) {
    const [letter, n] = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0]
    errors.push(
      `position ${letter} holds ${n}/${count} correct answers (${Math.round(maxShare * 100)}%) ` +
        `which exceeds the ${Math.round(options.maxShare * 100)}% limit`,
    )
  }
}
const pass = errors.length === 0

const result = {
  ok: pass,
  source: path.resolve(sourcePath),
  mode: isJson ? 'deck' : 'script',
  questions,
  skipped,
  distribution,
  maxShare: Number(maxShare.toFixed(4)),
  threshold: options.maxShare,
  errors,
  warnings,
}

if (options.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} else {
  for (const warning of warnings) console.error(`WARN quiz keys: ${warning}`)
  if (pass) {
    const letters = Object.keys(distribution)
      .sort()
      .map((letter) => `${letter}=${distribution[letter]}`)
      .join(' ')
    const summary = count
      ? `${count} single-select question(s); ${letters} (max ${Math.round(maxShare * 100)}%)`
      : 'no single-select question(s) in scope'
    console.log(`OK quiz keys — ${summary}`)
  } else {
    console.error('FAIL quiz keys')
    for (const error of errors) console.error(`  ${error}`)
    if (count) {
      const letters = Object.keys(distribution)
        .sort()
        .map((letter) => `${letter}=${distribution[letter]}`)
        .join(' ')
      console.error(`  distribution: ${letters} (max ${Math.round(maxShare * 100)}%)`)
    }
  }
}

process.exit(pass ? 0 : 1)
