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
import fs from 'node:fs'
import path from 'node:path'
import { parseScript, extractFencedBlocks } from './script-lib.mjs'
import { readData } from './lib.mjs'

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

function normalizeOptionText(value) {
  return String(value ?? '')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function letterForIndex(index) {
  return String.fromCharCode(65 + index)
}

function parseOptionBlock(content) {
  const lines = String(content || '').split(/\r?\n/)
  const parsed = []
  let current = null
  for (const raw of lines) {
    const match = raw.match(/^\s*([A-Z])\s*[.．、)]\s*(.*)$/)
    if (match) {
      if (current) parsed.push(current)
      current = { letter: match[1], text: [match[2]] }
    } else if (current) {
      current.text.push(raw)
    }
  }
  if (current) parsed.push(current)
  return parsed
    .map((option) => ({
      letter: option.letter,
      text: normalizeOptionText(option.text.join('\n')),
    }))
    .filter((option) => option.text)
}

function sameTextMultiset(left, right) {
  const normalize = (values) => values.map(normalizeOptionText).sort().join('\u0000')
  return normalize(left) === normalize(right)
}

function matchContentItem(blockOptions, items) {
  return items.find((item) => {
    const itemOptions = item.options || []
    return (
      itemOptions.length === blockOptions.length &&
      sameTextMultiset(
        blockOptions.map((option) => option.text),
        itemOptions.map((option) => option.text),
      )
    )
  })
}

function checkSequentialLetters(where, letters, allowedCount) {
  const expected = letters.map((_, index) => letterForIndex(index))
  if (letters.join('') !== expected.join('')) {
    errors.push(
      `${where}: option markers are ${letters.join('/')}, expected ${expected.join('/')} in display order`,
    )
    return false
  }
  if (new Set(letters).size !== letters.length) {
    errors.push(`${where}: duplicate option markers (${letters.join('/')})`)
    return false
  }
  if (allowedCount !== letters.length) {
    errors.push(`${where}: expected ${allowedCount} option(s), got ${letters.length}`)
    return false
  }
  return true
}

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

  const contentItems = new Map(
    (content.items || [])
      .filter((item) => item.kind === 'quiz')
      .map((item) => [item.id, item]),
  )
  if (contentItems.size === 0) {
    errors.push(`${options.content}: no quiz items found`)
    return
  }

  for (const slide of parsed.slides) {
    if (options.slides && !options.slides.has(slide.id)) continue
    const refQuizIds = readScriptRefs(slide).filter((id) => contentItems.has(id))
    const candidates = refQuizIds.length
      ? refQuizIds.map((id) => contentItems.get(id))
      : [...contentItems.values()]
    const blocks = extractFencedBlocks(slide.screenContent)
      .map((block) => parseOptionBlock(block.content))
      .filter((blockOptions) => blockOptions.length >= 2)
    if (blocks.length === 0) {
      if (refQuizIds.length) {
        errors.push(`${slide.id}: references quiz item(s) ${refQuizIds.join(', ')} but has no option block`)
      }
      continue
    }

    const matchedIds = new Set()
    for (const blockOptions of blocks) {
      const item = matchContentItem(blockOptions, candidates.filter((candidate) => !matchedIds.has(candidate.id)))
      if (!item) {
        if (refQuizIds.length) {
          errors.push(
            `${slide.id}: option block (${blockOptions.map((option) => option.letter).join('/')}) ` +
              `does not match any referenced quiz item (${refQuizIds.join(', ')})`,
          )
        }
        continue
      }
      matchedIds.add(item.id)
      const quizType = item.quizType || 'single'
      if (quizType === 'multi') {
        skipped.push({ id: item.id, slideId: slide.id, reason: 'multi-select' })
        continue
      }

      const correct = (item.options || []).filter((option) => option.correct)
      if (correct.length !== 1) {
        errors.push(`${item.id} (${slide.id}): expected exactly 1 correct option, got ${correct.length}`)
        continue
      }
      const correctText = normalizeOptionText(correct[0].text)
      const position = blockOptions.findIndex((option) => option.text === correctText)
      if (position < 0) {
        errors.push(`${item.id} (${slide.id}): correct option text not found in the script block`)
        continue
      }
      if (!checkSequentialLetters(`${item.id} (${slide.id})`, blockOptions.map((option) => option.letter), blockOptions.length)) {
        continue
      }
      addQuestion({
        id: item.id,
        slideId: slide.id,
        answer: blockOptions[position].letter,
        position: position + 1,
        optionCount: blockOptions.length,
        source: 'script',
      })
    }

    for (const id of refQuizIds) {
      if (!matchedIds.has(id)) errors.push(`${slide.id}: contentRef ${id} has no matching quiz block`)
    }
  }
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
      if (!checkSequentialLetters(`${id} (${slide.id})`, letters, questionOptions.length)) continue
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
const pass = errors.length === 0 && !allSame && !dominant

if (!pass) {
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
} else if (pass) {
  const letters = Object.keys(distribution)
    .sort()
    .map((letter) => `${letter}=${distribution[letter]}`)
    .join(' ')
  const summary = count
    ? `${count} single-select question(s); ${letters} (max ${Math.round(maxShare * 100)}%)`
    : 'no single-select question(s) in scope'
  console.log(`OK quiz keys — ${summary}`)
  for (const warning of warnings) console.error(`WARN quiz keys: ${warning}`)
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

process.exit(pass ? 0 : 1)
