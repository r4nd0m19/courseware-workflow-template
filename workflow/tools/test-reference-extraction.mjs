#!/usr/bin/env node
// Regression test for deterministic reference-verbatim extraction.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readData } from './lib.mjs'

const tools = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-reference-extract-'))
const shell = path.join(tmp, 'shell')
const template = path.join(tmp, 'template')
fs.mkdirSync(shell, { recursive: true })
fs.mkdirSync(path.join(template, 'tests'), { recursive: true })
fs.mkdirSync(path.join(template, 'stories'), { recursive: true })
fs.mkdirSync(path.join(template, 'baselines'), { recursive: true })
const sourceJs = `function escapeReference(value) { return String(value).replace(/</g, '&lt;') }
function renderReference(props) { return '<div class="ref-widget">' + escapeReference(props.text) + '</div>' }
function unrelatedHelper() { return 'do not copy' }
`
const sourceCss = `.other { color: red; }\n.ref-widget { border: 2px solid #111; }\n`
const sourceHtml = '<section><div class="ref-widget" id="ref-widget">reference</div></section>\n'
fs.writeFileSync(path.join(shell, 'source.js'), sourceJs)
fs.writeFileSync(path.join(shell, 'source.css'), sourceCss)
fs.writeFileSync(path.join(shell, 'source.html'), sourceHtml)
fs.writeFileSync(
  path.join(template, 'adapter.js'),
  `(function (root) {
  const api = { render: (props) => renderReference(props), bind: () => {} };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.CoursewareComponents) root.CoursewareComponents.register('ref-widget', api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
`,
)
fs.writeFileSync(
  path.join(template, 'tests/core.spec.mjs'),
  `import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const api = require('../runtime.js')
test('reference render works', () => {
  assert.match(api.render({ text: 'hello' }), /ref-widget/)
})
`,
)
fs.writeFileSync(
  path.join(template, 'stories/index.html'),
  '<!doctype html><html><body><section id="story-initial" data-story="initial"></section><script src="../runtime.js"></script></body></html>\n',
)
fs.writeFileSync(
  path.join(template, 'baselines/initial-1440x900.png'),
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lQn5WQAAAABJRU5ErkJggg==', 'base64'),
)
fs.mkdirSync(path.join(tmp, 'component-briefs'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'component-briefs/ref-widget.md'), '# ref-widget\n')
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
const manifest = {
  id: 'ref-widget',
  shell: 'shell',
  source: { js: 'source.js', css: 'source.css', html: 'source.html' },
  hashes: { js: hash(sourceJs), css: hash(sourceCss), html: hash(sourceHtml) },
  templateDir: 'template',
  adapter: 'adapter.js',
  selectors: ['.ref-widget'],
  functions: ['escapeReference', 'renderReference'],
  markupSelector: '.ref-widget',
}
const manifestPath = path.join(tmp, 'extract.json')
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
fs.writeFileSync(
  path.join(template, 'component.json'),
  JSON.stringify({
    id: 'ref-widget',
    name: '参考组件',
    version: '1.0.0',
    status: 'core',
    category: 'content',
    description: 'reference widget',
    tags: ['reference'],
    interactionLevels: ['watch'],
    whenToUse: 'reference',
    whenNotToUse: 'other',
    learningFunction: 'reference',
    propsSchema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } },
    states: ['default'],
    interactionModel: { states: ['default'], transitions: [] },
    accessibility: { keyboard: 'none', aria: 'none', focus: 'none', contrast: 'AA', reducedMotion: 'none' },
    fallback: { description: 'static' },
    implementation: 'runtime.js',
    stories: ['stories/index.html'],
    tests: ['tests/core.spec.mjs'],
    baselines: ['baselines/initial-1440x900.png'],
    provenance: { type: 'reference-verbatim', brief: 'component-briefs/ref-widget.md', approvedBy: 'pending', approvedAt: 'pending' },
    usedBy: [],
    runtime: 'vanilla-browser',
    styles: ['styles.css'],
    sourceFidelity: { kind: 'reference-verbatim', selectors: ['.ref-widget'], sourceRefs: ['placeholder'] },
  }, null, 2),
)
const out = path.join(tmp, 'out')
const result = spawnSync(process.execPath, [
  path.join(tools, 'extract-reference-component.mjs'),
  '--extract', manifestPath,
  '--out', out,
  '--project-root', tmp,
  '--force',
], { encoding: 'utf8', cwd: tmp })
if (result.status !== 0) {
  console.error(result.stdout, result.stderr)
  process.exit(1)
}
const runtime = fs.readFileSync(path.join(out, 'runtime.js'), 'utf8')
assert.match(runtime, /function renderReference/)
assert.match(runtime, /function escapeReference/)
assert.doesNotMatch(runtime, /unrelatedHelper/)
assert.match(fs.readFileSync(path.join(out, 'styles.css'), 'utf8'), /\.ref-widget/)
assert.doesNotMatch(fs.readFileSync(path.join(out, 'styles.css'), 'utf8'), /\.other/)
assert.match(fs.readFileSync(path.join(out, 'reference-fragment.html'), 'utf8'), /<div class="ref-widget"/)
const component = readData(path.join(out, 'component.json'))
assert.equal(component.sourceFidelity.kind, 'reference-verbatim')
assert.equal(component.sourceFidelity.sourceRefs[0].includes(manifest.hashes.js), true)
assert.equal(component.provenance.approvedBy, 'pending-page-review')
console.log('PASS deterministic reference-verbatim extraction')

// ---- automatic routing: reference-extracts/<id>.json -> list/build ---- //
{
  const approvedScript = path.join(tmp, 'courseware.md')
  fs.copyFileSync(
    path.join(path.dirname(tools), 'examples/courseware.component.example.md'),
    approvedScript,
  )
  fs.writeFileSync(
    approvedScript,
    fs.readFileSync(approvedScript, 'utf8').replaceAll('edge-sum-lab', 'ref-widget'),
  )
  fs.mkdirSync(path.join(tmp, 'component-briefs'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'component-briefs/ref-widget.md'), '# ref-widget\n')
  fs.writeFileSync(path.join(tmp, 'storyboard.yml'), 'slides:\n  - id: S01\n    components: [ref-widget]\n')
  fs.writeFileSync(
    path.join(tmp, 'review-sections.yml'),
    'schemaVersion: "1.0"\nsections:\n  - id: S01\n    title: 参考组件\n    slides: [S01]\n',
  )
  const runs = path.join(tmp, 'runs')
  fs.mkdirSync(path.join(runs, 'smoke'), { recursive: true })
  fs.writeFileSync(
    path.join(runs, 'smoke', 'state.json'),
    JSON.stringify({
      run_id: 'smoke',
      workflow_id: 'courseware-production',
      status: 'completed',
      step_results: {
        'review-script': {
          type: 'gate',
          status: 'completed',
          output: { choice: 'approve', options: ['approve', 'reject'] },
        },
      },
    }),
  )
  const approval = path.join(tmp, 'script-approval.json')
  const approve = spawnSync(process.execPath, [
    path.join(tools, 'approve-script.mjs'),
    approvedScript,
    '--approved-by', 'smoke',
    '--gate-choice', 'approve',
    '--run-id', 'smoke',
    '--out', approval,
    '--manual',
  ], { encoding: 'utf8', cwd: tmp, env: { ...process.env, COURSEWARE_WORKFLOW_RUNS_DIR: runs } })
  if (approve.status !== 0) {
    console.error(approve.stdout, approve.stderr)
    process.exit(1)
  }
  fs.mkdirSync(path.join(tmp, 'reference-extracts'), { recursive: true })
  fs.copyFileSync(manifestPath, path.join(tmp, 'reference-extracts/ref-widget.json'))
  const listEnv = {
    ...process.env,
    COURSEWARE_WORKFLOW_RUNS_DIR: runs,
    COURSEWARE_SCRIPT_APPROVAL: approval,
  }
  const list = spawnSync(process.execPath, [
    path.join(tools, 'list-missing-components.mjs'),
    '--script', approvedScript,
    '--storyboard', path.join(tmp, 'storyboard.yml'),
    '--sections', path.join(tmp, 'review-sections.yml'),
    '--registry', path.join(path.dirname(tools), '../registry/index.json'),
    '--staging', path.join(tmp, 'staging'),
  ], { encoding: 'utf8', cwd: tmp, env: listEnv })
  if (list.status !== 0) {
    console.error(list.stdout, list.stderr)
    process.exit(1)
  }
  const listed = JSON.parse(list.stdout)
  assert.deepEqual(listed.referenceVerbatim.map((entry) => entry.id), ['ref-widget'])
  assert.match(listed.referenceVerbatim[0].extract, /reference-extracts\/ref-widget\.json$/)

  const pageList = spawnSync(process.execPath, [
    path.join(tools, 'list-section-components.mjs'),
    '--script', approvedScript,
    '--storyboard', path.join(tmp, 'storyboard.yml'),
    '--sections', path.join(tmp, 'review-sections.yml'),
    '--section', 'S01',
    '--registry', path.join(path.dirname(tools), '../registry/index.json'),
    '--staging', path.join(tmp, 'staging'),
  ], { encoding: 'utf8', cwd: tmp, env: listEnv })
  if (pageList.status !== 0) {
    console.error(pageList.stdout, pageList.stderr)
    process.exit(1)
  }
  assert.equal(JSON.parse(pageList.stdout).referenceVerbatim[0].id, 'ref-widget')

  const repoRoot = path.resolve(tools, '../..')
  fs.symlinkSync(path.join(repoRoot, 'workflow'), path.join(tmp, 'workflow'), 'dir')
  const built = spawnSync(process.execPath, [
    path.join(tools, 'generate-components.mjs'),
    '--components', 'ref-widget',
    '--lesson-slug', 'demo-reference',
    '--script', approvedScript,
    '--brief-dir', path.join(tmp, 'component-briefs'),
    '--registry', path.join(path.dirname(tools), '../registry/index.json'),
    '--staging', path.join(tmp, 'staging'),
    '--project-root', tmp,
    '--work-dir', path.join(tmp, 'work-auto'),
  ], { encoding: 'utf8', cwd: tmp, env: listEnv })
  if (built.status !== 0) {
    console.error(built.stdout, built.stderr)
    process.exit(1)
  }
  const staged = path.join(tmp, 'staging/ref-widget')
  assert.ok(fs.existsSync(path.join(staged, 'component.json')))
  assert.match(fs.readFileSync(path.join(staged, 'runtime.js'), 'utf8'), /function renderReference/)
  console.log('PASS automatic reference-verbatim routing')
}
fs.rmSync(tmp, { recursive: true, force: true })
