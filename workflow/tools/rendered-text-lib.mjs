// Shared normalization for rendered-text checks.
//
// The goal is deterministic comparison, not "pretty" text. Keep the rules
// explicit and auditable:
// - NFKC folds full-width Latin/digits and compatibility forms.
// - Zero-width characters and NBSP are removed.
// - Runs of whitespace collapse to one space.
// - Chinese/English punctuation variants are folded to ASCII where unambiguous.
// - Code keeps its symbols but loses indentation/whitespace noise.
export function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[，]/g, ',')
    .replace(/[。]/g, '.')
    .replace(/[：]/g, ':')
    .replace(/[；]/g, ';')
    .replace(/[！]/g, '!')
    .replace(/[？]/g, '?')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .toLowerCase()
}

export function normalizeCompact(value) {
  return normalizeText(value).replace(/\s+/g, '')
}

export function normalizeCode(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/ /g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join(' ')
}

export function hasCjk(value) {
  return /[㐀-鿿]/.test(String(value || ''))
}

export function minBlockingLength(value) {
  return hasCjk(value) ? 2 : 4
}

export function tokenSet(value) {
  const text = normalizeText(value)
  const tokens = new Set()
  for (const word of text.match(/[a-z0-9_]+/g) || []) tokens.add(word)
  const cjk = [...text.matchAll(/[㐀-鿿]+/g)].map((match) => match[0]).join('')
  for (let i = 0; i < cjk.length - 1; i += 1) tokens.add(cjk.slice(i, i + 2))
  return tokens
}

export function jaccard(a, b) {
  const left = a instanceof Set ? a : tokenSet(a)
  const right = b instanceof Set ? b : tokenSet(b)
  if (!left.size && !right.size) return 1
  let intersection = 0
  for (const token of left) if (right.has(token)) intersection += 1
  const union = left.size + right.size - intersection
  return union ? intersection / union : 1
}
