#!/usr/bin/env node
import path from 'node:path'
import { loadRegistryPackages } from './registry-lib.mjs'
import { fail, ok } from './lib.mjs'

const args = process.argv.slice(2)
function option(name) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : ''
}
const registryPath = option('--registry')
const query = option('--query')
const tags = option('--tags')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)
const level = option('--level')
const json = args.includes('--json')
const stylePackPath = option('--style-pack')
const projectRoot = option('--project-root')

if (!registryPath) {
  console.error(
    'usage: node search-registry.mjs --registry <registry.json> [--query text] [--tags a,b] [--level modify] [--json] [--style-pack <manifest>] [--project-root <dir>]',
  )
  process.exit(2)
}

let loaded
try {
  loaded = loadRegistryPackages(path.resolve(registryPath), {
    stylePackPath: stylePackPath ? path.resolve(stylePackPath) : '',
    projectRoot: projectRoot ? path.resolve(projectRoot) : '',
  })
} catch (err) {
  fail('component search', [err.message])
  process.exit(1)
}

const q = query.trim().toLowerCase()
const results = []
for (const pkg of loaded.packages) {
  if (!pkg.manifest) continue
  if (pkg.errors.length) continue
  const m = pkg.manifest
  if (m.status === 'deprecated') continue
  const reasons = []
  let score = 0
  const haystack = [m.id, m.name, m.description, m.whenToUse, m.learningFunction, ...(m.tags || [])]
    .join(' ')
    .toLowerCase()
  if (q) {
    if (`${m.id} ${m.name}`.toLowerCase().includes(q)) {
      score += 3
      reasons.push('name')
    }
    if (haystack.includes(q)) {
      score += 1
      reasons.push('text')
    }
  }
  for (const tag of tags) {
    if ((m.tags || []).map((t) => t.toLowerCase()).includes(tag)) {
      score += 3
      reasons.push(`tag:${tag}`)
    }
  }
  if (level && (m.interactionLevels || []).includes(level)) {
    score += 2
    reasons.push(`level:${level}`)
  }
  if (!q && tags.length === 0 && !level) {
    score = 1
    reasons.push('all')
  }
  if (score > 0) {
    results.push({
      id: m.id,
      name: m.name,
      version: m.version,
      status: m.status,
      category: m.category,
      interactionLevels: m.interactionLevels,
      tags: m.tags,
      whenToUse: m.whenToUse,
      learningFunction: m.learningFunction,
      package: pkg.entry.package,
      score,
      reasons,
    })
  }
}
results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))

if (json) {
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
} else if (results.length === 0) {
  console.log('NO MATCH')
} else {
  ok('component search', `${results.length} match(es)${q ? ` for "${query}"` : ''}`)
  for (const r of results.slice(0, 10)) {
    console.log(`\n${r.id}@${r.version} (${r.status}, score ${r.score}) — ${r.name}`)
    console.log(`  levels: ${r.interactionLevels.join(', ')}`)
    console.log(`  tags: ${r.tags.join(', ')}`)
    console.log(`  when: ${r.whenToUse}`)
    console.log(`  learning: ${r.learningFunction}`)
    console.log(`  reasons: ${r.reasons.join(', ')}`)
  }
}
