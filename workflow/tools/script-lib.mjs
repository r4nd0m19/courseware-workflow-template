import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

const SECTION_ALIASES = {
  screen: ['屏幕内容', 'screencontent', 'screen'],
  interaction: ['交互设计', 'interactiondesign', 'interaction'],
  narration: ['旁白语音', '旁白', '语音', 'narration', 'voice'],
  transition: ['转场', 'transition'],
  machine: ['制作字段', '机器字段', '机器可读摘要', 'machinefields', 'machine'],
}

export function canonicalHeading(heading) {
  let s = String(heading || '')
    .trim()
    .toLowerCase()
    .replace(/^\d+\s*[.、)）]\s*/, '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/\s+/g, '')
    .replace(/[：:/·、]/g, '')
  s = s.replace(/[^\p{L}\p{N}]/gu, '')
  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.includes(s)) return key
  }
  return `unknown:${s || 'empty'}`
}

export function extractFencedBlocks(text) {
  const lines = String(text || '').split(/\r?\n/)
  const blocks = []
  let current = null
  for (const line of lines) {
    const m = line.match(/^\s*(`{3,}|~{3,})\s*([^\s`~]*)\s*$/)
    if (m) {
      if (!current) {
        current = { marker: m[1][0], lang: (m[2] || '').toLowerCase(), lines: [] }
      } else if (line.trim().startsWith(current.marker)) {
        blocks.push({ lang: current.lang, content: current.lines.join('\n') })
        current = null
      } else {
        current.lines.push(line)
      }
    } else if (current) {
      current.lines.push(line)
    }
  }
  return blocks
}

export function parseMarkdownSections(markdown) {
  const lines = String(markdown || '').split(/\r?\n/)
  const sections = []
  let current = null
  let fence = null
  for (const line of lines) {
    const fm = line.match(/^\s*(`{3,}|~{3,})/)
    if (fm) {
      if (!fence) fence = fm[1][0]
      else if (line.trim().startsWith(fence)) fence = null
      if (current) current.body.push(line)
      continue
    }
    if (!fence) {
      const hm = line.match(/^(#{1,6})\s+(.+?)\s*$/)
      if (hm) {
        if (current) sections.push(current)
        current = { level: hm[1].length, heading: hm[2].trim(), body: [] }
        continue
      }
    }
    if (current) current.body.push(line)
  }
  if (current) sections.push(current)
  return sections.map((s) => ({
    level: s.level,
    heading: s.heading,
    canonical: canonicalHeading(s.heading),
    body: s.body.join('\n').trim(),
  }))
}

export function findSection(markdown, heading) {
  const want = canonicalHeading(heading)
  return parseMarkdownSections(markdown).find((s) => s.canonical === want)
}

export function parseTableRows(body) {
  const rows = []
  for (const raw of String(body || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim())
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue
    rows.push(cells)
  }
  return rows
}

export function stripBlockquotes(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*>\s?/, ''))
    .join('\n')
    .trim()
}

function cleanSection(text) {
  return String(text || '').trim()
}

function parseSlideHeading(line) {
  const m = line.match(/^##\s+(S\d+[A-Z]?)\s*(?:[·:：\-—]\s*)?(.+?)\s*$/)
  if (!m) return null
  return { id: m[1], title: m[2].trim() }
}

export function parseScript(file) {
  const absolute = path.resolve(file)
  const text = fs.readFileSync(absolute, 'utf8')
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!fm) throw new Error(`${file}: missing YAML frontmatter (--- ... ---)`)
  const frontmatter = YAML.parse(fm[1]) || {}
  const body = text.slice(fm[0].length)
  const lines = body.split(/\r?\n/)

  const slides = []
  let slide = null
  let section = null
  let fence = null
  const metaLines = []

  const flushSection = () => {
    if (!slide || !section) return
    const key = canonicalHeading(section.heading)
    const bodyText = section.lines.join('\n')
    if (key.startsWith('unknown:')) {
      slide.unknownSections.push(section.heading)
    } else {
      slide.sections[key] = (slide.sections[key] || '') + (slide.sections[key] ? '\n' : '') + bodyText
    }
    section = null
  }
  const flushSlide = () => {
    flushSection()
    if (!slide) return
    slides.push(slide)
    slide = null
  }

  for (const line of lines) {
    const fmatch = line.match(/^\s*(`{3,}|~{3,})/)
    if (fmatch) {
      if (!fence) fence = fmatch[1][0]
      else if (line.trim().startsWith(fence)) fence = null
      if (slide && section) section.lines.push(line)
      continue
    }

    if (!fence) {
      const sh = parseSlideHeading(line)
      if (sh) {
        flushSlide()
        slide = {
          id: sh.id,
          headingTitle: sh.title,
          metaLines: [],
          sections: {},
          unknownSections: [],
        }
        section = null
        continue
      }
      const sub = line.match(/^###\s+(.+?)\s*$/)
      if (sub && slide) {
        flushSection()
        section = { heading: sub[1].trim(), lines: [] }
        continue
      }
    }

    if (slide && section) section.lines.push(line)
    else if (slide) slide.metaLines.push(line)
  }
  flushSlide()

  const metaPatterns = {
    objectiveLine: /^\*\*对应目标\*\*[：:]\s*(.+)$/,
    contentLine: /^\*\*内容来源\*\*[：:]\s*(.+)$/,
    purposeLine: /^\*\*本屏作用\*\*[：:]\s*(.+)$/,
  }

  const parsedSlides = slides.map((s) => {
    const meta = {}
    for (const line of s.metaLines) {
      for (const [key, re] of Object.entries(metaPatterns)) {
        const m = line.trim().match(re)
        if (m) meta[key] = m[1].trim()
      }
    }
    const machineText = s.sections.machine || ''
    const blocks = extractFencedBlocks(machineText)
    const yamlBlock =
      blocks.find((b) => b.lang === 'yaml' || b.lang === 'yml') || blocks[0]
    let machine = null
    if (yamlBlock) {
      try {
        machine =
          yamlBlock.lang === 'json' ? JSON.parse(yamlBlock.content) : YAML.parse(yamlBlock.content)
      } catch (err) {
        throw new Error(`${file}: ${s.id} 制作字段 YAML/JSON 解析失败: ${err.message}`)
      }
    }
    return {
      id: s.id,
      headingTitle: s.headingTitle,
      ...meta,
      screenContent: cleanSection(s.sections.screen),
      interactionDesign: cleanSection(s.sections.interaction),
      narration: stripBlockquotes(s.sections.narration || ''),
      transition: cleanSection(s.sections.transition),
      machine,
      unknownSections: s.unknownSections,
    }
  })

  return {
    path: absolute,
    frontmatter,
    slides: parsedSlides,
    toParsedObject() {
      return {
        ...frontmatter,
        slides: parsedSlides.map((s) => {
          const out = {
            id: s.id,
            headingTitle: s.headingTitle,
            screenContent: s.screenContent,
            interactionDesign: s.interactionDesign,
            narration: s.narration,
            machine: s.machine,
          }
          if (s.objectiveLine) out.objectiveLine = s.objectiveLine
          if (s.contentLine) out.contentLine = s.contentLine
          if (s.purposeLine) out.purposeLine = s.purposeLine
          if (s.transition) out.transition = s.transition
          return out
        }),
      }
    },
  }
}

export function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export function normalizeComparable(value) {
  return normalizeForMatch(value)
}

export function hasPlaceholder(value) {
  const s = String(value || '').toLowerCase()
  return [
    'todo',
    'tbd',
    '待补',
    '待定',
    '[needs clarification]',
    '???',
    'lorem ipsum',
    'placeholder',
  ].some((p) => s.includes(p))
}

export function compareStoryboardSlides(actual, expected) {
  const ignored = new Set(['status', 'reviewer', 'scriptSection'])
  const diffs = []
  const byId = new Map((expected.slides || []).map((s) => [s.id, s]))
  for (const a of actual.slides || []) {
    const e = byId.get(a.id)
    if (!e) {
      diffs.push(`slide ${a.id} missing from storyboard`)
      continue
    }
    for (const key of new Set([...Object.keys(a), ...Object.keys(e)])) {
      if (ignored.has(key)) continue
      if (JSON.stringify(a[key]) !== JSON.stringify(e[key])) {
        diffs.push(
          `slide ${a.id}.${key}: script=${JSON.stringify(a[key])} storyboard=${JSON.stringify(e[key])}`,
        )
      }
    }
    byId.delete(a.id)
  }
  for (const id of byId.keys()) diffs.push(`slide ${id} exists only in storyboard`)
  return diffs
}
