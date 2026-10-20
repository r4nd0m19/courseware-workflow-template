#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
  const pass = res.status === expected && (!expectedText || output.includes(expectedText))
  console.log(
    `${pass ? 'PASS' : 'FAIL'} ${name} (exit ${res.status}, expected ${expected})`,
  )
  if (!pass) {
    failed += 1
    if (res.stdout) console.log(res.stdout.trimEnd())
    if (res.stderr) console.error(res.stderr.trimEnd())
    if (expectedText && !output.includes(expectedText)) {
      console.error(`expected output to contain: ${expectedText}`)
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
const style = path.join(examples, 'style-pack.example.json')
const styleGenerated = path.join(examples, 'style-pack.generated.json')
const selfPass = path.join(examples, 'self-review.pass.json')
const selfFail = path.join(examples, 'self-review.fail.json')
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
  run('self-review fail', 'check-self-review.mjs', [selfFail], 1)
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
  run(
    'component plan pass',
    'check-component-plan.mjs',
    [scriptComponent, style, registry, '--plan', componentPlan, '--briefs', componentBriefs],
    0,
  )
  run(
    'component plan fail (missing gap/brief)',
    'check-component-plan.mjs',
    [scriptComponent, style, registry, '--plan', componentPlanMissing, '--briefs', componentBriefs],
    1,
  )

  // ---- script approval + rendered-section freeze ----
  const tmpScript = path.join(tmpRoot, 'courseware.md')
  fs.copyFileSync(script, tmpScript)
  const tmpApprovals = path.join(tmpRoot, 'review/page-approvals.json')
  const tmpShots = path.join(tmpRoot, 'screenshots')
  fs.mkdirSync(tmpShots, { recursive: true })
  fs.writeFileSync(path.join(tmpShots, 'S01.png'), 'smoke-png-S01')
  run(
    'approve script',
    'approve-script.mjs',
    [tmpScript, '--approved-by', 'smoke', '--out', path.join(tmpRoot, 'review/script-approval.json')],
    0,
  )
  run(
    'check section freeze (empty)',
    'check-section-freeze.mjs',
    ['--sections', reviewSections, '--storyboard', storyboard, '--script', tmpScript, '--approvals', tmpApprovals],
    0,
  )
  run(
    'freeze rendered section',
    'freeze-section.mjs',
    ['--sections', reviewSections, '--storyboard', storyboard, '--script', tmpScript, '--id', 'A', '--approved-by', 'smoke', '--screenshots', tmpShots, '--approvals', tmpApprovals],
    0,
  )
  run(
    'check section freeze (partial fails require-all)',
    'check-section-freeze.mjs',
    ['--sections', reviewSections, '--storyboard', storyboard, '--script', tmpScript, '--approvals', tmpApprovals, '--require-all'],
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
      ['--shell', 'branch-choice', '--deck', smokeDeck, '--art', smokeArt, '--out', path.join(tmpRoot, 'shell-site-no-art-build')],
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
    'register staged components',
    'register-staged-components.mjs',
    ['--registry', tmpRegistry, '--lesson', 'smoke-lesson', '--approved-by', 'smoke', '--project-root', examples],
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
    ['--registry', tmpRegistry, '--storyboard', storyboardRegistry, '--lesson', 'smoke-lesson'],
    0,
  )

  // ---- workflow harness selection ----
  total += 1
  const workflowYaml = fs.readFileSync(
    path.join(root, 'workflows/courseware-production.yml'),
    'utf8',
  )
  const integrationExpressions = (
    workflowYaml.match(/integration: "\{\{ inputs\.integration \}\}"/g) || []
  ).length
  const hasIntegrationInput =
    /^  integration:\n    type: string\n    default: "auto"/m.test(workflowYaml)
  const hasHardcodedIntegration = /integration:\s*"(?:claude|codex)"/.test(workflowYaml)
  const harnessPass =
    hasIntegrationInput && integrationExpressions >= 20 && !hasHardcodedIntegration
  console.log(
    `${harnessPass ? 'PASS' : 'FAIL'} workflow integration input (${integrationExpressions} steps)`,
  )
  if (!harnessPass) {
    failed += 1
    console.error(
      'workflow must declare an integration input defaulting to auto and use it for every command/prompt step',
    )
  }

  // ---- shell review gate ----
  total += 1
  const hasShellPreviewStep =
    /- id: validate-shell\n    type: shell\n    run: "node workflow\/tools\/check-shell\.mjs[^"\n]*--serve-preview[^"\n]*--json"\n    output_format: json/.test(workflowYaml)
  const hasShellReviewGate =
    /- id: review-shell\n    type: gate\n/.test(workflowYaml) &&
    /message: "[^"\n]*steps\.validate_shell\.output\.data\.previewUrl/.test(workflowYaml) &&
    /message: "[^"\n]*narration\.voiceCount/.test(workflowYaml) &&
    /message: "[^"\n]*narration\.pageCount/.test(workflowYaml) &&
    /show_file: "\{\{ steps\.validate_shell\.output\.data\.reviewFile \}\}"/.test(workflowYaml)
  const shellReviewPass = hasShellPreviewStep && hasShellReviewGate
  console.log(`${shellReviewPass ? 'PASS' : 'FAIL'} workflow shell review gate`)
  if (!shellReviewPass) {
    failed += 1
    console.error(
      'workflow must render a shell preview, expose its URL/review file/dummy narration counts as JSON, and gate on it',
    )
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
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}

console.log(
  `\n${total - failed}/${total} smoke tests passed${skipped ? `, ${skipped} skipped` : ''}`,
)
if (failed) process.exit(1)
