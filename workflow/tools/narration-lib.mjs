import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseScript } from './script-lib.mjs'

// Spoken-form rules. Keep this list explicit: the teacher reviews the spoken text
// in narration.json, so every rewrite should be visible here rather than hidden
// in provider-specific SSML.
const SPOKEN_RULES = [
  [/`([^`]+)`/g, '$1'],
  [/\*\*([^*]+)\*\*/g, '$1'],
  [/\[暂停\]|【暂停】|\(暂停\)/g, ''],
  // Code phrases that would otherwise leave operators behind for the TTS voice.
  [/\bcout\s*<<\s*endl\s*;?/gi, 'C out 换行'],
  [/\bcout\s*<</gi, 'C out 输出'],
  [/\bcin\s*>>/gi, 'C in 读入'],
  [/\bendl\b/gi, '换行'],
  [/<<|>>/g, ' '],
  [/;/g, '，'],
  [/#include\s*<bits\/stdc\+\+\.h>/g, 'include bits std C 加加 点 h'],
  [/\bbits\/stdc\+\+\.h\b/g, 'bits std C 加加 点 h'],
  [/C\+\+/g, 'C 加加'],
  [/(?<![A-Za-z])cin(?![A-Za-z])/g, 'C in'],
  [/(?<![A-Za-z])cout(?![A-Za-z])/g, 'C out'],
  [/(?<![A-Za-z])endl(?![A-Za-z])/g, 'end L'],
  [/(?<![A-Za-z])([A-Za-z_]\w*)\+\+(?![A-Za-z])/g, '$1 加加'],
  // Subscripts: a[3][5] -> a 3 5, a[i][j] -> a i j.
  [/([A-Za-z_]\w*)((?:\s*\[[^\[\]]+\])+)/g, (_, name, subs) => {
    const parts = [...subs.matchAll(/\[([^\[\]]+)\]/g)].map((m) => m[1].trim())
    return `${name} ${parts.join(' ')}`
  }],
  [/(?<![A-Za-z])i\s*,\s*j(?![A-Za-z])/g, 'i、j'],
  [/(?<![A-Za-z])i\s*\+\s*j(?![A-Za-z])/g, 'i 加 j'],
  [/(?<![A-Za-z])i\s*-\s*j(?![A-Za-z])/g, 'i 减 j'],
  [/(?<![A-Za-z])i\s*==\s*j(?![A-Za-z])/g, 'i 等于 j'],
  [/(?<![A-Za-z])cols\s*-\s*1(?![A-Za-z])/g, 'cols 减 1'],
  [/\s*×\s*/g, ' 乘 '],
  [/\s*→\s*/g, ' 到 '],
  [/\s*≥\s*/g, ' 大于等于 '],
  [/\s*≤\s*/g, ' 小于等于 '],
  [/\s*≠\s*/g, ' 不等于 '],
  [/(\d+)\s*[–—]\s*(\d+)/g, '$1 到 $2'],
]

export function normalizeNarration(text) {
  let spoken = String(text || '')
  for (const [pattern, replacement] of SPOKEN_RULES) {
    spoken = spoken.replace(pattern, replacement)
  }
  return spoken
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+([，。！？；：、])/g, '$1')
    .replace(/([（【])\s+/g, '$1')
    .replace(/\s+([）】])/g, '$1')
    .trim()
}

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function loadVoiceCatalog(file) {
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'))
  const problems = []
  if (!catalog.defaults || typeof catalog.defaults !== 'object') {
    problems.push('missing defaults')
  } else {
    for (const key of ['locale', 'rate', 'pitch', 'outputFormat']) {
      if (!catalog.defaults[key]) problems.push(`defaults.${key} is required`)
    }
  }
  if (!Array.isArray(catalog.voices) || catalog.voices.length === 0) {
    problems.push('voices must be a non-empty array')
  } else {
    const ids = new Set()
    for (const voice of catalog.voices) {
      if (!voice.id) problems.push('voice.id is required')
      if (!voice.displayName) problems.push(`voice ${voice.id}: displayName is required`)
      if (!voice.providerVoice) problems.push(`voice ${voice.id}: providerVoice is required`)
      if (voice.id) {
        if (ids.has(voice.id)) problems.push(`duplicate voice id ${voice.id}`)
        ids.add(voice.id)
      }
    }
    if (catalog.defaultVoice && !ids.has(catalog.defaultVoice)) {
      problems.push(`defaultVoice ${catalog.defaultVoice} is not in voices`)
    }
  }
  if (problems.length) {
    throw new Error(`${file}: ${problems.join('; ')}`)
  }
  return catalog
}

export function readNarrationSlides(scriptPath) {
  const parsed = parseScript(scriptPath)
  return {
    frontmatter: parsed.frontmatter,
    sourceHash: sha256File(scriptPath),
    slides: parsed.slides.map((slide) => {
      const status = slide.machine?.status || 'DRAFT'
      return {
        id: slide.id,
        title: slide.headingTitle,
        status,
        rawText: slide.narration || '',
        spokenText: normalizeNarration(slide.narration || ''),
      }
    }),
  }
}

export function parseOnly(raw) {
  if (!raw) return null
  const ids = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return ids.length ? new Set(ids) : null
}

export function selectNarrationSlides(slides, only) {
  return slides.filter((slide) => {
    if (slide.status === 'SKIP') return false
    if (only && !only.has(slide.id)) return false
    return true
  })
}

export function safeSegment(value) {
  const segment = String(value || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!segment) throw new Error(`unsafe empty path segment from ${JSON.stringify(value)}`)
  return segment
}

export function audioUrl(prefix, slideId, voiceId) {
  const raw = String(prefix || '').trim()
  if (!/^(?:\/|https?:\/\/)/i.test(raw)) {
    throw new Error(
      `invalid audio URL prefix ${JSON.stringify(prefix)}; expected /audio or https://... ` +
        '(Git Bash may rewrite /audio; set MSYS_NO_PATHCONV=1)',
    )
  }
  const base = raw.replace(/\/+$/, '')
  return `${base}/${safeSegment(slideId)}/${safeSegment(voiceId)}.mp3`
}

export function audioFilePath(audioDir, slideId, voiceId) {
  return path.join(audioDir, safeSegment(slideId), `${safeSegment(voiceId)}.mp3`)
}
