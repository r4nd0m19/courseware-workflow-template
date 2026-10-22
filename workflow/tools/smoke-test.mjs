#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readData } from './lib.mjs'

const toolsDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(toolsDir, '..')
const projectRoot = path.resolve(root, '..')
const examples = path.join(root, 'examples')
const schemas = path.join(root, 'schemas')
const hasBranchChoiceShell = fs.existsSync(path.join(projectRoot, 'shells/branch-choice'))
let failed = 0
let skipped = 0
let total = 0

function run(name, script, args, expected, expectedText) {
  total += 1
  const res = spawnSync(process.execPath, [path.join(toolsDir, script), ...args], {
    encoding: 'utf8',
  })
  const output = `${res.stdout || ''}\n${res.stderr || ''}`
  const expectedTexts = Array.isArray(expectedText)
    ? expectedText
    : expectedText
      ? [expectedText]
      : []
  const pass =
    res.status === expected && expectedTexts.every((text) => output.includes(text))
  console.log(
    `${pass ? 'PASS' : 'FAIL'} ${name} (exit ${res.status}, expected ${expected})`,
  )
  if (!pass) {
    failed += 1
    if (res.stdout) console.log(res.stdout.trimEnd())
    if (res.stderr) console.error(res.stderr.trimEnd())
    for (const text of expectedTexts) {
      if (!output.includes(text)) console.error(`expected output to contain: ${text}`)
    }
  }
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function skip(name, reason) {
  skipped += 1
  console.log(`SKIP ${name} (${reason})`)
}

function scriptDensity(scriptPath) {
  const res = spawnSync(
    process.execPath,
    [path.join(toolsDir, 'density-report.mjs'), scriptPath, '--json'],
    { encoding: 'utf8' },
  )
  if (res.status !== 0) throw new Error(`density-report failed: ${res.stderr}`)
  return JSON.parse(res.stdout)
}

function writeScriptReview(file, { density, hash } = {}) {
  const review = {
    stage: 'script',
    artifactPaths: [script],
    reviewedArtifacts: [{ path: script, sha256: hash || sha256File(script) }],
    automatedChecks: [{ name: 'smoke', status: 'pass' }],
    checklist: [{ item: 'smoke', status: 'pass' }],
    issues: [],
    verdict: 'pass',
    reviewedAt: '2026-10-19T00:00:00Z',
  }
  if (density) review.density = density
  fs.writeFileSync(file, JSON.stringify(review, null, 2))
  return file
}

const content = path.join(examples, 'content-pack.example.json')
const contentDraft = path.join(examples, 'content-pack.draft.json')
const storyboard = path.join(examples, 'storyboard.example.yml')
const storyboardMissing = path.join(examples, 'storyboard.missing.yml')
const storyboardBadVocab = path.join(examples, 'storyboard.bad-vocabulary.yml')
const storyboardGenerated = path.join(examples, 'storyboard.generated.yml')
const storyboardRegistry = path.join(examples, 'storyboard.registry.yml')
const reviewSections = path.join(examples, 'review-sections.example.yml')
const reviewSectionsBad = path.join(examples, 'review-sections.bad.yml')
const reviewSectionsGrouped = path.join(examples, 'review-sections.grouped.yml')
const style = path.join(examples, 'style-pack.example.json')
const styleGenerated = path.join(examples, 'style-pack.generated.json')
const selfPass = path.join(examples, 'self-review.pass.json')
const selfFail = path.join(examples, 'self-review.fail.json')
const referenceAdaptationExample = path.join(examples, 'reference-adaptation.example.json')
const selfStudy = path.join(examples, 'self-study-audit.example.json')
const selfStudyFail = path.join(examples, 'self-study-audit.fail.json')
const selfStudyProposal = path.join(examples, 'courseware.self-study.example.md')
const fullStyle = path.join(examples, 'style-pack.full.example.json')
const badStyle = path.join(examples, 'style-pack.full.bad.json')
const styleFreeze = path.join(os.tmpdir(), 'courseware-style-freeze-smoke.json')
const contentSchema = path.join(schemas, 'content-pack.schema.json')
const storySchema = path.join(schemas, 'storyboard.schema.json')
const narrationSchema = path.join(schemas, 'narration.schema.json')
const narrationManifest = path.join(examples, 'narration.example.json')
const audioAdapterOut = path.join(os.tmpdir(), 'courseware-audio-smoke.js')
const bundleOut = path.join(os.tmpdir(), 'courseware-components-smoke.js')
const bundleCssOut = path.join(os.tmpdir(), 'courseware-components-smoke.css')

const script = path.join(examples, 'courseware.example.md')
const conceptsExample = path.join(examples, 'concepts.example.yml')
const conceptsFail = path.join(examples, 'concepts.fail.example.yml')
const quizKeysContent = path.join(examples, 'quiz-keys.content.json')
const quizKeysPass = path.join(examples, 'quiz-keys.pass.md')
const quizKeysFail = path.join(examples, 'quiz-keys.fail.md')
const quizKeysDeckPass = path.join(examples, 'quiz-keys.pass.deck.json')
const quizKeysDeckFail = path.join(examples, 'quiz-keys.fail.deck.json')
const scriptComponent = path.join(examples, 'courseware.component.example.md')
const scriptMissingNarration = path.join(examples, 'courseware.missing-narration.md')
const scriptPlaceholder = path.join(examples, 'courseware.tbd.md')
const componentPlan = path.join(examples, 'component-plan.example.md')
const componentPlanMissing = path.join(examples, 'component-plan.missing-brief.md')
const componentBriefs = path.join(examples, 'component-briefs')
const registry = path.join(examples, 'registry/index.json')
const componentPkg = path.join(examples, 'registry/components/matrix-lab')
const badComponentPkg = path.join(examples, 'bad-component')

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-registry-smoke-'))
const tmpRunsDir = path.join(tmpRoot, '.specify/workflows/runs')
process.env.COURSEWARE_WORKFLOW_RUNS_DIR = tmpRunsDir

function writeGateRun(runId, { runStatus = 'completed', stepStatus = 'completed', choice = 'approve' } = {}) {
  const dir = path.join(tmpRunsDir, runId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'state.json'),
    JSON.stringify({
      run_id: runId,
      workflow_id: 'courseware-production',
      status: runStatus,
      step_results: {
        'review-script': {
          type: 'gate',
          status: stepStatus,
          output: { choice, options: ['approve', 'reject'] },
        },
      },
    }),
  )
}
writeGateRun('smoke')
writeGateRun('smoke-paused', { runStatus: 'paused', stepStatus: 'paused', choice: null })
const tmpRegistryDir = path.join(tmpRoot, 'registry')
fs.cpSync(path.join(examples, 'registry'), tmpRegistryDir, { recursive: true })
const tmpRegistry = path.join(tmpRegistryDir, 'index.json')
const emptyRegistry = path.join(tmpRoot, 'empty/index.json')
const tamperedFreeze = path.join(tmpRoot, 'style-freeze-tampered.json')
const reviewConceptPass = path.join(tmpRoot, 'review-concept-pass.json')
const conceptReview = JSON.parse(fs.readFileSync(selfPass, 'utf8'))
conceptReview.concepts = [
  {
    conceptId: 'C01',
    verdict: 'pass',
    evidence: 'S01 defines 程序 as ordered instructions; S02 applies it.',
    slideIds: ['S01', 'S02'],
  },
]
fs.writeFileSync(reviewConceptPass, JSON.stringify(conceptReview, null, 2))

const smokeDensity = scriptDensity(script)
for (const slide of smokeDensity.slides) {
  slide.semanticUnits = [{ label: `${slide.slideId} smoke unit`, evidence: 'smoke evidence' }]
  slide.verdict = 'pass'
  slide.notes = ''
}
const cloneDensity = () => JSON.parse(JSON.stringify(smokeDensity))

const reviewDensityPass = writeScriptReview(path.join(tmpRoot, 'review-density-pass.json'), {
  density: cloneDensity().slides,
})
const reviewDensityMissing = writeScriptReview(path.join(tmpRoot, 'review-density-missing.json'))
const reviewDensityStale = writeScriptReview(path.join(tmpRoot, 'review-density-stale.json'), {
  density: cloneDensity().slides,
  hash: '0'.repeat(64),
})
const mismatchDensity = cloneDensity()
mismatchDensity.slides[0].signals.contentRefs += 1
const reviewDensityMismatch = writeScriptReview(path.join(tmpRoot, 'review-density-mismatch.json'), {
  density: mismatchDensity.slides,
})
const multiUnitPassDensity = cloneDensity()
multiUnitPassDensity.slides[0].semanticUnits = [
  { label: 'smoke unit one', evidence: 'smoke evidence' },
  { label: 'smoke unit two', evidence: 'smoke evidence' },
]
const reviewDensityMultiPass = writeScriptReview(
  path.join(tmpRoot, 'review-density-multi-pass.json'),
  { density: multiUnitPassDensity.slides },
)
const multiUnitExceptionDensity = JSON.parse(JSON.stringify(multiUnitPassDensity))
multiUnitExceptionDensity.slides[0].verdict = 'exception'
multiUnitExceptionDensity.slides[0].notes = 'two worked examples of the same rule'
const reviewDensityMultiException = writeScriptReview(
  path.join(tmpRoot, 'review-density-multi-exception.json'),
  { density: multiUnitExceptionDensity.slides },
)

try {
  run('content pack schema', 'validate-json.mjs', [contentSchema, content], 0)
  run('storyboard schema', 'validate-json.mjs', [storySchema, storyboard], 0)
  run('narration schema', 'validate-json.mjs', [narrationSchema, narrationManifest], 0)
  run('coverage pass', 'check-coverage.mjs', [content, storyboard], 0)
  run('coverage fail', 'check-coverage.mjs', [content, storyboardMissing], 1)
  run('concept coverage pass', 'check-concepts.mjs', [script, content, storyboard, '--concepts', conceptsExample], 0)
  run('concept coverage fail', 'check-concepts.mjs', [script, content, storyboard, '--concepts', conceptsFail], 1, 'missing required phrase')
  run('concept ledger-only pass', 'check-concepts.mjs', ['--ledger-only', content, '--concepts', conceptsExample], 0)
  run('concept ledger missing', 'check-concepts.mjs', ['--ledger-only', content, '--concepts', path.join(tmpRoot, 'no-concepts.yml')], 1)
  run('vocabulary pass', 'check-vocabulary.mjs', [storyboard, style], 0)
  run('vocabulary fail', 'check-vocabulary.mjs', [storyboardBadVocab, style], 1)
  run(
    'vocabulary generated without registry fails',
    'check-vocabulary.mjs',
    [storyboardGenerated, styleGenerated],
    1,
  )
  run(
    'vocabulary generated with core registry passes',
    'check-vocabulary.mjs',
    [storyboardGenerated, styleGenerated, registry],
    0,
  )
  run('teaching pass', 'check-teaching.mjs', [storyboard, content], 0)
  run('teaching fail (I3)', 'check-teaching.mjs', [storyboardMissing, content], 1)
  run('teaching fail (draft)', 'check-teaching.mjs', [storyboard, contentDraft], 1)
  run('self-review pass', 'check-self-review.mjs', [selfPass], 0)
  const reviewReference = path.join(tmpRoot, 'review-reference.json')
  const referenceReview = JSON.parse(fs.readFileSync(selfPass, 'utf8'))
  referenceReview.referenceAdaptation =
    'Reference cover used the branch lesson brand/code; replaced with the lesson brand, English file name and lesson sample.'
  fs.writeFileSync(reviewReference, JSON.stringify(referenceReview, null, 2))
  run(
    'self-review reference adaptation pass',
    'check-self-review.mjs',
    [reviewReference, '--root', root, '--require-reference-adaptation'],
    0,
  )
  delete referenceReview.referenceAdaptation
  const reviewNoReference = path.join(tmpRoot, 'review-no-reference.json')
  fs.writeFileSync(reviewNoReference, JSON.stringify(referenceReview, null, 2))
  run(
    'self-review reference adaptation required fails',
    'check-self-review.mjs',
    [reviewNoReference, '--root', root, '--require-reference-adaptation'],
    1,
    'referenceAdaptation is required',
  )
  run('self-review fail', 'check-self-review.mjs', [selfFail], 1)
  run(
    'reference adaptation pass',
    'check-reference-adaptation.mjs',
    [
      referenceAdaptationExample,
      '--storyboard',
      storyboard,
      '--script',
      script,
      '--shell',
      'shells/branch-choice',
      '--lesson-slug',
      'smoke-lesson',
    ],
    0,
  )
  run(
    'reference adaptation lesson mismatch',
    'check-reference-adaptation.mjs',
    [
      referenceAdaptationExample,
      '--storyboard',
      storyboard,
      '--script',
      script,
      '--shell',
      'shells/branch-choice',
      '--lesson-slug',
      'other-lesson',
    ],
    1,
  )
  run('self-review concept pass', 'check-self-review.mjs', [reviewConceptPass, '--concepts', conceptsExample, '--root', root], 0)
  run('self-review concept missing', 'check-self-review.mjs', [selfPass, '--concepts', conceptsExample], 1, 'concept review is missing C01')
  run(
    'self-review stale artifact fails',
    'check-self-review.mjs',
    [reviewDensityStale, '--script', script],
    1,
    'stale review',
  )
  run(
    'self-review density missing fails',
    'check-self-review.mjs',
    [reviewDensityMissing, '--script', script],
    1,
    'density report is required',
  )
  run(
    'self-review density mismatch fails',
    'check-self-review.mjs',
    [reviewDensityMismatch, '--script', script],
    1,
    'do not match the current script',
  )
  run(
    'self-review multi-unit pass fails',
    'check-self-review.mjs',
    [reviewDensityMultiPass, '--script', script],
    1,
    'declares 2 semantic units',
  )
  run(
    'self-review density pass',
    'check-self-review.mjs',
    [reviewDensityPass, '--script', script],
    0,
  )
  run(
    'self-review multi-unit exception passes',
    'check-self-review.mjs',
    [reviewDensityMultiException, '--script', script],
    0,
  )
  run('self-study audit pass', 'check-self-study.mjs', [selfStudy, '--script', script, '--proposal', selfStudyProposal], 0)
  run('self-study audit fail', 'check-self-study.mjs', [selfStudyFail, '--script', script, '--proposal', selfStudyProposal], 1)
  run('style pack full pass', 'validate-style-pack.mjs', [fullStyle, '--check-baselines'], 0)
  run('style pack full fail', 'validate-style-pack.mjs', [badStyle], 1)
  run('style pack freeze', 'freeze-style-pack.mjs', [fullStyle, '--out', styleFreeze], 0)
  run(
    'style pack freeze verify',
    'validate-style-pack.mjs',
    [fullStyle, '--check-baselines', '--freeze', styleFreeze],
    0,
  )
  const tampered = JSON.parse(fs.readFileSync(styleFreeze, 'utf8'))
  tampered.sourceHash = '0'.repeat(64)
  fs.writeFileSync(tamperedFreeze, JSON.stringify(tampered))
  run(
    'style pack freeze verify fail (tampered)',
    'validate-style-pack.mjs',
    [fullStyle, '--check-baselines', '--freeze', tamperedFreeze],
    1,
  )
  run(
    'audio adapter build',
    'build-audio-adapter.mjs',
    [narrationManifest, '--out', audioAdapterOut],
    0,
  )
  run(
    'audio adapter check',
    'build-audio-adapter.mjs',
    [narrationManifest, '--out', audioAdapterOut, '--check'],
    0,
  )
  run(
    'deck component bundle build',
    'sync-deck-components.mjs',
    ['--registry', registry, '--out', bundleOut, '--css-out', bundleCssOut, '--site', tmpRoot],
    0,
  )
  run(
    'deck component bundle check',
    'sync-deck-components.mjs',
    ['--registry', registry, '--out', bundleOut, '--css-out', bundleCssOut, '--site', tmpRoot, '--check'],
    0,
  )
  run('approved screens', 'list-approved-screens.mjs', [storyboard], 0)
  run(
    'review sections pass',
    'check-review-sections.mjs',
    [reviewSections, storyboard, '--require-approved'],
    0,
  )
  run(
    'review sections fail (grouped slides bypass per-page review)',
    'check-review-sections.mjs',
    [reviewSectionsGrouped, storyboard],
    1,
    'exactly one slide per section is required',
  )
  run(
    'review sections fail (overlap/missing)',
    'check-review-sections.mjs',
    [reviewSectionsBad, storyboard],
    1,
  )
  run(
    'approved screens in section',
    'list-approved-screens.mjs',
    [storyboard, '--sections', reviewSections, '--section', 'A'],
    0,
  )
  run(
    'next section first',
    'next-section.mjs',
    ['--sections', reviewSections, '--storyboard', storyboard, '--approvals', path.join(tmpRoot, 'review/approvals.json')],
    0,
  )

  // ---- courseware script ----
  run('courseware script pass', 'check-script.mjs', [script, content, style, registry], 0)
  run(
    'courseware script fail (missing narration)',
    'check-script.mjs',
    [scriptMissingNarration, content, style],
    1,
  )
  run(
    'courseware script fail (placeholder)',
    'check-script.mjs',
    [scriptPlaceholder, content, style],
    1,
  )
  const badTitleScript = path.join(tmpRoot, 'courseware-bad-title.md')
  let badTitleText = fs.readFileSync(script, 'utf8')
  badTitleText = badTitleText
    .replace('## S01 · 程序是一组指令', '## S01 · 封面：程序是一组指令')
    .replace('title: "程序是一组指令"', 'title: "封面：程序是一组指令"')
  fs.writeFileSync(badTitleScript, badTitleText)
  run(
    'courseware script fail (production title prefix)',
    'check-script.mjs',
    [badTitleScript, content, style, registry],
    1,
    'production label',
  )
  run(
    'quiz keys script pass',
    'check-quiz-keys.mjs',
    [quizKeysPass, '--content', quizKeysContent],
    0,
  )
  run(
    'quiz keys script fail (all A)',
    'check-quiz-keys.mjs',
    [quizKeysFail, '--content', quizKeysContent],
    1,
    'all 4 correct answers are at position A',
  )
  run(
    'quiz keys script slide scope pass',
    'check-quiz-keys.mjs',
    [quizKeysPass, '--content', quizKeysContent, '--slides', 'S01'],
    0,
  )
  run('quiz keys deck pass', 'check-quiz-keys.mjs', [quizKeysDeckPass], 0)
  run(
    'quiz keys deck fail (all A)',
    'check-quiz-keys.mjs',
    [quizKeysDeckFail],
    1,
    'all 4 correct answers are at position A',
  )
  run(
    'script → storyboard parity pass',
    'script-to-storyboard.mjs',
    [script, '--check', storyboard],
    0,
  )
  run(
    'script → storyboard parity fail',
    'script-to-storyboard.mjs',
    [script, '--check', storyboardRegistry],
    1,
  )
  run(
    'script-to-storyboard rejects an unapproved projection',
    'script-to-storyboard.mjs',
    [script, '--out', path.join(tmpRoot, 'never-storyboard.yml')],
    1,
    'approval',
  )

  // ---- component registry ----
  run('component package pass', 'check-component-package.mjs', [componentPkg, '--project-root', examples], 0)
  run('component package fail', 'check-component-package.mjs', [badComponentPkg], 1)
  run('registry pass', 'check-registry.mjs', [registry, '--style-pack', style, '--project-root', examples], 0)
  run(
    'registry search',
    'search-registry.mjs',
    ['--registry', registry, '--query', 'matrix edge sum', '--tags', 'matrix,edge', '--level', 'modify', '--style-pack', style, '--project-root', examples],
    0,
  )
  run(
    'staged components pass',
    'check-staged-components.mjs',
    ['--registry', registry, '--project-root', examples],
    0,
  )

  // ---- component plan ----
  const tmpComponentScript = path.join(tmpRoot, 'courseware.component.md')
  fs.copyFileSync(scriptComponent, tmpComponentScript)
  const componentApproval = path.join(tmpRoot, 'review/component-script-approval.json')
  run(
    'approve component plan script',
    'approve-script.mjs',
    [tmpComponentScript, '--approved-by', 'smoke', '--gate-choice', 'approve', '--run-id', 'smoke', '--out', componentApproval, '--manual'],
    0,
  )
  run(
    'component plan pass',
    'check-component-plan.mjs',
    [tmpComponentScript, style, registry, '--plan', componentPlan, '--briefs', componentBriefs, '--approval', componentApproval],
    0,
  )
  run(
    'component plan fail (missing gap/brief)',
    'check-component-plan.mjs',
    [tmpComponentScript, style, registry, '--plan', componentPlanMissing, '--briefs', componentBriefs, '--approval', componentApproval],
    1,
  )
  run(
    'component plan fail without script approval',
    'check-component-plan.mjs',
    [scriptComponent, style, registry, '--plan', componentPlan, '--briefs', componentBriefs, '--approval', path.join(tmpRoot, 'review/missing-approval.json')],
    1,
    'approval ledger not found',
  )

  // ---- script approval + rendered-section freeze ----
  const tmpScript = path.join(tmpRoot, 'courseware.md')
  fs.copyFileSync(script, tmpScript)
  const tmpApprovals = path.join(tmpRoot, 'review/page-approvals.json')
  const scriptApproval = path.join(tmpRoot, 'review/script-approval.json')
  const tmpShots = path.join(tmpRoot, 'screenshots')
  fs.mkdirSync(tmpShots, { recursive: true })
  fs.writeFileSync(path.join(tmpShots, 'S01.png'), 'smoke-png-S01')
  run(
    'approve script rejects a run without self-review',
    'approve-script.mjs',
    [tmpScript, '--approved-by', 'smoke', '--gate-choice', 'approve', '--run-id', 'smoke', '--out', path.join(tmpRoot, 'review/never-written-self-review.json')],
    1,
    'self-review',
  )
  run(
    'approve script',
    'approve-script.mjs',
    [tmpScript, '--approved-by', 'smoke', '--gate-choice', 'approve', '--run-id', 'smoke', '--out', scriptApproval, '--manual'],
    0,
  )
  run(
    'check script approval',
    'check-script-approval.mjs',
    [tmpScript, '--approval', scriptApproval],
    0,
  )
  run(
    'approve script rejects a non-approve gate',
    'approve-script.mjs',
    [tmpScript, '--approved-by', 'smoke', '--gate-choice', 'revise', '--run-id', 'smoke', '--out', path.join(tmpRoot, 'review/never-written.json'), '--manual'],
    1,
    'not "approve"',
  )
  run(
    'approve script rejects a paused workflow gate',
    'approve-script.mjs',
    [tmpScript, '--approved-by', 'smoke', '--gate-choice', 'approve', '--run-id', 'smoke-paused', '--out', path.join(tmpRoot, 'review/never-written-paused.json'), '--manual'],
    1,
    'expected "completed"',
  )

  const editedScript = path.join(tmpRoot, 'courseware-edited.md')
  fs.copyFileSync(tmpScript, editedScript)
  fs.appendFileSync(editedScript, '\n<!-- edited after approval -->\n')
  const editedLedger = path.join(tmpRoot, 'review/script-approval-edited.json')
  const editedLedgerData = JSON.parse(fs.readFileSync(scriptApproval, 'utf8'))
  editedLedgerData.script = path.relative(process.cwd(), editedScript)
  fs.writeFileSync(editedLedger, JSON.stringify(editedLedgerData, null, 2))
  run(
    'check script approval rejects an edit after approval',
    'check-script-approval.mjs',
    [editedScript, '--approval', editedLedger],
    1,
    'changed after approval',
  )

  const rejectLedger = path.join(tmpRoot, 'review/script-approval-reject.json')
  const rejectLedgerData = JSON.parse(fs.readFileSync(scriptApproval, 'utf8'))
  rejectLedgerData.gate.choice = 'reject'
  fs.writeFileSync(rejectLedger, JSON.stringify(rejectLedgerData, null, 2))
  run(
    'check script approval rejects a non-approve gate ledger',
    'check-script-approval.mjs',
    [tmpScript, '--approval', rejectLedger],
    1,
    'expected "approve"',
  )

  const pausedLedger = path.join(tmpRoot, 'review/script-approval-paused-run.json')
  const pausedLedgerData = JSON.parse(fs.readFileSync(scriptApproval, 'utf8'))
  pausedLedgerData.gate.runId = 'smoke-paused'
  fs.writeFileSync(pausedLedger, JSON.stringify(pausedLedgerData, null, 2))
  run(
    'check script approval rejects a paused gate run',
    'check-script-approval.mjs',
    [tmpScript, '--approval', pausedLedger],
    1,
    'expected "completed"',
  )

  const draftScript = path.join(tmpRoot, 'courseware-draft.md')
  fs.copyFileSync(tmpScript, draftScript)
  const draftApproval = path.join(tmpRoot, 'review/script-approval-draft.json')
  run(
    'approve draft copy before reverting it',
    'approve-script.mjs',
    [draftScript, '--approved-by', 'smoke', '--gate-choice', 'approve', '--run-id', 'smoke', '--out', draftApproval, '--manual'],
    0,
  )
  fs.writeFileSync(
    draftScript,
    fs.readFileSync(draftScript, 'utf8').replaceAll('status: APPROVED', 'status: DRAFT'),
  )
  run(
    'check script approval rejects DRAFT status',
    'check-script-approval.mjs',
    [draftScript, '--approval', draftApproval],
    1,
    'expected APPROVED',
  )

  run(
    'check section freeze (empty)',
    'check-section-freeze.mjs',
    ['--sections', reviewSections, '--storyboard', storyboard, '--script', tmpScript, '--approval', scriptApproval, '--approvals', tmpApprovals],
    0,
  )
  run(
    'build-screen rejects outside the production workflow',
    'build-screen.mjs',
    ['S01', '--url', 'http://127.0.0.1:9', '--storyboard', storyboard, '--script', tmpScript, '--approval', scriptApproval, '--out', tmpShots],
    1,
    'courseware-production',
  )
  run(
    'check-rendered-section rejects outside the production workflow',
    'check-rendered-section.mjs',
    ['--sections', reviewSections, '--storyboard', storyboard, '--section', 'A', '--screenshots', tmpShots],
    1,
    'courseware-production',
  )
  const freshDeck = path.join(tmpRoot, 'fresh-deck.json')
  fs.writeFileSync(freshDeck, JSON.stringify({ slides: [{ id: 'S01' }] }, null, 2))
  const freshShots = path.join(tmpRoot, 'fresh-shots')
  fs.mkdirSync(freshShots, { recursive: true })
  fs.writeFileSync(path.join(freshShots, 'S01.png'), 'smoke-png-S01')
  fs.writeFileSync(
    path.join(freshShots, 'S01.json'),
    JSON.stringify({ slideId: 'S01', deckSha256: sha256File(freshDeck) }),
  )
  run(
    'rendered screenshot matches the current deck',
    'check-rendered-section.mjs',
    ['--sections', reviewSections, '--storyboard', storyboard, '--section', 'A', '--screenshots', freshShots, '--deck', freshDeck, '--manual'],
    0,
  )
  fs.writeFileSync(freshDeck, JSON.stringify({ slides: [{ id: 'S01', title: 'changed' }] }, null, 2))
  run(
    'rendered screenshot is stale after a deck change',
    'check-rendered-section.mjs',
    ['--sections', reviewSections, '--storyboard', storyboard, '--section', 'A', '--screenshots', freshShots, '--deck', freshDeck, '--manual'],
    1,
    'stale',
  )
  run(
    'freeze-section rejects outside the production workflow',
    'freeze-section.mjs',
    ['--sections', reviewSections, '--storyboard', storyboard, '--script', tmpScript, '--approval', scriptApproval, '--id', 'A', '--approved-by', 'smoke', '--screenshots', tmpShots, '--approvals', tmpApprovals],
    1,
    'courseware-production',
  )
  run(
    'freeze rendered section (explicit manual test)',
    'freeze-section.mjs',
    ['--sections', reviewSections, '--storyboard', storyboard, '--script', tmpScript, '--approval', scriptApproval, '--id', 'A', '--approved-by', 'smoke', '--screenshots', tmpShots, '--approvals', tmpApprovals, '--manual'],
    0,
  )
  run(
    'check section freeze (partial fails require-all)',
    'check-section-freeze.mjs',
    ['--sections', reviewSections, '--storyboard', storyboard, '--script', tmpScript, '--approval', scriptApproval, '--approvals', tmpApprovals, '--require-all'],
    1,
  )
  run(
    'reopen rendered section',
    'reopen-section.mjs',
    ['--sections', reviewSections, '--id', 'A', '--reason', 'smoke rework', '--approvals', tmpApprovals],
    0,
  )

  // ---- shell art fail-closed ----
  const smokeDeck = path.join(tmpRoot, 'shell-deck.json')
  fs.writeFileSync(
    smokeDeck,
    JSON.stringify({ meta: { title: 'Smoke' }, slides: [{ id: 'S01', type: 'hero', title: 'Smoke', lead: 'Smoke' }] }),
  )
  const smokeArt = path.join(tmpRoot, 'shell-art-empty.json')
  fs.writeFileSync(smokeArt, JSON.stringify({ schemaVersion: '1.0', shell: 'branch-choice', images: {} }))
  if (hasBranchChoiceShell) {
    run(
      'prepare shell site fail-closed on missing art',
      'prepare-shell-site.mjs',
      ['--shell', 'branch-choice', '--deck', smokeDeck, '--art', smokeArt, '--out', path.join(tmpRoot, 'shell-site-no-art')],
      1,
    )
    run(
      'build shell site fail-closed on missing art',
      'build-shell-site.mjs',
      ['--script', tmpScript, '--approval', scriptApproval, '--shell', 'branch-choice', '--deck', smokeDeck, '--art', smokeArt, '--out', path.join(tmpRoot, 'shell-site-no-art-build')],
      1,
    )
    const previewFreeSite = path.join(tmpRoot, 'shell-site-preview-free')
    run(
      'prepare shell site strips preview-only fixtures',
      'prepare-shell-site.mjs',
      ['--shell', 'branch-choice', '--deck', smokeDeck, '--out', previewFreeSite, '--allow-missing-art'],
      0,
    )
    total += 1
    let previewStripPass = false
    let previewStripDetail = ''
    try {
      const leaked = ['preview-audio', 'preview-data.json'].filter((rel) => fs.existsSync(path.join(previewFreeSite, rel)))
      const narrationSources = ['narration-plan.js', 'voice-manifest.js']
        .map((rel) => fs.readFileSync(path.join(previewFreeSite, rel), 'utf8'))
        .join('\n')
      previewStripPass =
        leaked.length === 0 &&
        /dummy:\s*false/.test(narrationSources) &&
        !/preview-audio|占位语音/.test(narrationSources)
      previewStripDetail = leaked.length ? `leaked: ${leaked.join(', ')}` : 'no dummy preview files or narration'
    } catch (error) {
      previewStripDetail = error.message
    }
    console.log(`${previewStripPass ? 'PASS' : 'FAIL'} production site excludes dummy preview fixtures (${previewStripDetail})`)
    if (!previewStripPass) {
      failed += 1
      console.error('prepare-shell-site must not copy preview-audio/preview-data.json, and must not leave dummy narration in a site assembled without narration')
    }
  } else {
    skip('shell art fail-closed', 'no shells/branch-choice in this project')
  }

  // ---- registration on a temp copy ----
  run('ensure empty registry', 'ensure-registry.mjs', [emptyRegistry, style], 0)
  run(
    'register-staged-components rejects outside the production workflow',
    'register-staged-components.mjs',
    ['--registry', tmpRegistry, '--lesson', 'smoke-lesson', '--approved-by', 'smoke', '--project-root', examples, '--script', tmpScript, '--approval', scriptApproval],
    1,
    'courseware-production',
  )
  run(
    'register staged components',
    'register-staged-components.mjs',
    ['--registry', tmpRegistry, '--lesson', 'smoke-lesson', '--approved-by', 'smoke', '--project-root', examples, '--script', tmpScript, '--approval', scriptApproval, '--manual'],
    0,
  )
  run(
    'registry after registration',
    'check-registry.mjs',
    [tmpRegistry, '--style-pack', style, '--project-root', examples],
    0,
  )
  run(
    'record component usage',
    'record-component-usage.mjs',
    ['--registry', tmpRegistry, '--storyboard', storyboardRegistry, '--lesson', 'smoke-lesson', '--script', tmpScript, '--approval', scriptApproval],
    0,
  )

  // ---- workflow harness selection ----
  total += 1
  const workflowYaml = fs.readFileSync(
    path.join(root, 'workflows/courseware-production.yml'),
    'utf8',
  )
  const workflowForIntegration = readData(path.join(root, 'workflows/courseware-production.yml'))
  function collectDispatchSteps(steps, out = []) {
    for (const step of steps || []) {
      if (step && (step.type === 'command' || step.type === 'prompt')) out.push(step)
      for (const key of ['steps', 'then', 'else']) collectDispatchSteps(step[key], out)
    }
    return out
  }
  const dispatchSteps = collectDispatchSteps(workflowForIntegration.steps)
  const missingIntegration = dispatchSteps.filter(
    (step) => step.integration !== '{{ inputs.integration }}',
  )
  const integrationExpressions = dispatchSteps.length - missingIntegration.length
  const hasIntegrationInput =
    /^  integration:\n    type: string\n    default: "auto"/m.test(workflowYaml)
  const hasHardcodedIntegration = /integration:\s*"(?:claude|codex|zcode)"/.test(workflowYaml)
  const harnessPass =
    hasIntegrationInput && missingIntegration.length === 0 && !hasHardcodedIntegration
  console.log(
    `${harnessPass ? 'PASS' : 'FAIL'} workflow integration input (${integrationExpressions}/${dispatchSteps.length} dispatch steps)`,
  )
  if (!harnessPass) {
    failed += 1
    console.error(
      `workflow must declare an integration input defaulting to auto and use it for every command/prompt step (missing: ${missingIntegration.map((step) => step.id).join(', ') || 'none'})`,
    )
  }

  // ---- installer harness support ----
  total += 1
  const installerHelp = spawnSync(process.execPath, [path.join(root, 'install.mjs'), '--help'], {
    encoding: 'utf8',
  })
  const installerHelpPass =
    installerHelp.status === 0 && /claude\|codex\|zcode/.test(installerHelp.stdout || '')
  console.log(
    `${installerHelpPass ? 'PASS' : 'FAIL'} installer supports the zcode integration`,
  )
  if (!installerHelpPass) {
    failed += 1
    console.error('install.mjs --help must document --integration <claude|codex|zcode>')
  }

  // ---- per-page human review gate ----
  total += 1
  const workflowData = readData(path.join(root, 'workflows/courseware-production.yml'))
  function findStep(steps, id) {
    for (const step of steps || []) {
      if (step && step.id === id) return step
      const found = findStep(
        [...(step.steps || []), ...(step.then || []), ...(step.else || [])],
        id,
      )
      if (found) return found
    }
    return null
  }
  const loop = findStep(workflowData.steps, 'section_review_loop')
  function flattenSteps(steps) {
    const flat = []
    for (const step of steps || []) {
      flat.push(step)
      for (const key of ['steps', 'then', 'else']) flat.push(...flattenSteps(step[key]))
    }
    return flat
  }
  const pageSteps = flattenSteps((findStep(loop && loop.steps, 'section_body') || {}).then)
  const pageIds = pageSteps.map((step) => step.id)
  const pageGate = pageSteps.find((step) => step.id === 'review-page')
  const gateMessage = (pageGate && pageGate.message) || ''
  const gatePosition = pageIds.indexOf('review-page')
  const guardPosition = pageIds.indexOf('page-review-resume-guard')
  const pageGatePass =
    Boolean(loop) &&
    Boolean(pageGate) &&
    pageGate.type === 'gui-gate' &&
    gateMessage.includes('steps.advance_section.output.data.section.id') &&
    gateMessage.includes('inputs.deck_url') &&
    gateMessage.includes('player.html') &&
    pageGate.show_file ===
      'review/{{ inputs.lesson_slug }}/self-review-page-{{ steps.advance_section.output.data.section.id }}.md' &&
    Array.isArray(pageGate.options) &&
    pageGate.options.includes('approve') &&
    pageGate.options.includes('reject') &&
    pageGate.on_reject === 'abort' &&
    pageIds.indexOf('implement-section') >= 0 &&
    pageIds.indexOf('implement-section') < gatePosition &&
    pageIds.indexOf('check-self-review-page') >= 0 &&
    pageIds.indexOf('check-self-review-page') < gatePosition &&
    // One page self-review, fed by one evidence bundle; no separate component
    // self-review AI call.
    pageIds.indexOf('build-page-evidence') >= 0 &&
    pageIds.indexOf('build-page-evidence') < pageIds.indexOf('self-review-page') &&
    // The human-readable review is rendered from the JSON after the AI fills it.
    pageIds.indexOf('render-page-review') > pageIds.indexOf('self-review-page') &&
    pageIds.indexOf('render-page-review') < pageIds.indexOf('check-self-review-page') &&
    !pageIds.includes('self-review-page-components') &&
    // Spec Kit re-runs the enclosing body on resume; the guard must see the
    // pending/decided gate before implement/self-review can rewrite evidence.
    guardPosition >= 0 &&
    guardPosition < pageIds.indexOf('implement-section')
  console.log(`${pageGatePass ? 'PASS' : 'FAIL'} workflow per-page human review gate`)
  if (!pageGatePass) {
    failed += 1
    console.error(
      'workflow must gate every page inside section_review_loop with the deck URL + page self-review, after implementation and self-review pass',
    )
  }

  // ---- deterministic self-reviews ----
  total += 1
  const deterministicSelfReviews = [
    ['self-review-inputs', 'build-self-review-inputs.mjs'],
    ['self-review-alpha', 'build-self-review-alpha.mjs'],
    ['self-review-beta', 'build-self-review-beta.mjs'],
    ['self-review-gold', 'build-self-review-gold.mjs'],
  ]
  const deterministicProblems = deterministicSelfReviews.filter(([id, tool]) => {
    const step = findStep(workflowData.steps, id)
    return !step || step.type !== 'shell' || !String(step.run || '').includes(tool)
  })
  const deterministicSelfReviewPass = deterministicProblems.length === 0
  console.log(
    `${deterministicSelfReviewPass ? 'PASS' : 'FAIL'} deterministic self-reviews (inputs/alpha/beta/gold)`,
  )
  if (!deterministicSelfReviewPass) {
    failed += 1
    console.error(
      `self-reviews must be deterministic shell steps, not AI prompts: ${deterministicProblems
        .map(([id]) => id)
        .join(', ')}`,
    )
  }

  // ---- reference adaptation is per-lesson ----
  total += 1
  const referenceMapStep = findStep(workflowData.steps, 'build-reference-adaptation')
  const referenceCheckStep = findStep(workflowData.steps, 'check-reference-adaptation')
  const referenceAdaptationPass =
    referenceMapStep?.type === 'prompt' &&
    referenceCheckStep?.type === 'shell' &&
    String(referenceCheckStep.run || '').includes('check-reference-adaptation.mjs')
  console.log(
    `${referenceAdaptationPass ? 'PASS' : 'FAIL'} per-lesson reference adaptation map`,
  )
  if (!referenceAdaptationPass) {
    failed += 1
    console.error(
      'workflow must generate the reference adaptation map once and validate it before the page loop',
    )
  }

  // ---- deterministic rendered-text check ----
  total += 1
  const pageEvidenceSource = fs.readFileSync(
    path.join(root, 'tools/build-page-evidence.mjs'),
    'utf8',
  )
  const renderedTextPass =
    pageEvidenceSource.includes('check-rendered-text.mjs') &&
    fs.existsSync(path.join(root, 'tools/check-rendered-text.mjs')) &&
    fs.existsSync(path.join(root, 'tools/rendered-text-lib.mjs')) &&
    !pageEvidenceSource.includes('rendered screen text/code/output matches the script verbatim')
  console.log(`${renderedTextPass ? 'PASS' : 'FAIL'} deterministic rendered-text check`)
  if (!renderedTextPass) {
    failed += 1
    console.error(
      'page evidence must run check-rendered-text and must not leave the old verbatim-text AI checklist item',
    )
  }

  // ---- AI review image downscale ----
  total += 1
  const buildScreenSource = fs.readFileSync(path.join(root, 'tools/build-screen.mjs'), 'utf8')
  const pageReviewAiSource = fs.readFileSync(path.join(root, 'tools/page-review-ai.mjs'), 'utf8')
  const pageReviewLibSource = fs.readFileSync(path.join(root, 'tools/page-review-lib.mjs'), 'utf8')
  const aiImagePass =
    buildScreenSource.includes('Page.captureScreenshot') &&
    buildScreenSource.includes('aiImage') &&
    pageEvidenceSource.includes('aiImage') &&
    pageReviewAiSource.includes('shot.aiImage')
  console.log(`${aiImagePass ? 'PASS' : 'FAIL'} AI review image downscale`)
  if (!aiImagePass) {
    failed += 1
    console.error(
      'build-screen must emit a smaller aiImage and the page review tool must prefer it over png',
    )
  }

  // ---- single-shot page review (no coding agent) ----
  total += 1
  const selfReviewStep = findStep(workflowData.steps, 'self-review-page')
  const pageReviewPreflight = findStep(workflowData.steps, 'check-page-review-config')
  const singleShotPass =
    selfReviewStep?.type === 'shell' &&
    Number(selfReviewStep.timeout) >= 300 &&
    String(selfReviewStep.run || '').includes('page-review-ai.mjs') &&
    !selfReviewStep.prompt &&
    pageReviewPreflight?.type === 'shell' &&
    String(pageReviewPreflight.run || '').includes('--check-config') &&
    fs.existsSync(path.join(root, 'tools/page-review-ai.mjs')) &&
    fs.existsSync(path.join(root, 'tools/page-review-lib.mjs')) &&
    pageReviewAiSource.includes('fetch(endpoint') &&
    pageReviewLibSource.includes('Static-page rule') &&
    !pageReviewAiSource.includes('child_process') &&
    !pageReviewAiSource.includes('spawn(')
  console.log(`${singleShotPass ? 'PASS' : 'FAIL'} single-shot page review (no coding agent)`)
  if (!singleShotPass) {
    failed += 1
    console.error(
      'page self-review must be a direct single-shot model call with no coding-agent CLI, and the workflow must preflight its config',
    )
  }

  // ---- page review cache ----
  total += 1
  const cacheCheckStep = findStep(workflowData.steps, 'page-review-cache')
  const cacheAiStep = findStep(workflowData.steps, 'page-review-ai')
  const cacheStoreStep = findStep(workflowData.steps, 'page-review-cache-store')
  const pageCachePass =
    cacheCheckStep?.type === 'shell' &&
    cacheAiStep?.type === 'if' &&
    String(cacheAiStep.condition || '').includes('page-review-cache.output.data.reuse') &&
    cacheStoreStep?.type === 'shell' &&
    fs.existsSync(path.join(root, 'tools/page-review-cache.mjs'))
  console.log(`${pageCachePass ? 'PASS' : 'FAIL'} page self-review cache`)
  if (!pageCachePass) {
    failed += 1
    console.error(
      'page loop must check/store the page review cache and skip self-review-page only when reuse is true',
    )
  }

  // ---- compact page review scope ----
  total += 1
  const compactPageReviewPass =
    pageReviewLibSource.includes('visual layout') &&
    pageReviewLibSource.includes('interaction evidence') &&
    !pageReviewLibSource.includes('concepts[]: one entry') &&
    !pageReviewLibSource.includes('referenceAdaptation: the bundle') &&
    pageEvidenceSource.includes('conceptEntries') &&
    pageEvidenceSource.includes('referenceAdaptationSummary') &&
    pageEvidenceSource.includes('componentPlan') &&
    pageEvidenceSource.includes('visual layout and interaction are understandable')
  console.log(`${compactPageReviewPass ? 'PASS' : 'FAIL'} compact page self-review scope`)
  if (!compactPageReviewPass) {
    failed += 1
    console.error(
      'page review must only judge density/interaction/visual/component/placeholder; concepts and reference adaptation are pre-filled deterministically',
    )
  }

  // ---- density is page-primary ----
  total += 1
  const scriptReviewCheckStep = findStep(workflowData.steps, 'check-self-review-script')
  const scriptReviewNoDensity =
    scriptReviewCheckStep &&
    !String(scriptReviewCheckStep.run || '').includes('--script')
  console.log(
    `${scriptReviewNoDensity ? 'PASS' : 'FAIL'} script review does not gate density`,
  )
  if (!scriptReviewNoDensity) {
    failed += 1
    console.error(
      'check-self-review-script must not pass --script; density is judged in the page self-review',
    )
  }

  // ---- shell review gate ----
  total += 1
  const hasShellPreviewStep =
    /- id: validate-shell\n    type: shell\n    run: "node workflow\/tools\/check-shell\.mjs[^"\n]*--serve-preview[^"\n]*--json"\n    output_format: json/.test(workflowYaml)
  const hasShellReviewGate =
    /- id: review-shell\n    type: gui-gate\n/.test(workflowYaml) &&
    /message: "[^"\n]*steps\.validate-shell\.output\.data\.playerUrl/.test(workflowYaml) &&
    /message: "[^"\n]*narration\.voiceCount/.test(workflowYaml) &&
    /message: "[^"\n]*narration\.pageCount/.test(workflowYaml) &&
    /show_file: "\{\{ steps\.validate-shell\.output\.data\.reviewFile \}\}"/.test(workflowYaml)
  const shellReviewPass = hasShellPreviewStep && hasShellReviewGate
  console.log(`${shellReviewPass ? 'PASS' : 'FAIL'} workflow shell review gate`)
  if (!shellReviewPass) {
    failed += 1
    console.error(
      'workflow must render a shell preview, expose its URL/review file/dummy narration counts as JSON, and gate on it',
    )
  }

  // ---- every human gate is a hash-bound review gate ----
  total += 1
  const humanGates = []
  function collectHumanGates(steps) {
    for (const step of steps || []) {
      if (!step || typeof step !== 'object') continue
      if (step.type === 'gate' || step.type === 'gui-gate') humanGates.push(step)
      collectHumanGates(step.steps)
      collectHumanGates(step.then)
      collectHumanGates(step.else)
    }
  }
  collectHumanGates(workflowData.steps)
  const humanGatePass =
    humanGates.length === 11 &&
    humanGates.every((gate) => gate.type === 'gui-gate' && !('verdict_input' in gate))
  console.log(`${humanGatePass ? 'PASS' : 'FAIL'} workflow human gates use hash-bound gui-gate without verdict_input`)
  if (!humanGatePass) {
    failed += 1
    console.error(
      `expected all 11 human gates to be gui-gate with no verdict_input, found: ` +
        humanGates.map((gate) => `${gate.id}=${gate.type}${'verdict_input' in gate ? '+verdict_input' : ''}`).join(', '),
    )
  }

  // ---- fail-closed workflow runner ----
  const specifyProbe = spawnSync(process.env.SPECIFY_BIN || 'specify', ['--version'], {
    encoding: 'utf8',
  })
  if (specifyProbe.status === 0) {
    const reviewNote = path.join(tmpRoot, 'smoke-review.md')
    fs.writeFileSync(reviewNote, '# Smoke review\n\nReview this page at http://127.0.0.1:9/review\n')
    const toyGate = path.join(tmpRoot, 'toy-gate.yml')
    fs.writeFileSync(
      toyGate,
      [
        'schema_version: "1.0"',
        'workflow:',
        '  id: smoke-gate',
        '  name: Smoke Gate',
        '  version: "0.0.1"',
        '  author: smoke',
        '  description: smoke paused outcome',
        'inputs: {}',
        'steps:',
        '  - id: g',
        '    type: gate',
        '    message: "smoke gate review: http://127.0.0.1:9/review"',
        // JSON.stringify escapes Windows backslashes for YAML's double-quoted
        // scalar; a raw C:\... path is not a valid YAML escape sequence.
        `    show_file: ${JSON.stringify(reviewNote)}`,
        '    options: [approve, reject]',
        '    on_reject: abort',
        '',
      ].join('\n'),
    )
    run(
      'workflow wrapper fails closed on paused gate',
      'run-workflow.mjs',
      [toyGate],
      3,
      [
        'PAUSED workflow smoke-gate',
        'Review request:',
        'http://127.0.0.1:9/review',
        `Review file: ${reviewNote}`,
      ],
    )
    const toyOk = path.join(tmpRoot, 'toy-ok.yml')
    fs.writeFileSync(
      toyOk,
      [
        'schema_version: "1.0"',
        'workflow:',
        '  id: smoke-ok',
        '  name: Smoke OK',
        '  version: "0.0.1"',
        '  author: smoke',
        '  description: smoke completed outcome',
        'inputs: {}',
        'steps:',
        '  - id: s',
        '    type: shell',
        // `true` is a POSIX shell builtin; Windows cmd has no such command.
        `    run: ${JSON.stringify(`${process.execPath} --version`)}`,
        '',
      ].join('\n'),
    )
    run(
      'workflow wrapper passes a completed run',
      'run-workflow.mjs',
      [toyOk],
      0,
      'OK workflow smoke-ok completed',
    )
    run(
      'review gate end-to-end with gate-review.mjs',
      'test-gui-gate.mjs',
      [],
      0,
      'OK review gate end-to-end',
    )
    run(
      'review gate resume keeps the verdict when the pre-gate body would rewrite evidence',
      'test-gui-gate-resume.mjs',
      [],
      0,
      'OK review gate resume guard',
    )
    run(
      'page-level tools fail closed outside the production workflow',
      'test-review-guard.mjs',
      [],
      0,
      'OK review guard',
    )
    run(
      'per-lesson runtime paths are isolated',
      'test-lesson-paths.mjs',
      [],
      0,
      'OK lesson paths',
    )
    run(
      'text/character overlap geometry',
      'test-overlap.mjs',
      [],
      0,
      'OK overlap geometry',
    )
  } else {
    skip('workflow wrapper fail-closed', 'specify CLI not on PATH')
  }

  // ---- shell preview dummy fixture ----
  total += 1
  let previewFixturePass = false
  let previewFixtureDetail = ''
  try {
    const previewDeckFile = path.join(root, 'tools/shell-profiles/branch-v1/preview-deck.mjs')
    const previewAudioDir = path.join(root, 'tools/shell-profiles/branch-v1/preview-audio')
    const { default: deck } = await import(`${pathToFileURL(previewDeckFile).href}?v=${Date.now()}`)
    const manifest = JSON.parse(fs.readFileSync(path.join(previewAudioDir, 'manifest.json'), 'utf8'))
    const unmarked = deck.slides.filter((slide) => !String(slide.title || '').includes('占位'))
    const voiceIds = (manifest.voices || []).map((voice) => voice.id)
    const clips = (manifest.phrases || []).flatMap((phrase) =>
      Object.entries(phrase.files || {}).map(([voiceId, file]) => ({ ...file, voiceId })),
    )
    const missingFiles = new Set(
      clips.filter((clip) => !fs.existsSync(path.join(previewAudioDir, clip.file))).map((clip) => clip.file),
    )
    const badHashes = clips.filter(
      (clip) => !missingFiles.has(clip.file) && sha256File(path.join(previewAudioDir, clip.file)) !== clip.sha256,
    )
    const badDurations = clips.filter((clip) => !(clip.duration > 0))
    const voicesCovered = voiceIds.every((voiceId) => clips.some((clip) => clip.voiceId === voiceId))
    previewFixturePass =
      deck.meta?.preview?.dummy === true &&
      deck.slides.length >= 20 &&
      unmarked.length === 0 &&
      voiceIds.length >= 2 &&
      voicesCovered &&
      clips.length >= voiceIds.length * 4 &&
      missingFiles.size === 0 &&
      badHashes.length === 0 &&
      badDurations.length === 0
    previewFixtureDetail = `${deck.slides.length} dummy slide(s), ${voiceIds.length} voice(s), ${clips.length} audio file(s)`
    if (unmarked.length) previewFixtureDetail += `; ${unmarked.length} slide(s) missing 占位`
    if (missingFiles.size) previewFixtureDetail += `; ${missingFiles.size} missing audio file(s)`
    if (badHashes.length) previewFixtureDetail += `; ${badHashes.length} hash mismatch(es)`
    if (badDurations.length) previewFixtureDetail += `; ${badDurations.length} bad duration(s)`
  } catch (error) {
    previewFixtureDetail = error.message
  }
  console.log(`${previewFixturePass ? 'PASS' : 'FAIL'} shell preview dummy fixture (${previewFixtureDetail})`)
  if (!previewFixturePass) {
    failed += 1
    console.error(
      'preview deck must be marked dummy, every slide title must contain 占位, and every voice must have hashed, non-empty audio fixtures',
    )
  }

  // ---- fixed-canvas player ----
  total += 1
  const playerSite = path.join(tmpRoot, 'player-site')
  const playerRes = spawnSync(
    process.execPath,
    [path.join(toolsDir, 'write-player-page.mjs'), '--site', playerSite],
    { encoding: 'utf8' },
  )
  const playerFile = path.join(playerSite, 'player.html')
  const playerSource = fs.existsSync(playerFile) ? fs.readFileSync(playerFile, 'utf8') : ''
  const playerPass =
    playerRes.status === 0 &&
    playerSource.includes('<iframe') &&
    playerSource.includes('width: 1440px') &&
    playerSource.includes('src="./index.html"') &&
    playerSource.includes('scale(')
  console.log(`${playerPass ? 'PASS' : 'FAIL'} fixed 1440×900 player page`)
  if (!playerPass) {
    failed += 1
    console.error('write-player-page.mjs must emit a 1440×900 iframe player with whole-canvas scaling')
  }

  // ---- single-shot page review tool ----
  total += 1
  const pageReviewTest = spawnSync(
    process.execPath,
    [path.join(toolsDir, 'test-page-review-ai.mjs')],
    { encoding: 'utf8', cwd: projectRoot },
  )
  const pageReviewTestOutput = `${pageReviewTest.stdout || ''}\n${pageReviewTest.stderr || ''}`
  const pageReviewToolPass =
    pageReviewTest.status === 0 && /14\/14 page-review-ai tests passed/.test(pageReviewTestOutput)
  console.log(`${pageReviewToolPass ? 'PASS' : 'FAIL'} single-shot page review tool`)
  if (!pageReviewToolPass) {
    failed += 1
    console.error(pageReviewTestOutput.trimEnd())
    console.error('page-review-ai.mjs must pass its Anthropic/OpenAI/fallback/fail-closed tests')
  }

  // ---- page review cache round-trip ----
  total += 1
  const cacheDeck = path.join(tmpRoot, 'cache-deck.json')
  const cacheEvidence = path.join(tmpRoot, 'cache-evidence.json')
  const cacheReview = path.join(tmpRoot, 'cache-review.json')
  const cacheSkeleton = path.join(tmpRoot, 'cache-skeleton.json')
  const cacheDir = path.join(tmpRoot, 'page-review-cache')
  fs.writeFileSync(cacheDeck, JSON.stringify({ slides: [{ id: 'S01', type: 'blank', title: 'x' }] }))
  const baseEvidence = {
    section: { slides: ['S01'] },
    scriptSlides: [{ id: 'S01', screenContent: 'x' }],
    density: { slides: [{ slideId: 'S01', signals: { screenChars: 1 } }] },
    referenceAdaptation: { entries: [] },
    checks: [{ name: 'smoke', status: 'pass', summary: 'ok' }],
    screenshots: [{ slideId: 'S01', png: path.join(tmpRoot, 'missing.png') }],
  }
  fs.writeFileSync(cacheEvidence, JSON.stringify(baseEvidence))
  const cacheReviewData = {
    stage: 'page-S01',
    artifactPaths: ['x'],
    reviewedArtifacts: [],
    automatedChecks: [{ name: 'smoke', status: 'pass' }],
    checklist: [
      { item: 'interaction produces the declared evidence (not just watch/next)', status: 'pass' },
    ],
    density: [
      {
        slideId: 'S01',
        semanticUnits: [{ label: 'unit', evidence: 'evidence' }],
        signals: { screenChars: 1 },
        verdict: 'pass',
        notes: '',
      },
    ],
    concepts: [],
    issues: [],
    referenceAdaptation: 'deterministic',
    verdict: 'pass',
    reviewedAt: '2026-10-22T00:00:00Z',
  }
  fs.writeFileSync(cacheReview, JSON.stringify(cacheReviewData))
  const cacheSkeletonData = {
    ...cacheReviewData,
    density: [
      {
        slideId: 'S01',
        semanticUnits: [],
        signals: { screenChars: 1 },
        verdict: 'fail',
        notes: '',
      },
    ],
    checklist: [
      { item: 'interaction produces the declared evidence (not just watch/next)', status: 'n/a' },
    ],
    verdict: 'fail',
  }
  fs.writeFileSync(cacheSkeleton, JSON.stringify(cacheSkeletonData))
  const cacheBaseArgs = [
    '--lesson-slug', 'smoke',
    '--section', 'S01',
    '--evidence', cacheEvidence,
    '--deck', cacheDeck,
    '--registry', path.join(tmpRoot, 'missing-registry.json'),
    '--cache-dir', cacheDir,
    '--json',
  ]
  const cacheStore = spawnSync(
    process.execPath,
    [path.join(toolsDir, 'page-review-cache.mjs'), '--mode', 'store', ...cacheBaseArgs, '--review-json', cacheReview],
    { encoding: 'utf8' },
  )
  const cacheCheck = spawnSync(
    process.execPath,
    [path.join(toolsDir, 'page-review-cache.mjs'), '--mode', 'check', ...cacheBaseArgs, '--review-json', cacheSkeleton],
    { encoding: 'utf8' },
  )
  let cacheReuse = false
  try {
    cacheReuse = JSON.parse(cacheCheck.stdout).reuse === true
  } catch {
    cacheReuse = false
  }
  const changedEvidence = {
    ...baseEvidence,
    scriptSlides: [{ id: 'S01', screenContent: 'changed' }],
  }
  fs.writeFileSync(cacheEvidence, JSON.stringify(changedEvidence))
  fs.writeFileSync(cacheSkeleton, JSON.stringify(cacheSkeletonData))
  const cacheInvalidated = spawnSync(
    process.execPath,
    [path.join(toolsDir, 'page-review-cache.mjs'), '--mode', 'check', ...cacheBaseArgs, '--review-json', cacheSkeleton],
    { encoding: 'utf8' },
  )
  let cacheMiss = false
  try {
    cacheMiss = JSON.parse(cacheInvalidated.stdout).reuse === false
  } catch {
    cacheMiss = false
  }
  const cachePass =
    cacheStore.status === 0 && cacheCheck.status === 0 && cacheReuse && cacheMiss
  console.log(`${cachePass ? 'PASS' : 'FAIL'} page review cache reuse/invalidation`)
  if (!cachePass) {
    failed += 1
    console.error('page-review-cache must reuse unchanged pages and invalidate when page inputs change')
  }

  // ---- page review risk calibration tool ----
  total += 1
  const riskCalibrationPass = fs.existsSync(path.join(toolsDir, 'page-review-risk.mjs'))
  console.log(`${riskCalibrationPass ? 'PASS' : 'FAIL'} page review risk calibration tool`)
  if (!riskCalibrationPass) {
    failed += 1
    console.error('page-review-risk.mjs is missing')
  }

  // ---- performance tools ----
  total += 1
  const timingRun = path.join(tmpRunsDir, 'timing-perf')
  fs.mkdirSync(timingRun, { recursive: true })
  const timingStart = Date.now()
  const timingEvents = [
    ['step_started', 'build-page-evidence', timingStart],
    ['step_completed', 'build-page-evidence', timingStart + 1500],
    ['step_started', 'self-review-page', timingStart + 1500],
    ['step_completed', 'self-review-page', timingStart + 4500],
  ].map(([event, step_id, timestamp]) => ({
    event,
    step_id,
    status: event === 'step_completed' ? 'completed' : undefined,
    timestamp: new Date(timestamp).toISOString(),
  }))
  fs.writeFileSync(
    path.join(timingRun, 'log.jsonl'),
    `${timingEvents.map((event) => JSON.stringify(event)).join('\n')}\n`,
  )
  fs.writeFileSync(
    path.join(timingRun, 'state.json'),
    JSON.stringify({
      run_id: 'timing-perf',
      workflow_id: 'courseware-production',
      status: 'completed',
      inputs: { lesson_slug: 'smoke-lesson' },
    }),
  )
  const timingRes = spawnSync(
    process.execPath,
    [
      path.join(toolsDir, 'workflow-timing.mjs'),
      '--run',
      'timing-perf',
      '--dir',
      tmpRunsDir,
      '--json',
    ],
    { encoding: 'utf8' },
  )
  let timingPass = false
  try {
    const parsed = JSON.parse(timingRes.stdout)
    const page = parsed.steps.find((step) => step.step === 'self-review-page')
    const evidence = parsed.steps.find((step) => step.step === 'build-page-evidence')
    timingPass =
      timingRes.status === 0 &&
      page?.totalSeconds === 3 &&
      evidence?.totalSeconds === 1.5 &&
      fs.existsSync(path.join(toolsDir, 'bench-page-review.mjs'))
  } catch {
    timingPass = false
  }
  console.log(`${timingPass ? 'PASS' : 'FAIL'} page-review performance tools`)
  if (!timingPass) {
    failed += 1
    console.error('workflow-timing.mjs must pair step timestamps; bench-page-review.mjs must exist')
  }
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}

console.log(
  `\n${total - failed}/${total} smoke tests passed${skipped ? `, ${skipped} skipped` : ''}`,
)
if (failed) process.exit(1)
