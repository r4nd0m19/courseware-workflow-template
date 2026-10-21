#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { parseScript } from './script-lib.mjs'
import { slideScriptHash } from './section-lib.mjs'
import {
  DEFAULT_SCRIPT_APPROVAL,
  reviewRunProblems,
  scriptSelfReviewProblems,
  sha256Text,
} from './approval-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const scriptPath = args.find((a) => !a.startsWith('--'))
const approvedBy = opt('--approved-by').trim()
const gateChoice = opt('--gate-choice').trim()
const gateStep = opt('--gate-step', 'review-script')
const runId = opt('--run-id').trim()
const runStatePath = opt('--run-state')
const out = opt('--out', DEFAULT_SCRIPT_APPROVAL)
const selfReviewPath = opt('--self-review')
const manual = args.includes('--manual')

if (!scriptPath || !approvedBy || !runId) {
  console.error(`usage: node approve-script.mjs <courseware.md> --approved-by <name> --gate-choice approve --run-id <workflow-run-id> [options]

Options:
  --gate-choice <value>  the review-script gate's choice (must be "approve")
  --gate-step <id>       gate step id (default: review-script)
  --run-id <id>          workflow run that contains the completed review-script gate
  --run-state <path>     run state.json (default: .specify/workflows/runs/<id>/state.json)
  --out <path>           approval ledger (default: review/<lesson>/script-approval.json)
  --self-review <path>   self-review record (default: review/<lesson>/self-review-script.json)
  --manual               test/debug only: skip the self-review evidence check

Run only from the workflow step immediately after the human review-script
gate. This verifies the run state proves that gate completed with "approve",
flips the frontmatter and every non-SKIP slide's machine status from DRAFT to
APPROVED, then records the whole-file hash, each slide hash and the gate run.
`)
  process.exit(2)
}
if (gateStep !== 'review-script') {
  console.error(`FAIL script approval — gate step must be "review-script", got ${JSON.stringify(gateStep)}`)
  process.exit(1)
}
if (gateChoice.toLowerCase() !== 'approve') {
  console.error(
    `FAIL script approval — the review-script gate choice is ${JSON.stringify(gateChoice)}, not "approve". ` +
      'Do not run approve-script manually; resume the workflow and let the teacher decide the gate.',
  )
  process.exit(1)
}

const runProblems = reviewRunProblems(runId, {
  ...(runStatePath ? { runStatePath } : {}),
})
if (runProblems.length) {
  console.error(
    `FAIL script approval — the workflow run cannot prove an approving review-script gate:\n${runProblems
      .map((problem) => `  ${problem}`)
      .join('\n')}\n` +
      'Do not run approve-script manually; resume the workflow and let the teacher decide the gate.',
  )
  process.exit(1)
}

const absolute = path.resolve(scriptPath)
const text = fs.readFileSync(absolute, 'utf8')

if (!manual) {
  const selfReviewProblems = scriptSelfReviewProblems({
    runId,
    ...(runStatePath ? { runStatePath } : {}),
    scriptPath: absolute,
    scriptText: text,
    ...(selfReviewPath ? { selfReviewPath } : {}),
  })
  if (selfReviewProblems.length) {
    console.error(
      `FAIL script approval — the run cannot prove a completed script self-review:\n${selfReviewProblems
        .map((problem) => `  ${problem}`)
        .join('\n')}\n` +
        'Run the full courseware-production workflow so self-review-script and check-self-review-script complete before the gate; a minimal gate-only workflow is not enough. Use --manual only for tests.',
    )
    process.exit(1)
  }
}
const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
if (!fmMatch) {
  console.error(`FAIL ${scriptPath}: missing YAML frontmatter`)
  process.exit(1)
}

const frontmatter = fmMatch[1].split(/\r?\n/)
let frontmatterChanged = false
for (let i = 0; i < frontmatter.length; i += 1) {
  const m = frontmatter[i].match(/^(\s*status\s*:\s*)(['"]?)(DRAFT|REVISE)\2(\s*(?:#.*)?)$/)
  if (m) {
    frontmatter[i] = `${m[1]}${m[2] || ''}APPROVED${m[2] || ''}${m[4]}`
    frontmatterChanged = true
    break
  }
}
if (!frontmatterChanged) {
  const current = frontmatter.find((l) => /^\s*status\s*:/.test(l))
  if (!current || !/APPROVED/.test(current)) {
    console.error(`FAIL ${scriptPath}: frontmatter status must be DRAFT/REVISE or APPROVED`)
    process.exit(1)
  }
}

const body = text.slice(fmMatch[0].length)
const lines = body.split(/\r?\n/)
let slideId = ''
let inMachine = false
let fence = ''
let changedSlides = 0
let currentSlideChanged = false
const seen = new Set()

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i]
  if (!fence) {
    const slide = line.match(/^##\s+(S\d+[A-Z]?)\b/)
    if (slide) {
      if (slideId) seen.add(slideId)
      slideId = slide[1]
      inMachine = false
      currentSlideChanged = false
      continue
    }
    const heading = line.match(/^###\s+(.+?)\s*$/)
    if (heading) {
      inMachine = /^(制作字段|机器字段|机器可读摘要|machine)$/i.test(
        heading[1].replace(/[（(].*?[）)]/g, '').trim(),
      )
      continue
    }
    const fm = line.match(/^\s*(`{3,}|~{3,})/)
    if (fm) {
      fence = fm[1][0]
      continue
    }
  } else if (line.trim().startsWith(fence)) {
    fence = ''
    continue
  }

  if (!fence && /^##\s+S\d+/.test(line)) {
    inMachine = false
    continue
  }

  if (fence && inMachine && slideId) {
    const m = line.match(/^(\s*status\s*:\s*)(['"]?)(DRAFT|REVISE)\2(\s*(?:#.*)?)$/)
    if (m) {
      lines[i] = `${m[1]}${m[2] || ''}APPROVED${m[2] || ''}${m[4]}`
      currentSlideChanged = true
      changedSlides += 1
    }
  }
}
if (slideId) seen.add(slideId)

const nextText = fmMatch[0].replace(fmMatch[1], frontmatter.join('\n')) + lines.join('\n')
if (nextText !== text) fs.writeFileSync(absolute, nextText)

let parsed
try {
  parsed = parseScript(absolute)
} catch (err) {
  console.error(`FAIL approved script re-parse — ${err.message}`)
  process.exit(1)
}

const problems = []
for (const slide of parsed.slides) {
  const status = slide.machine && slide.machine.status
  if (status === 'SKIP') continue
  if (status !== 'APPROVED') {
    problems.push(`${slide.id}: machine status is ${status || 'missing'}, expected APPROVED`)
  }
}
if (parsed.frontmatter.status !== 'APPROVED') {
  problems.push(`frontmatter status is ${parsed.frontmatter.status || 'missing'}, expected APPROVED`)
}
if (problems.length) {
  console.error(`FAIL script approval\n${problems.map((p) => `  ${p}`).join('\n')}`)
  process.exit(1)
}

const approvedAt = new Date().toISOString()
const ledger = {
  schemaVersion: '1.2',
  script: path.relative(process.cwd(), absolute),
  scriptSha256: sha256Text(nextText),
  approvedBy,
  approvedAt,
  gate: {
    stepId: 'review-script',
    choice: 'approve',
    runId,
    approvedAt,
  },
  note: 'Whole-script human approval, hash-bound to the exact courseware.md text. Each rendered section is frozen separately after its own review gate.',
  slideCount: parsed.slides.filter((s) => s.machine && s.machine.status !== 'SKIP').length,
  slideHashes: Object.fromEntries(
    parsed.slides
      .filter((s) => s.machine && s.machine.status !== 'SKIP')
      .map((s) => [s.id, slideScriptHash(s)]),
  ),
}
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(ledger, null, 2) + '\n')
fs.writeFileSync(
  path.join(path.dirname(out), 'script-approval.md'),
  [
    '# Script approval',
    '',
    '| Script | Approved by | Approved at | Gate run | Slides |',
    '|---|---|---|---|---|',
    `| ${ledger.script} | ${approvedBy} | ${approvedAt} | ${runId} | ${ledger.slideCount} |`,
    '',
    'Each rendered page is reviewed and frozen separately; see `page-approvals.md`.',
    '',
  ].join('\n'),
)

console.log(
  `OK script approved — ${ledger.slideCount} slide(s) APPROVED, ${changedSlides} machine status change(s)`,
)
