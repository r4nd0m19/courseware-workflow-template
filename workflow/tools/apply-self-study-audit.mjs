#!/usr/bin/env node
// Apply the approved self-study supplements.
//
// The audit writes a separate proposal (courseware.self-study.md); this tool is
// the only step allowed to replace the reviewed script. It refuses to touch a
// script that changed after the audit, keeps a copy of the original, and writes
// an apply record. With no supplements it is a no-op.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readData } from './lib.mjs'
import { parseScript } from './script-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}

const auditPath = opt('--audit')
const scriptPath = opt('--script')
const proposalPath = opt('--proposal') || (scriptPath ? path.join(path.dirname(path.resolve(scriptPath)), 'courseware.self-study.md') : '')
const approvedBy = opt('--approved-by', 'teacher')
const recordPath = opt('--record', 'review/self-study-apply.json')
const sectionsPath = opt('--sections')
const backupPath = opt('--backup', 'review/courseware.before-self-study.md')
if (!auditPath || !scriptPath) {
  console.error('usage: node apply-self-study-audit.mjs --audit <review/self-study-audit.json> --script <courseware.md> [--proposal <courseware.self-study.md>] [--sections <review-sections.yml>] [--approved-by <name>] [--record review/self-study-apply.json] [--backup review/courseware.before-self-study.md]')
  process.exit(2)
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}
function fail(message) {
  console.error(`FAIL ${message}`)
  process.exit(1)
}

let audit
try {
  audit = readData(auditPath)
} catch (error) {
  fail(error.message)
}
if (!fs.existsSync(scriptPath)) fail(`script not found: ${scriptPath}`)
const original = fs.readFileSync(scriptPath)
const currentSha = sha256(original)
if (audit.script?.sha256 && audit.script.sha256 !== currentSha) {
  fail(`script changed after the audit (expected ${audit.script.sha256}, found ${currentSha}); re-run the self-study audit`)
}

const supplements = audit.supplements || []
const pageAdditions = Number(audit.pageBudget?.proposed || 0) !== Number(audit.pageBudget?.current || 0)
const record = {
  schemaVersion: '1.0',
  lesson: audit.lesson,
  audit: path.resolve(auditPath),
  script: path.resolve(scriptPath),
  approvedBy,
  verdict: audit.verdict,
  supplements: supplements.map((s) => ({ id: s.id, gapId: s.gapId, type: s.type, targetSlides: s.targetSlides })),
  pageBudget: audit.pageBudget,
  originalSha256: currentSha,
  appliedSha256: currentSha,
  changed: false,
  appliedAt: new Date().toISOString(),
}

if (supplements.length || pageAdditions) {
  if (!proposalPath || !fs.existsSync(proposalPath)) fail('supplements or new pages exist but the proposal file is missing')
  if (pageAdditions && !sectionsPath) fail('new pages require --sections <review-sections.yml> so the page loop can review them')
  const proposal = fs.readFileSync(proposalPath)
  const proposalSha = sha256(proposal)
  if (proposalSha === currentSha) {
    fail('supplements or new pages exist but the proposal is identical to the script; nothing would be added')
  }
  fs.mkdirSync(path.dirname(backupPath), { recursive: true })
  fs.writeFileSync(backupPath, original)
  const temp = `${scriptPath}.self-study-tmp`
  fs.writeFileSync(temp, proposal)
  fs.renameSync(temp, scriptPath)
  record.changed = true
  record.proposal = path.resolve(proposalPath)
  record.proposalSha256 = proposalSha
  record.appliedSha256 = proposalSha
  record.backup = path.resolve(backupPath)

  if (sectionsPath && pageAdditions) {
    const parsed = parseScript(scriptPath)
    const lines = [
      '# 逐页渲染审核清单',
      '#',
      '# 由 apply-self-study-audit.mjs 从应用后的 courseware.md 重新生成（自学补充新增页）。',
      '# 每个 section 恰好一屏。',
      'schemaVersion: "1.0"',
      'sections:',
    ]
    for (const slide of parsed.slides) {
      lines.push(`  - id: ${slide.id}`)
      lines.push(`    title: ${JSON.stringify(slide.headingTitle)}`)
      lines.push(`    slides: [${slide.id}]`)
    }
    const sectionsText = `${lines.join('\n')}\n`
    fs.mkdirSync(path.dirname(path.resolve(sectionsPath)), { recursive: true })
    fs.writeFileSync(path.resolve(sectionsPath), sectionsText)
    record.reviewSections = path.resolve(sectionsPath)
    record.reviewSectionsSha256 = sha256(Buffer.from(sectionsText))
  }
}

fs.mkdirSync(path.dirname(recordPath), { recursive: true })
fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`)
console.log(`OK self-study apply ${audit.lesson}`)
console.log(`   supplements: ${supplements.length} (${record.changed ? 'applied' : 'none, script unchanged'})`)
console.log(`   script: ${scriptPath} sha=${record.appliedSha256.slice(0, 12)}`)
if (record.changed) console.log(`   backup: ${record.backup}`)
console.log(`   record: ${recordPath}`)
