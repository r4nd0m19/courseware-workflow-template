#!/usr/bin/env node
// Per-step timing report from a real workflow run.
//
// Spec Kit writes log.jsonl with step_started/step_completed timestamps. This
// tool pairs them and reports total/average/max duration per step, including
// self-review-page and build-page-evidence. It does not need an AI call.
import fs from 'node:fs'
import path from 'node:path'
import { readData } from './lib.mjs'
import { parseFlagValue } from './self-review-lib.mjs'

const args = process.argv.slice(2)
const runId = parseFlagValue(args, '--run')
const latest = args.includes('--latest')
const runsDir = parseFlagValue(args, '--dir', '.specify/workflows/runs')
const filterRaw = parseFlagValue(args, '--filter')
const jsonOut = args.includes('--json')
const outFile = parseFlagValue(args, '--out')

function resolveRun() {
  if (runId) return path.join(runsDir, runId)
  if (!latest) return null
  const entries = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(runsDir, entry.name)
      const state = path.join(dir, 'state.json')
      return {
        dir,
        mtime: fs.existsSync(state) ? fs.statSync(state).mtimeMs : 0,
      }
    })
    .sort((a, b) => b.mtime - a.mtime)
  return entries[0]?.dir || null
}

const dir = resolveRun()
if (!dir) {
  console.error('usage: node workflow-timing.mjs (--run <run-id> | --latest) [--dir .specify/workflows/runs] [--filter <regex>] [--json] [--out <file>]')
  process.exit(2)
}
const logPath = path.join(dir, 'log.jsonl')
if (!fs.existsSync(logPath)) {
  console.error(`log not found: ${logPath}`)
  process.exit(1)
}

let state = null
try {
  state = readData(path.join(dir, 'state.json'))
} catch {
  state = null
}

const events = []
for (const line of fs.readFileSync(logPath, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue
  try {
    const event = JSON.parse(line)
    if (event.timestamp) events.push(event)
  } catch {
    // Ignore malformed log lines.
  }
}

const starts = new Map()
const byStep = new Map()
let first = null
let last = null
for (const event of events) {
  const timestamp = new Date(event.timestamp).getTime()
  if (!Number.isFinite(timestamp)) continue
  if (first == null || timestamp < first) first = timestamp
  if (last == null || timestamp > last) last = timestamp
  const stepId = event.step_id
  if (!stepId) continue
  if (event.event === 'step_started') {
    const queue = starts.get(stepId) || []
    queue.push(timestamp)
    starts.set(stepId, queue)
    continue
  }
  if (event.event !== 'step_completed') continue
  const queue = starts.get(stepId) || []
  if (!queue.length) continue
  const started = queue.shift()
  const durationMs = Math.max(0, timestamp - started)
  const row = byStep.get(stepId) || {
    step: stepId,
    type: event.type || '',
    count: 0,
    totalMs: 0,
    maxMs: 0,
    statuses: {},
  }
  row.count += 1
  row.totalMs += durationMs
  row.maxMs = Math.max(row.maxMs, durationMs)
  row.statuses[event.status || 'completed'] = (row.statuses[event.status || 'completed'] || 0) + 1
  byStep.set(stepId, row)
}

const filter = filterRaw ? new RegExp(filterRaw) : null
const rows = [...byStep.values()]
  .filter((row) => !filter || filter.test(row.step))
  .map((row) => ({
    step: row.step,
    type: row.type,
    count: row.count,
    totalSeconds: Number((row.totalMs / 1000).toFixed(3)),
    avgSeconds: Number((row.totalMs / row.count / 1000).toFixed(3)),
    maxSeconds: Number((row.maxMs / 1000).toFixed(3)),
    statuses: row.statuses,
  }))
  .sort((a, b) => b.totalSeconds - a.totalSeconds)

const report = {
  run: path.basename(dir),
  workflow: state?.workflow_id || '',
  status: state?.status || '',
  lessonSlug: state?.inputs?.lesson_slug || '',
  startedAt: first ? new Date(first).toISOString() : '',
  finishedAt: last ? new Date(last).toISOString() : '',
  wallSeconds: first != null && last != null ? Number(((last - first) / 1000).toFixed(3)) : null,
  events: events.length,
  steps: rows,
}

if (outFile) fs.writeFileSync(path.resolve(outFile), `${JSON.stringify(report, null, 2)}\n`)
if (jsonOut) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  console.log(`Run: ${report.run}  workflow: ${report.workflow || '?'}  status: ${report.status || '?'}`)
  if (report.wallSeconds != null) {
    console.log(`Wall: ${report.wallSeconds.toFixed(1)} s; events: ${report.events}`)
  }
  console.log('')
  console.log('step                              count  total_s  avg_s  max_s')
  for (const row of rows) {
    console.log(
      `${row.step.padEnd(32)}  ${String(row.count).padStart(5)}  ` +
        `${row.totalSeconds.toFixed(2).padStart(7)}  ${row.avgSeconds.toFixed(2).padStart(5)}  ` +
        `${row.maxSeconds.toFixed(2).padStart(5)}`,
    )
  }
  if (outFile) console.log(`\nReport: ${path.resolve(outFile)}`)
}
