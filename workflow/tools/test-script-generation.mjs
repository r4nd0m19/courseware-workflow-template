#!/usr/bin/env node
// Regression test for the structured courseware.md pipeline.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { parseScript } from './script-lib.mjs'
import { readData } from './lib.mjs'

const tools = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-script-'))
const input = path.join(tmp, 'script-input.json')
const courseware = path.join(tmp, 'courseware.md')
const sections = path.join(tmp, 'review-sections.yml')
const outline = path.join(tmp, 'script-outline.json')
const pages = path.join(tmp, 'script-pages')
const report = path.join(tmp, 'script-generation.json')
const mocks = path.join(tmp, 'mocks')
const contentFile = path.join(tmp, 'content.json')
const styleFile = path.join(tmp, 'style.json')
const conceptsFile = path.join(tmp, 'concepts.yml')
const registryFile = path.join(tmp, 'registry', 'index.json')
const stagingDir = path.join(tmp, 'registry', 'staging')

fs.mkdirSync(mocks)
fs.writeFileSync(
  contentFile,
  JSON.stringify({
    version: '1.0',
    lesson: { id: 'smoke-script', title: '测试课' },
    items: [{ id: 'K01', kind: 'knowledge', title: '测试概念', text: '测试概念', required: true }],
  }),
)
fs.writeFileSync(
  styleFile,
  JSON.stringify({
    id: 'smoke-style',
    version: '1.0',
    components: [{ id: 'cover-hero', status: 'core' }, { id: 'quiz-bank', status: 'core' }],
    layouts: [{ id: 'cover' }, { id: 'content-slide' }],
  }),
)
fs.writeFileSync(
  conceptsFile,
  YAML.stringify({
    schemaVersion: '1.0',
    lesson: 'smoke-script',
    concepts: [{
      id: 'C01',
      term: '测试概念',
      definition: '测试概念是一个用于验证结构化脚本生成的概念。',
      introducedOn: 'S01',
      mustAppear: ['测试概念', '必须出现'],
      evidence: '学生能说出测试概念。',
      sourceRefs: ['K01'],
    }],
  }),
)
// Staged code-judge: the script generator, check-script and vocabulary gates
// must see registry/staging, not just the core index.
fs.mkdirSync(path.join(stagingDir, 'code-judge'), { recursive: true })
fs.writeFileSync(
  path.join(stagingDir, 'code-judge', 'component.json'),
  JSON.stringify({
    id: 'code-judge',
    name: '代码判题',
    version: '0.1.0',
    status: 'core',
    propsSchema: { type: 'object', additionalProperties: true },
  }),
)
fs.writeFileSync(
  registryFile,
  JSON.stringify({
    schemaVersion: '1.0',
    registryId: 'smoke-registry',
    version: '0.0.1',
    stylePack: { id: 'smoke-style', version: '1.0' },
    components: [],
  }),
)
fs.writeFileSync(
  input,
  JSON.stringify({
    schemaVersion: '1.0',
    lessonSlug: 'smoke-script',
    lesson: '测试课',
    spec: { path: 'spec.md', text: '# 测试课\n\n学生能说出测试概念。' },
    content: {
      path: contentFile,
      items: [{ id: 'K01', kind: 'knowledge', text: '测试概念', required: true }],
    },
    concepts: {
      path: conceptsFile,
      concepts: [{
        id: 'C01',
        term: '测试概念',
        definition: '测试概念是一个用于验证结构化脚本生成的概念。',
        introducedOn: 'S01',
        mustAppear: ['测试概念', '必须出现'],
        evidence: '学生能说出测试概念。',
        sourceRefs: ['K01'],
      }],
    },
    style: {
      path: styleFile,
      components: [{ id: 'cover-hero' }, { id: 'quiz-bank' }],
      layouts: [{ id: 'cover' }, { id: 'content-slide' }],
    },
    registry: { path: registryFile, components: [] },
    templates: {},
    outputs: { courseware, reviewSections: sections },
    existing: { courseware: '' },
    rules: ['一页一个语义边界。'],
  }),
)

const outlineResponse = {
  lesson: 'smoke-script',
  title: '测试课',
  audience: '测试学生',
  duration: '45 minutes',
  overview: {
    learners: '测试学习者',
    objectives: [{ id: 'O1', text: '说出测试概念' }],
    misconceptions: [],
    pace: '导入 → 练习',
    componentStrategy: '使用 cover-hero。',
  },
  pages: [
    {
      id: 'S01',
      title: '测试页',
      objectiveId: 'O1',
      objective: '说出测试概念',
      contentRefs: ['K01'],
      purpose: '验证结构化生成。',
      concepts: ['C01'],
      components: ['cover-hero'],
      layout: 'cover',
      interaction: { type: 'cover-hero', level: 'watch', learningAction: 'observe' },
    },
    {
      id: 'S02',
      title: '测试练习',
      objectiveId: 'O1',
      objective: '说出测试概念',
      contentRefs: ['K01'],
      purpose: '用练习验证概念。',
      concepts: [],
      components: ['quiz-bank'],
      layout: 'content-slide',
      interaction: { type: 'quiz-bank', level: 'answer', learningAction: 'predict', component: 'quiz-bank' },
    },
    {
      id: 'S03',
      title: '测试判题',
      objectiveId: 'O1',
      objective: '说出测试概念',
      contentRefs: ['K01'],
      purpose: '用可运行的 C++ 练习验证概念。',
      concepts: [],
      components: ['code-judge'],
      layout: 'content-slide',
      interaction: { type: 'code-judge', level: 'construct', learningAction: 'construct', component: 'code-judge' },
      componentPlan: [{ id: 'code-judge', status: 'existing' }],
      exercise: { kind: 'code', component: 'code-judge' },
    },
  ],
}
const pageResponse = {
  id: 'S01',
  title: '测试页',
  screenContent: '测试概念\n\n必须出现',
  interactionDesign: {
    attempt: '本页只做定向，静态呈现即可。',
    learningAction: 'observe',
    contentDemand: '学生阅读测试概念。',
    evidence: '能说出测试概念。',
    learningFunction: '建立概念。',
    level: 'watch',
    initialState: '显示测试概念。',
    studentAction: '阅读',
    accessibility: '语义标题，键盘可读。',
    staticAlternative: '静态文字。',
    whyStatic: '定向页没有比静态文字更好的互动证据。',
  },
  narration: ['这是测试旁白。'],
  transition: '进入下一页。',
}
const pageResponse2 = {
  id: 'S02',
  title: '测试练习',
  screenContent: '选出正确说法。\n\nA. 测试概念\nB. 其他',
  interactionDesign: {
    attempt: '用选择题检验概念。',
    learningAction: 'predict',
    contentDemand: '学生需要从选项中预测正确说法。',
    evidence: '选中正确选项。',
    learningFunction: '检验概念。',
    level: 'answer',
    initialState: '显示题干和两个选项。',
    studentAction: '点击选项',
    successFeedback: '显示答对。',
    errorFeedback: '显示答错，并提示测试概念。',
    completion: '选中正确选项。',
    reset: '可以重试。',
    accessibility: '按钮可达，键盘可操作。',
    staticAlternative: '静态题干与答案解析。',
  },
  narration: ['请选择正确说法。'],
  transition: '进入下一页。',
}
function envelope(value) {
  return JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }] })
}
const pageResponse3 = {
  id: 'S03',
  title: '测试判题',
  exercise: {
    component: 'code-judge',
    statement: '读入两个整数，输出它们的和。',
    starterCode: '#include <iostream>\nint main() {\n  int a, b;\n  std::cin >> a >> b;\n  std::cout << a + b << std::endl;\n  return 0;\n}',
    tests: [{ id: 't1', label: '基本样例', input: '1 2\n', expected: '3\n' }],
  },
  interactionDesign: {
    attempt: '让学生在编辑器里运行代码并对照可见测试。',
    learningAction: 'construct',
    contentDemand: '学生需要自己写出可编译的程序。',
    evidence: '全部可见测试通过。',
    learningFunction: '把概念落到可运行程序。',
    level: 'construct',
    initialState: '显示题面、起始代码和一组测试。',
    studentAction: '修改代码并点击运行测试',
    successFeedback: '显示全部通过。',
    errorFeedback: '显示答案错误，并提示测试概念。',
    completion: '学生运行并理解可见测试结果。',
    reset: '可以恢复起始代码。',
    accessibility: '键盘可操作，状态有文字标签。',
    staticAlternative: '静态显示题面、代码与测试数据。',
  },
  narration: ['请补全程序并运行测试。'],
  transition: '完成后进入下一页。',
}
fs.writeFileSync(path.join(mocks, 'outline.json'), envelope(outlineResponse))
fs.writeFileSync(path.join(mocks, 'page-S01.json'), envelope(pageResponse))
fs.writeFileSync(path.join(mocks, 'page-S02.json'), envelope(pageResponse2))
fs.writeFileSync(path.join(mocks, 'page-S03.json'), envelope(pageResponse3))

function run() {
  return spawnSync(
    process.execPath,
    [
      path.join(tools, 'generate-courseware-script.mjs'),
      '--input', input,
      '--out', courseware,
      '--sections', sections,
      '--outline', outline,
      '--pages-dir', pages,
      '--report', report,
      '--work-dir', path.join(tmp, 'work'),
      '--mock-dir', mocks,
      '--api', 'anthropic-messages',
      '--model', 'mock',
    ],
    { encoding: 'utf8' },
  )
}

const result = run()
if (result.status !== 0) {
  console.error(result.stdout, result.stderr)
  process.exit(1)
}
assert.ok(fs.existsSync(courseware))
assert.ok(fs.existsSync(sections))
assert.ok(fs.existsSync(outline))
assert.ok(fs.existsSync(path.join(pages, 'S01.json')))
const parsed = parseScript(courseware)
assert.equal(parsed.slides.length, 3)
assert.equal(parsed.slides[0].id, 'S01')
assert.equal(parsed.slides[0].headingTitle, '测试页')
assert.match(parsed.slides[0].screenContent, /测试概念/)
assert.equal(parsed.slides[0].machine.interaction.level, 'watch')
assert.equal(parsed.slides[0].machine.status, 'DRAFT')
assert.equal(parsed.slides[1].id, 'S02')
assert.equal(parsed.slides[1].machine.interaction.level, 'answer')
const exerciseSlide = parsed.slides[2]
assert.equal(exerciseSlide.id, 'S03')
assert.match(exerciseSlide.screenContent, /阶段练习/)
assert.match(exerciseSlide.screenContent, /读入两个整数/)
assert.match(exerciseSlide.screenContent, /基本样例/)
assert.match(exerciseSlide.screenContent, /1 2/)
assert.equal(exerciseSlide.machine.exercise.component, 'code-judge')
assert.equal(exerciseSlide.machine.exercise.timeLimitMs, 2000)
assert.equal(exerciseSlide.machine.exercise.maxOutputBytes, 65536)
assert.deepEqual(exerciseSlide.machine.exercise.tests.map((test) => test.id), ['t1'])
const sectionData = readData(sections)
assert.equal(sectionData.sections.length, 3)
assert.deepEqual(sectionData.sections[0].slides, ['S01'])
assert.deepEqual(sectionData.sections[1].slides, ['S02'])
assert.deepEqual(sectionData.sections[2].slides, ['S03'])
const generatedReport = readData(report)
assert.equal(generatedReport.pages[0].attempts, 1)
const scriptGate = spawnSync(
  process.execPath,
  [path.join(tools, 'check-script.mjs'), courseware, contentFile, styleFile, registryFile],
  { encoding: 'utf8' },
)
if (scriptGate.status !== 0) {
  console.error(scriptGate.stdout, scriptGate.stderr)
  process.exit(1)
}
const conceptGate = spawnSync(
  process.execPath,
  [path.join(tools, 'check-concepts.mjs'), courseware, contentFile, '--concepts', conceptsFile],
  { encoding: 'utf8' },
)
if (conceptGate.status !== 0) {
  console.error(conceptGate.stdout, conceptGate.stderr)
  process.exit(1)
}
const storyboardFile = path.join(tmp, 'storyboard.json')
fs.writeFileSync(
  storyboardFile,
  JSON.stringify({ slides: outlineResponse.pages.map((page) => ({ id: page.id, title: page.title, status: 'DRAFT' })) }),
)
const sectionGate = spawnSync(
  process.execPath,
  [path.join(tools, 'check-review-sections.mjs'), sections, storyboardFile],
  { encoding: 'utf8' },
)
if (sectionGate.status !== 0) {
  console.error(sectionGate.stdout, sectionGate.stderr)
  process.exit(1)
}

// A failed page validation must be repaired with the validation errors, then
// pass on the next model call.
const reuse = JSON.parse(fs.readFileSync(input, 'utf8'))
reuse.outputs = { courseware, reviewSections: sections }
fs.writeFileSync(input, JSON.stringify(reuse))
const invalidPage = structuredClone(pageResponse)
invalidPage.screenContent = '缺少概念短语'
fs.writeFileSync(path.join(mocks, 'page-S01.json'), envelope(invalidPage))
fs.writeFileSync(path.join(mocks, 'page-S01-repair.json'), envelope(pageResponse))
const repaired = run()
if (repaired.status !== 0) {
  console.error(repaired.stdout, repaired.stderr)
  process.exit(1)
}
const repairedReport = readData(report)
assert.equal(repairedReport.pages[0].attempts, 2)
assert.match(parseScript(courseware).slides[0].screenContent, /必须出现/)

console.log('PASS structured courseware script generation + page repair')
