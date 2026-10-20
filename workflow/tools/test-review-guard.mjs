#!/usr/bin/env node
// Unit test for the page-level review guard. It uses a temporary project root
// with a fake courseware-production run and no external tools.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  pageGateApproval,
  productionRun,
  requirePageGateApproval,
} from './review-guard.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-review-guard-'))
const runId = 'guard-test'
const runDir = path.join(tmp, '.specify/workflows/runs', runId)
fs.mkdirSync(runDir, { recursive: true })
fs.writeFileSync(
  path.join(runDir, 'state.json'),
  `${JSON.stringify(
    {
      run_id: runId,
      workflow_id: 'courseware-production',
      status: 'running',
      step_results: {
        'section_review_loop:S01:review-page': {
          type: 'gui-gate',
          status: 'completed',
          output: {
            choice: 'approve',
            message: 'Review rendered page S01 (run guard-test)',
          },
        },
        'section_review_loop:S02:review-page': {
          type: 'gui-gate',
          status: 'completed',
          output: {
            choice: 'approve',
            message: 'Review rendered page S02 (run guard-test)',
          },
        },
      },
    },
    null,
    2,
  )}\n`,
)

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL review guard: ${message}`)
    fs.rmSync(tmp, { recursive: true, force: true })
    process.exit(1)
  }
}

process.env.SPECKIT_WORKFLOW_RUN_ID = runId
const run = productionRun(tmp)
assert(run.ok, `productionRun should accept the fake production run: ${JSON.stringify(run)}`)

const approved = pageGateApproval({ sectionId: 'S01', projectRoot: tmp })
assert(
  approved.ok,
  `pageGateApproval should accept the approving gate: ${JSON.stringify(approved)}`,
)
assert(approved.gate.endsWith(':S01:review-page'), 'pageGateApproval picked the wrong page')

const secondPage = pageGateApproval({ sectionId: 'S02', projectRoot: tmp })
assert(secondPage.ok, 'pageGateApproval should accept the S02 gate')

const wrongSection = pageGateApproval({ sectionId: 'S03', projectRoot: tmp })
assert(!wrongSection.ok, 'pageGateApproval must reject a section with no gate')

const manual = requirePageGateApproval({
  tool: 'freeze-section test',
  sectionId: 'S02',
  manual: true,
  projectRoot: tmp,
})
assert(manual.mode === 'manual', 'the manual bypass must be explicit')

delete process.env.SPECKIT_WORKFLOW_RUN_ID
const missingEnv = productionRun(tmp)
assert(!missingEnv.ok, 'productionRun must fail without SPECKIT_WORKFLOW_RUN_ID')

fs.rmSync(tmp, { recursive: true, force: true })
console.log('OK review guard')
