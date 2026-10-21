#!/usr/bin/env node
// Fail closed when a multi-lesson project points runtime inputs at shared
// project-level paths. Two lessons must never write the same site, narration,
// audio, art, baseline, review or screenshot directories.
const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}

const slug = opt('--lesson-slug').trim()
if (!slug || !/^[A-Za-z0-9._-]+$/.test(slug) || slug.includes('..')) {
  console.error(
    `FAIL lesson paths — invalid --lesson-slug ${JSON.stringify(slug)}; expected [A-Za-z0-9._-]+`,
  )
  process.exit(2)
}

const paths = {
  site_dir: opt('--site-dir'),
  narration_manifest: opt('--narration'),
  audio_dir: opt('--audio-dir'),
  art_dir: opt('--art-dir'),
  review_dir: process.env.COURSEWARE_REVIEW_DIR || '',
  screenshots_dir: process.env.COURSEWARE_SCREENSHOTS_DIR || '',
  script_approval: process.env.COURSEWARE_SCRIPT_APPROVAL || '',
  page_approvals: process.env.COURSEWARE_PAGE_APPROVALS || '',
  gate_state: process.env.COURSEWARE_GATE_STATE_DIR || '',
}
const baseline = opt('--baseline-dir').trim()
if (baseline) paths.baseline_dir = baseline

function containsSlug(value) {
  const normalized = String(value).replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.split('/').includes(slug)
}

const problems = []
for (const [name, value] of Object.entries(paths)) {
  if (!value) {
    problems.push(`${name} is empty; pass a per-lesson path (see the workflow inputs)`)
  } else if (!containsSlug(value)) {
    problems.push(`${name} is ${JSON.stringify(value)}; it must contain the lesson segment ${JSON.stringify(slug)}`)
  }
}

if (problems.length) {
  console.error('FAIL lesson paths — runtime paths must be scoped per lesson:')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(
    'Use e.g. site/<lesson>, site/<lesson>/narration.json, site/<lesson>/audio, generated/<lesson>, baselines/<lesson>.',
  )
  process.exit(1)
}

console.log(`OK lesson paths — ${slug}`)
