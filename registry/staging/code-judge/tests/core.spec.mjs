import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

globalThis.window = {}
const require = createRequire(import.meta.url)
require('../stories/fixtures.js')
const fixtures = globalThis.window.CODE_JUDGE_FIXTURES
const { core } = require('../runtime.js')

function fixture(name = 'sum') {
  return structuredClone(fixtures[name])
}

test('code-judge: valid fixtures pass validation and normalize defaults', () => {
  for (const name of Object.keys(fixtures)) {
    assert.deepEqual(core.validateProps(fixtures[name]), [])
  }
  const props = core.normalizeProps(fixture())
  assert.equal(props.timeLimitMs, 2000)
  assert.equal(props.compileTimeoutMs, 120000)
  assert.equal(props.maxOutputBytes, 65536)
  assert.equal(props.fallbackMode, 'interactive')
  assert.equal(props.disabled, false)
  assert.equal(props.runtimeBaseUrl, '../../../../judge-runtime/')
  assert.equal(props.tests.length, 3)
  assert.equal(props.tests[0].expected, '5\n')
})

test('code-judge: unknown props and malformed tests are rejected', () => {
  assert.match(core.validateProps({ ...fixture(), extra: true }).join('\n'), /未知属性/)
  assert.match(core.validateProps({ ...fixture(), statement: '  ' }).join('\n'), /statement/)
  assert.match(core.validateProps({ ...fixture(), tests: [] }).join('\n'), /1–6/)
  const duplicate = fixture()
  duplicate.tests[1].id = duplicate.tests[0].id
  assert.match(core.validateProps(duplicate).join('\n'), /重复/)
  const missingInput = fixture()
  delete missingInput.tests[0].input
  assert.match(core.validateProps(missingInput).join('\n'), /input 必须是字符串/)
  const unknownTestProp = fixture()
  unknownTestProp.tests[0].answer = '5'
  assert.match(core.validateProps(unknownTestProp).join('\n'), /未知属性/)
})

test('code-judge: limits and runtime URL are validated', () => {
  assert.match(core.validateProps({ ...fixture(), timeLimitMs: 100 }).join('\n'), /timeLimitMs/)
  assert.match(core.validateProps({ ...fixture(), timeLimitMs: 999999 }).join('\n'), /timeLimitMs/)
  assert.match(core.validateProps({ ...fixture(), compileTimeoutMs: 1000 }).join('\n'), /compileTimeoutMs/)
  assert.match(core.validateProps({ ...fixture(), maxOutputBytes: 10 }).join('\n'), /maxOutputBytes/)
  assert.match(core.validateProps({ ...fixture(), fallbackMode: 'magic' }).join('\n'), /fallbackMode/)
  assert.match(core.validateProps({ ...fixture(), runtimeBaseUrl: 'https://cdn.example.com/' }).join('\n'), /runtimeBaseUrl/)
  assert.match(core.validateProps({ ...fixture(), runtimeBaseUrl: '//cdn.example.com/' }).join('\n'), /runtimeBaseUrl/)
  assert.equal(core.validateProps({ ...fixture(), runtimeBaseUrl: '../judge-runtime/' }).length, 0)
  assert.equal(core.validateProps({ ...fixture(), runtimeBaseUrl: '/judge-runtime/' }).length, 0)
  assert.equal(core.safeRuntimeBaseUrl('judge-runtime/'), true)
  assert.equal(core.safeRuntimeBaseUrl('javascript:alert(1)'), false)
})

test('code-judge: output comparison ignores line endings, trailing spaces and trailing blank lines', () => {
  assert.equal(core.normalizeOutput('5\r\n'), '5')
  assert.equal(core.normalizeOutput('5  \n\n\n'), '5')
  assert.equal(core.normalizeOutput(' 5\n'), ' 5')
  assert.equal(core.normalizeOutput('a\n\nb\n'), 'a\n\nb')
  assert.equal(core.compareOutput('5\n', '5'), true)
  assert.equal(core.compareOutput('5 \r\n', '5\n'), true)
  assert.equal(core.compareOutput(' 5', '5'), false)
  assert.equal(core.compareOutput('5\n6\n', '5\n6'), true)
  assert.equal(core.compareOutput('5\n6', '5\n7'), false)
})

test('code-judge: run outcomes map to AC/WA/RE/TLE/OLE', () => {
  assert.equal(core.classifyRun({ ok: true, exitCode: 0, stdout: '5\n' }, '5'), 'AC')
  assert.equal(core.classifyRun({ ok: true, exitCode: 0, stdout: '6\n' }, '5'), 'WA')
  assert.equal(core.classifyRun({ ok: true, exitCode: 1, stdout: '5\n' }, '5'), 'RE')
  assert.equal(core.classifyRun({ ok: false, error: 'trap' }, '5'), 'RE')
  assert.equal(core.classifyRun({ timedOut: true }, '5'), 'TLE')
  assert.equal(core.classifyRun({ ok: true, outputLimitExceeded: true, stdout: 'x' }, '5'), 'OLE')
})

test('code-judge: summary reports first failure in CE/TLE/OLE/RE/WA order', () => {
  assert.deepEqual(
    core.summarize([
      { id: 't1', status: 'AC' },
      { id: 't2', status: 'AC' },
    ]),
    { status: 'AC', total: 2, passed: 2 },
  )
  assert.equal(core.summarize([{ status: 'AC' }, { status: 'WA' }]).status, 'WA')
  assert.equal(core.summarize([{ status: 'WA' }, { status: 'TLE' }]).status, 'TLE')
  assert.equal(core.summarize([{ status: 'RE' }, { status: 'OLE' }]).status, 'OLE')
  assert.equal(core.summarize([]).status, 'pending')
})

test('code-judge: static fallback renders statement, starter code and tests without controls', () => {
  const component = require('../runtime.js').component
  const htmlStatic = component.render({ ...fixture(), fallbackMode: 'static' })
  assert.match(htmlStatic, /code-judge-static/)
  assert.match(htmlStatic, /code-judge-static-code/)
  assert.match(htmlStatic, /A\+B|a 和 b|它们的和/)
  assert.equal(htmlStatic.includes('data-role="run"'), false)
  assert.equal(htmlStatic.includes('data-role="textarea"'), false)
  assert.match(htmlStatic, /样例 1/)
  assert.match(htmlStatic, /data-test-id="t3"/)
})

test('code-judge: interactive render includes editor, controls and visible test data', () => {
  const component = require('../runtime.js').component
  const html = component.render(fixture())
  assert.match(html, /data-role="textarea"/)
  assert.match(html, /data-role="run"/)
  assert.match(html, /data-role="reset"/)
  assert.match(html, /data-role="tests"/)
  assert.match(html, /data-role="compile-output"/)
  assert.match(html, /Ctrl\/⌘ \+ Enter/)
  assert.match(html, /2 3/)
  assert.match(html, /5/)
})

test('code-judge: disabled render keeps the code visible but read-only', () => {
  const component = require('../runtime.js').component
  const html = component.render({ ...fixture(), disabled: true })
  assert.match(html, /readonly/)
  assert.match(html, /本页暂不可运行/)
  assert.match(html, /data-role="run" disabled/)
})

test('code-judge: render escapes markup from props', () => {
  const component = require('../runtime.js').component
  const html = component.render({
    ...fixture(),
    statement: '<script>alert(1)</script>',
    starterCode: '<img src=x onerror=alert(1)>',
  })
  assert.equal(html.includes('<script>alert(1)</script>'), false)
  assert.equal(html.includes('<img src=x'), false)
  assert.match(html, /&lt;script&gt;/)
})
