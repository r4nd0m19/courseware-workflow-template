#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { readApprovals, readSectionManifest, writeApprovals } from './section-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}

const sectionsPath = opt('--sections')
const approvalsPath = opt('--approvals', 'review/page-approvals.json')
const sectionId = opt('--id')
const reason = opt('--reason')

if (!sectionsPath || !sectionId || !reason) {
  console.error(`usage: node reopen-section.mjs --sections <file> --id <section> --reason "<why>" [options]

Options:
  --approvals <path>   approval ledger (default: review/page-approvals.json)

Reopens the named section and every later section, because later pages may depend on it.
Earlier approved sections stay frozen. Rerun the section review loop; it resumes at the
first reopened section.
`)
  process.exit(2)
}

const manifest = readSectionManifest(sectionsPath)
const index = manifest.sections.findIndex((s) => s.id === sectionId)
if (index < 0) {
  console.error(`FAIL section ${sectionId} is not declared in ${sectionsPath}`)
  process.exit(1)
}

const approvals = readApprovals(approvalsPath)
const reopened = manifest.sections.slice(index).filter((s) => approvals.sections[s.id])
for (const section of reopened) delete approvals.sections[section.id]
writeApprovals(approvalsPath, approvals)

const logPath = path.join(path.dirname(approvalsPath), 'section-reopens.json')
let log = { schemaVersion: '1.0', reopens: [] }
if (fs.existsSync(logPath)) {
  try {
    log = JSON.parse(fs.readFileSync(logPath, 'utf8'))
    if (!Array.isArray(log.reopens)) log.reopens = []
  } catch {
    log = { schemaVersion: '1.0', reopens: [] }
  }
}
log.reopens.push({
  from: sectionId,
  reopened: reopened.map((s) => s.id),
  reason,
  at: new Date().toISOString(),
})
fs.mkdirSync(path.dirname(logPath), { recursive: true })
fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n')

console.log(
  reopened.length
    ? `OK reopened ${reopened.map((s) => s.id).join(', ')} — earlier approved sections remain frozen`
    : `OK section ${sectionId} was not approved; nothing to reopen`,
)
