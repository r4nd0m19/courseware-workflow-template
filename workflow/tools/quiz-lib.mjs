// Shared quiz-option rules for the script generator and the answer-position gate.
//
// The content pack lists the correct option first for every quiz item. The
// generator may reorder options, but it must keep the question and every option
// text verbatim and place answer-page options in one fenced block with
// sequential A/B/C markers. This module owns that contract so generation-time
// validation and the final deterministic gate cannot drift apart.
import { extractFencedBlocks } from './script-lib.mjs'

export function letterForIndex(index) {
  return String.fromCharCode(65 + index)
}

// Compare option text independent of Markdown inline code/emphasis. A model
// often wraps a code-like choice in backticks even when the content pack does
// not; that is a rendering difference, not a different answer.
export function normalizeQuizOptionText(value) {
  return String(value ?? '')
    .replace(/\\n/g, ' ')
    // Inline code is a rendering wrapper, not part of the option.
    .replace(/`([^`]*)`/g, '$1')
    // Strip emphasis only when the markers are complete delimiters and not
    // part of a star run. Options that are themselves star patterns
    // (e.g. "****\n****") must stay intact.
    .replace(/(^|[\s（(])\*\*(?!\*)([^*\n]+?)(?<!\*)\*\*(?=$|[\s，。；;）)])/g, '$1$2')
    .replace(/(^|[\s（(])\*(?!\*)([^*\n]+?)(?<!\*)\*(?=$|[\s，。；;）)])/g, '$1$2')
    .replace(/(^|[\s（(])__(?!_)([^_\n]+?)(?<!_)__(?=$|[\s，。；;）)])/g, '$1$2')
    .replace(/(^|[\s（(])_(?!_)([^_\n]+?)(?<!_)_(?=$|[\s，。；;）)])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseQuizOptionBlock(content) {
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
      text: normalizeQuizOptionText(option.text.join('\n')),
    }))
    .filter((option) => option.text)
}

export function extractQuizOptionBlocks(screenContent) {
  return extractFencedBlocks(screenContent)
    .map((block) => parseQuizOptionBlock(block.content))
    .filter((blockOptions) => blockOptions.length >= 2)
}

export function sameQuizOptionMultiset(left, right) {
  const normalize = (values) => values.map(normalizeQuizOptionText).sort().join('\u0000')
  return normalize(left) === normalize(right)
}

export function quizItemOptionTexts(item) {
  return (item?.options || []).map((option) =>
    typeof option === 'string' ? option : option?.text,
  )
}

export function matchQuizItem(blockOptions, items) {
  return items.find((item) => {
    const itemOptions = quizItemOptionTexts(item)
    return (
      itemOptions.length === blockOptions.length &&
      sameQuizOptionMultiset(
        blockOptions.map((option) => option.text),
        itemOptions,
      )
    )
  })
}

export function checkQuizSequentialLetters(where, letters, allowedCount) {
  const errors = []
  const expected = letters.map((_, index) => letterForIndex(index))
  if (letters.join('') !== expected.join('')) {
    errors.push(
      `${where}: option markers are ${letters.join('/')}, expected ${expected.join('/')} in display order`,
    )
    return errors
  }
  if (new Set(letters).size !== letters.length) {
    errors.push(`${where}: duplicate option markers (${letters.join('/')})`)
    return errors
  }
  if (allowedCount !== letters.length) {
    errors.push(`${where}: expected ${allowedCount} option(s), got ${letters.length}`)
  }
  return errors
}

// A watch page may preview a quiz item, but it never asks the learner to
// commit to an answer. Only non-watch pages participate in the answer-position
// distribution. A script without machine fields keeps the legacy behaviour and
// is treated as an answer page.
export function isQuizAnswerInteraction(interaction) {
  if (!interaction || typeof interaction !== 'object') return true
  return String(interaction.level || '').trim().toLowerCase() !== 'watch'
}

export function summarizeQuizDistribution(questions, maxShare = 0.6) {
  const distribution = {}
  for (const question of questions) {
    distribution[question.answer] = (distribution[question.answer] || 0) + 1
  }
  const count = questions.length
  const maxCount = count ? Math.max(...Object.values(distribution)) : 0
  const share = count ? maxCount / count : 0
  const allSame = count >= 2 && maxCount === count
  // Sections often contain only two questions; for those, only the all-same
  // pattern is a real cue. The share threshold applies once a set is large
  // enough for a dominant position to be a pattern.
  const dominant = count >= 4 && share > maxShare
  const errors = []
  if (allSame) {
    const letter = Object.keys(distribution).find((key) => distribution[key] === count)
    errors.push(
      `all ${count} correct answers are at position ${letter}; reorder the options so students must read every choice`,
    )
  }
  if (dominant) {
    const [letter, n] = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0]
    errors.push(
      `position ${letter} holds ${n}/${count} correct answers (${Math.round(share * 100)}%) ` +
        `which exceeds the ${Math.round(maxShare * 100)}% limit`,
    )
  }
  return {
    distribution,
    count,
    maxCount,
    maxShare: share,
    allSame,
    dominant,
    errors,
  }
}

// Normalized slide shape:
//   { id, screenContent, interaction, contentRefs }
// `interaction` is the machine interaction object (level is what matters).
// `quizItems` are content-pack items with kind === 'quiz' (or an options array).
export function collectQuizQuestions(slides, quizItems, options = {}) {
  const maxShare = Number.isFinite(options.maxShare) ? options.maxShare : 0.6
  const quizById = new Map(
    (quizItems || [])
      .filter((item) => item && item.id && (item.kind === 'quiz' || Array.isArray(item.options)))
      .map((item) => [item.id, item]),
  )
  const errors = []
  const warnings = []
  const skipped = []
  const questions = []
  const answeredOn = new Map()
  const watchRefs = new Set()

  if (quizById.size === 0) {
    return {
      questions,
      skipped,
      warnings,
      errors: ['no quiz items found'],
      distributionErrors: [],
      distribution: {},
      count: 0,
      maxCount: 0,
      maxShare: 0,
      allSame: false,
      dominant: false,
      pass: false,
    }
  }

  for (const slide of slides || []) {
    if (options.slideIds && !options.slideIds.has(slide.id)) continue
    const refQuizIds = (Array.isArray(slide.contentRefs) ? slide.contentRefs : []).filter((id) =>
      quizById.has(id),
    )
    if (!isQuizAnswerInteraction(slide.interaction)) {
      for (const id of refQuizIds) watchRefs.add(id)
      continue
    }

    const candidates = refQuizIds.length
      ? refQuizIds.map((id) => quizById.get(id))
      : [...quizById.values()]
    const blocks = extractQuizOptionBlocks(slide.screenContent)
    if (blocks.length === 0) {
      if (refQuizIds.length) {
        errors.push(`${slide.id}: references quiz item(s) ${refQuizIds.join(', ')} but has no option block`)
      }
      continue
    }

    const matchedIds = new Set()
    for (const blockOptions of blocks) {
      const item = matchQuizItem(
        blockOptions,
        candidates.filter((candidate) => !matchedIds.has(candidate.id)),
      )
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

      const correct = (item.options || []).filter((option) => option && option.correct)
      if (correct.length !== 1) {
        errors.push(`${item.id} (${slide.id}): expected exactly 1 correct option, got ${correct.length}`)
        continue
      }
      const correctText = normalizeQuizOptionText(correct[0].text)
      const position = blockOptions.findIndex((option) => option.text === correctText)
      if (position < 0) {
        errors.push(`${item.id} (${slide.id}): correct option text not found in the script block`)
        continue
      }
      const letterErrors = checkQuizSequentialLetters(
        `${item.id} (${slide.id})`,
        blockOptions.map((option) => option.letter),
        blockOptions.length,
      )
      if (letterErrors.length) {
        errors.push(...letterErrors)
        continue
      }
      if (answeredOn.has(item.id)) {
        warnings.push(
          `${slide.id}: quiz item ${item.id} is already answered on ${answeredOn.get(item.id)}; counting it once`,
        )
        continue
      }
      answeredOn.set(item.id, slide.id)
      questions.push({
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

  for (const id of watchRefs) {
    if (!answeredOn.has(id)) {
      warnings.push(`${id}: referenced only by watch page(s); no answer page was checked`)
    }
  }

  const summary = summarizeQuizDistribution(questions, maxShare)
  return {
    questions,
    skipped,
    warnings,
    errors,
    distributionErrors: summary.errors,
    distribution: summary.distribution,
    count: summary.count,
    maxCount: summary.maxCount,
    maxShare: summary.maxShare,
    allSame: summary.allSame,
    dominant: summary.dominant,
    pass: errors.length === 0 && summary.errors.length === 0,
  }
}
