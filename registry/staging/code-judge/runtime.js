// code-judge — browser-only C++ exercise with compile + test feedback.
//
// The component is intentionally self-contained: it asks the site for the
// judge-runtime directory (compiler WASM, WASI shim, editor bundle), compiles
// in a disposable module worker, and runs each test in a fresh worker. Test
// data is visible in the page; this is a classroom exercise, not a formal OJ.
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) {
    root.CodeJudgeCore = api.core
    if (root.CoursewareComponents && typeof root.CoursewareComponents.register === 'function') {
      root.CoursewareComponents.register('code-judge', api.component)
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const MAX_TESTS = 6
  const DEFAULTS = {
    timeLimitMs: 2000,
    compileTimeoutMs: 120000,
    maxOutputBytes: 65536,
    runtimeBaseUrl: 'judge-runtime/',
    fallbackMode: 'interactive',
    disabled: false,
  }
  const VALID_PROPS = new Set([
    'statement',
    'starterCode',
    'tests',
    'timeLimitMs',
    'compileTimeoutMs',
    'maxOutputBytes',
    'runtimeBaseUrl',
    'fallbackMode',
    'disabled',
    'ariaLabel',
  ])
  const STATUS_ORDER = ['CE', 'TLE', 'OLE', 'RE', 'WA', 'AC']
  const STATUS_LABELS = {
    AC: '通过',
    WA: '答案错误',
    RE: '运行错误',
    TLE: '超时',
    OLE: '输出超限',
    CE: '编译未通过',
    pending: '待运行',
    running: '运行中…',
    skipped: '未运行',
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
  }

  function nonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0
  }

  function asInt(value, fallback) {
    return Number.isInteger(value) ? value : fallback
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function safeRuntimeBaseUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return false
    const trimmed = value.trim()
    // Same-origin relative paths are allowed, including ../ for stories and
    // previews. External schemes and protocol-relative URLs are not: the
    // component only ever loads judge-runtime files from its own site.
    return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !trimmed.startsWith('//')
  }

  function validateProps(props) {
    const errors = []
    if (!isObject(props)) return ['props 必须是一个对象']
    for (const key of Object.keys(props)) {
      if (!VALID_PROPS.has(key)) errors.push(`未知属性 "${key}"`)
    }
    if (!nonEmpty(props.statement)) errors.push('statement 必须是非空字符串')
    if (props.starterCode != null && typeof props.starterCode !== 'string') {
      errors.push('starterCode 必须是字符串')
    }
    if (!Array.isArray(props.tests) || props.tests.length < 1 || props.tests.length > MAX_TESTS) {
      errors.push(`tests 必须包含 1–${MAX_TESTS} 组测试`)
      return errors
    }
    const ids = new Set()
    props.tests.forEach((test, index) => {
      const where = `tests[${index}]`
      if (!isObject(test)) {
        errors.push(`${where} 必须是对象`)
        return
      }
      for (const key of Object.keys(test)) {
        if (!['id', 'label', 'input', 'expected'].includes(key)) errors.push(`${where}: 未知属性 "${key}"`)
      }
      if (!nonEmpty(test.id)) errors.push(`${where}.id 必须是非空字符串`)
      else if (ids.has(test.id)) errors.push(`${where}.id "${test.id}" 重复`)
      else ids.add(test.id)
      if (!nonEmpty(test.label)) errors.push(`${where}.label 必须是非空字符串`)
      if (typeof test.input !== 'string') errors.push(`${where}.input 必须是字符串`)
      if (typeof test.expected !== 'string') errors.push(`${where}.expected 必须是字符串`)
    })
    if (props.timeLimitMs != null) {
      if (!Number.isInteger(props.timeLimitMs) || props.timeLimitMs < 200 || props.timeLimitMs > 10000) {
        errors.push('timeLimitMs 必须是 200–10000 之间的整数')
      }
    }
    if (props.compileTimeoutMs != null) {
      if (!Number.isInteger(props.compileTimeoutMs) || props.compileTimeoutMs < 10000 || props.compileTimeoutMs > 300000) {
        errors.push('compileTimeoutMs 必须是 10000–300000 之间的整数')
      }
    }
    if (props.maxOutputBytes != null) {
      if (!Number.isInteger(props.maxOutputBytes) || props.maxOutputBytes < 4096 || props.maxOutputBytes > 1048576) {
        errors.push('maxOutputBytes 必须是 4096–1048576 之间的整数')
      }
    }
    if (props.runtimeBaseUrl != null && !safeRuntimeBaseUrl(props.runtimeBaseUrl)) {
      errors.push('runtimeBaseUrl 必须是站点内的相对路径（不能是外部地址或包含 ..）')
    }
    if (props.fallbackMode != null && !['interactive', 'static'].includes(props.fallbackMode)) {
      errors.push('fallbackMode 必须是 interactive 或 static')
    }
    if (props.disabled != null && typeof props.disabled !== 'boolean') errors.push('disabled 必须是布尔值')
    if (props.ariaLabel != null && typeof props.ariaLabel !== 'string') errors.push('ariaLabel 必须是字符串')
    return errors
  }

  function normalizeProps(props) {
    const value = isObject(props) ? props : {}
    const base = nonEmpty(value.runtimeBaseUrl) ? value.runtimeBaseUrl.trim() : DEFAULTS.runtimeBaseUrl
    return {
      statement: String(value.statement == null ? '' : value.statement),
      starterCode: typeof value.starterCode === 'string' ? value.starterCode : '',
      tests: Array.isArray(value.tests)
        ? value.tests.map((test, index) => ({
            id: String(test && test.id ? test.id : `test-${index + 1}`),
            label: String(test && test.label ? test.label : `测试 ${index + 1}`),
            input: String(test && test.input != null ? test.input : ''),
            expected: String(test && test.expected != null ? test.expected : ''),
          }))
        : [],
      timeLimitMs: asInt(value.timeLimitMs, DEFAULTS.timeLimitMs),
      compileTimeoutMs: asInt(value.compileTimeoutMs, DEFAULTS.compileTimeoutMs),
      maxOutputBytes: asInt(value.maxOutputBytes, DEFAULTS.maxOutputBytes),
      runtimeBaseUrl: base.endsWith('/') ? base : `${base}/`,
      fallbackMode: value.fallbackMode === 'static' ? 'static' : 'interactive',
      disabled: value.disabled === true,
      ariaLabel: nonEmpty(value.ariaLabel) ? value.ariaLabel.trim() : '代码练习',
    }
  }

  // OJ-style comparison: normalize line endings, ignore trailing spaces on
  // each line and trailing blank lines; keep leading spaces and blank lines
  // between content. This is the convention students see in most judges.
  function normalizeOutput(text) {
    const lines = String(text == null ? '' : text)
      .replace(/^﻿/, '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/g, ''))
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    return lines.join('\n')
  }

  function compareOutput(actual, expected) {
    return normalizeOutput(actual) === normalizeOutput(expected)
  }

  function classifyRun(result, expected) {
    if (!result || result.timedOut) return 'TLE'
    if (result.outputLimitExceeded) return 'OLE'
    if (!result.ok || result.exitCode !== 0) return 'RE'
    return compareOutput(result.stdout, expected) ? 'AC' : 'WA'
  }

  function summarize(results) {
    const list = Array.isArray(results) ? results : []
    const counts = { total: list.length, passed: 0 }
    for (const result of list) {
      if (result && result.status === 'AC') counts.passed += 1
    }
    let status = 'AC'
    for (const candidate of STATUS_ORDER) {
      if (list.some((result) => result && result.status === candidate)) {
        status = candidate
        break
      }
    }
    if (!list.length) status = 'pending'
    return { status, ...counts }
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || String(status || '')
  }

  function runtimeUrl(base, file) {
    const normalized = base.endsWith('/') ? base : `${base}/`
    return new URL(`${normalized}${file}`, document.baseURI).href
  }

  function renderTestList(props, interactive) {
    return props.tests
      .map((test, index) => {
        const state = interactive ? 'pending' : ''
        return `<li class="code-judge-test" data-test-id="${esc(test.id)}" data-test-index="${index}">
  <div class="code-judge-test-head">
    <span class="code-judge-state" data-role="test-state">${interactive ? statusLabel(state) : '测试'}</span>
    <span class="code-judge-test-label">${esc(test.label)}</span>
  </div>
  <dl class="code-judge-test-data">
    <div class="code-judge-test-row"><dt>输入</dt><dd><pre data-role="test-input">${esc(test.input === '' ? '（无输入）' : test.input)}</pre></dd></div>
    <div class="code-judge-test-row"><dt>期望输出</dt><dd><pre data-role="test-expected">${esc(test.expected === '' ? '（空）' : test.expected)}</pre></dd></div>
  </dl>
  <div class="code-judge-actual" data-role="test-actual" hidden>
    <span class="code-judge-actual-label">你的输出</span>
    <pre data-role="test-actual-output"></pre>
    <span class="code-judge-test-note" data-role="test-note"></span>
  </div>
</li>`
      })
      .join('\n')
  }

  function renderStatic(props) {
    return `<div class="code-judge code-judge-static" role="region" aria-label="${esc(props.ariaLabel)}">
  <div class="code-judge-statement">${esc(props.statement)}</div>
  <div class="code-judge-static-grid">
    <section class="code-judge-panel">
      <div class="code-judge-panel-head"><span>初始代码</span></div>
      <pre class="code-judge-static-code">${esc(props.starterCode || '（空白）')}</pre>
    </section>
    <section class="code-judge-panel">
      <div class="code-judge-panel-head"><span>测试数据</span></div>
      <ol class="code-judge-tests code-judge-tests-static">${renderTestList(props, false)}</ol>
    </section>
  </div>
  <p class="code-judge-static-note">这是题目与测试数据的静态展示；在互动版中可以直接编写并运行代码。</p>
</div>`
  }

  function renderInteractive(props) {
    return `<div class="code-judge" role="region" aria-label="${esc(props.ariaLabel)}" data-running="false">
  <div class="code-judge-statement">${esc(props.statement)}</div>
  <div class="code-judge-grid">
    <section class="code-judge-panel code-judge-editor-panel">
      <div class="code-judge-panel-head">
        <span>写在下面</span>
        <span class="code-judge-shortcut">Ctrl/⌘ + Enter 运行</span>
      </div>
      <div class="code-judge-editor" data-role="editor">
        <textarea class="code-judge-textarea" data-role="textarea" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off" aria-label="C++ 代码编辑器"${props.disabled ? ' readonly' : ''}>${esc(props.starterCode)}</textarea>
      </div>
      <div class="code-judge-actions">
        <button type="button" class="code-judge-run" data-role="run"${props.disabled ? ' disabled' : ''}>运行测试</button>
        <button type="button" class="code-judge-reset" data-role="reset"${props.disabled ? ' disabled' : ''}>恢复初始代码</button>
        <span class="code-judge-status" data-role="status" role="status" aria-live="polite">${props.disabled ? '本页暂不可运行' : '准备好后点“运行测试”'}</span>
      </div>
    </section>
    <section class="code-judge-panel code-judge-results-panel">
      <div class="code-judge-panel-head">
        <span>测试结果</span>
        <span class="code-judge-summary" data-role="summary">还没运行</span>
      </div>
      <ol class="code-judge-tests" data-role="tests">${renderTestList(props, true)}</ol>
      <details class="code-judge-compile" data-role="compile-details" hidden>
        <summary>编译器输出</summary>
        <pre class="code-judge-compile-output" data-role="compile-output"></pre>
      </details>
    </section>
  </div>
</div>`
  }

  function render(props) {
    const normalized = normalizeProps(props)
    if (normalized.fallbackMode === 'static') return renderStatic(normalized)
    return renderInteractive(normalized)
  }

  function createJudge(props, elements) {
    const normalized = normalizeProps(props)
    const tests = normalized.tests
    const baseUrl = normalized.runtimeBaseUrl
    const testElements = new Map()
    for (const item of elements.tests.querySelectorAll('[data-test-id]')) {
      testElements.set(item.getAttribute('data-test-id'), item)
    }

    const state = {
      running: false,
      cancelled: false,
      cachedSource: '',
      cachedModule: null,
      editor: null,
      editorRequested: false,
    }
    const cancelHandlers = new Set()

    // The shell replaces #slide.innerHTML when the learner turns the page. Stop
    // any compile/run worker at that point instead of letting a detached
    // component keep a 120s compiler or a runaway program alive in the
    // background. The observer disconnects itself once the root is gone.
    const observer = new MutationObserver(() => {
      if (elements.root.isConnected) return
      state.cancelled = true
      observer.disconnect()
      for (const cancel of [...cancelHandlers]) cancel()
    })
    observer.observe(document.body, { childList: true, subtree: true })

    function setStatus(text, tone) {
      elements.status.textContent = text
      elements.status.dataset.tone = tone || ''
    }

    function setSummary(text, tone) {
      elements.summary.textContent = text
      elements.summary.dataset.tone = tone || ''
    }

    function setBusy(busy) {
      state.running = busy
      elements.root.dataset.running = busy ? 'true' : 'false'
      elements.root.setAttribute('aria-busy', busy ? 'true' : 'false')
      elements.run.disabled = busy || normalized.disabled
      elements.reset.disabled = busy || normalized.disabled
      elements.run.textContent = busy ? '运行中…' : '运行测试'
    }

    function resetTestElements() {
      for (const test of tests) {
        const item = testElements.get(test.id)
        if (!item) continue
        item.className = 'code-judge-test'
        item.querySelector('[data-role="test-state"]').textContent = statusLabel('pending')
        const actual = item.querySelector('[data-role="test-actual"]')
        actual.hidden = true
        item.querySelector('[data-role="test-actual-output"]').textContent = ''
        item.querySelector('[data-role="test-note"]').textContent = ''
      }
      elements.compileDetails.hidden = true
      elements.compileDetails.open = false
      elements.compileOutput.textContent = ''
    }

    function showCompileOutput(text) {
      if (!text || !text.trim()) return
      elements.compileDetails.hidden = false
      elements.compileDetails.open = true
      elements.compileOutput.textContent = truncate(text, 16000)
    }

    function updateTest(test, status, outcome) {
      const item = testElements.get(test.id)
      if (!item) return
      item.className = `code-judge-test is-${status.toLowerCase()}`
      item.querySelector('[data-role="test-state"]').textContent = statusLabel(status)
      const actualWrap = item.querySelector('[data-role="test-actual"]')
      const actualOutput = item.querySelector('[data-role="test-actual-output"]')
      const note = item.querySelector('[data-role="test-note"]')
      if (status === 'pending' || status === 'running') {
        actualWrap.hidden = true
        return
      }
      actualWrap.hidden = false
      if (outcome && outcome.timedOut) {
        actualOutput.textContent = '（运行超时，已停止）'
        note.textContent = `超过 ${normalized.timeLimitMs} 毫秒`
      } else if (outcome && outcome.outputLimitExceeded) {
        actualOutput.textContent = truncate(outcome.stdout || '')
        note.textContent = `输出超过 ${normalized.maxOutputBytes} 字节`
      } else if (outcome && outcome.ok === false) {
        actualOutput.textContent = truncate(outcome.stdout || outcome.stderr || '（没有输出）')
        note.textContent = outcome.error ? String(outcome.error) : '程序异常退出'
      } else if (outcome) {
        actualOutput.textContent = truncate(outcome.stdout || '（没有输出）')
        const stderr = String(outcome.stderr || '').trim()
        note.textContent = status === 'WA' && stderr ? `标准错误：${truncate(stderr, 400)}` : ''
      }
    }

    function truncate(text, limit = 4096) {
      const value = String(text == null ? '' : text)
      return value.length > limit ? `${value.slice(0, limit)}\n…（已截断）` : value
    }

    function compileSource(source) {
      return new Promise((resolve) => {
        let worker
        try {
          worker = new Worker(runtimeUrl(baseUrl, 'compile-worker.js'), { type: 'module' })
        } catch (error) {
          resolve({ ok: false, module: null, error: `无法启动编译器：${error.message}` })
          return
        }
        let settled = false
        const cleanup = () => {
          cancelHandlers.delete(cancel)
        }
        const finish = (value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          cleanup()
          worker.terminate()
          resolve(value)
        }
        const cancel = () => finish({ ok: false, module: null, cancelled: true })
        cancelHandlers.add(cancel)
        const timer = setTimeout(() => finish({ ok: false, module: null, timedOut: true, error: '编译超时' }), normalized.compileTimeoutMs)
        worker.onmessage = (event) => finish(event.data || { ok: false, module: null, error: '编译器没有返回结果' })
        worker.onerror = (event) => finish({ ok: false, module: null, error: event.message || '编译器加载失败' })
        try {
          worker.postMessage({
            id: 1,
            job: { source, fileName: 'main.cpp', flags: ['-std=c++17', '-O0'] },
          })
        } catch (error) {
          finish({ ok: false, module: null, error: `无法提交编译任务：${error.message}` })
        }
      })
    }

    function runTest(module, test) {
      return new Promise((resolve) => {
        let worker
        try {
          worker = new Worker(runtimeUrl(baseUrl, 'run-worker.js'), { type: 'module' })
        } catch (error) {
          resolve({ ok: false, exitCode: null, stdout: '', stderr: '', error: `无法启动运行器：${error.message}` })
          return
        }
        let settled = false
        const cleanup = () => {
          cancelHandlers.delete(cancel)
        }
        const finish = (value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          cleanup()
          worker.terminate()
          resolve(value)
        }
        const cancel = () => finish({ ok: false, timedOut: false, cancelled: true, stdout: '', stderr: '' })
        cancelHandlers.add(cancel)
        const timer = setTimeout(() => finish({ ok: false, timedOut: true, stdout: '', stderr: '' }), normalized.timeLimitMs + 750)
        worker.onmessage = (event) => finish(event.data || { ok: false, exitCode: null, stdout: '', stderr: '', error: '运行器没有返回结果' })
        worker.onerror = (event) => finish({ ok: false, exitCode: null, stdout: '', stderr: '', error: event.message || '运行器加载失败' })
        try {
          worker.postMessage({ id: 1, module, input: test.input, maxOutputBytes: normalized.maxOutputBytes })
        } catch (error) {
          finish({ ok: false, exitCode: null, stdout: '', stderr: '', error: `无法提交运行任务：${error.message}` })
        }
      })
    }

    async function run() {
      if (state.running || state.cancelled || normalized.disabled) return
      setBusy(true)
      resetTestElements()
      setSummary('正在运行…')
      setStatus('正在准备编译器…（第一次需要几秒）', 'busy')
      const source = getCode()
      let module = state.cachedModule && state.cachedSource === source ? state.cachedModule : null
      if (!module) {
        const compiled = await compileSource(source)
        if (state.cancelled || !elements.root.isConnected) return
        if (!compiled || !compiled.module) {
          const reason = compiled && compiled.timedOut
            ? '编译超时，请检查代码后重试'
            : compiled && compiled.error
              ? compiled.error
              : '编译没有通过'
          setStatus(reason, 'bad')
          setSummary(statusLabel('CE'), 'bad')
          if (compiled) showCompileOutput(compiled.compileOutput || compiled.error || '')
          setBusy(false)
          return
        }
        module = compiled.module
        state.cachedModule = module
        state.cachedSource = source
        showCompileOutput(compiled.compileOutput)
      }
      const results = []
      for (let index = 0; index < tests.length; index += 1) {
        if (state.cancelled || !elements.root.isConnected) return
        const test = tests[index]
        updateTest(test, 'running')
        setStatus(`正在运行第 ${index + 1} / ${tests.length} 组测试…`, 'busy')
        const outcome = await runTest(module, test)
        if (state.cancelled || !elements.root.isConnected) return
        const status = classifyRun(outcome, test.expected)
        results.push({ id: test.id, status })
        updateTest(test, status, outcome)
      }
      const summary = summarize(results)
      const summaryText = summary.status === 'AC'
        ? `全部通过 · ${summary.passed}/${summary.total}`
        : `${statusLabel(summary.status)} · ${summary.passed}/${summary.total} 通过`
      setSummary(summaryText, summary.status === 'AC' ? 'ok' : 'bad')
      setStatus(summary.status === 'AC' ? '全部通过，做得不错。' : '有测试没有通过，看看下方结果再改一改。', summary.status === 'AC' ? 'ok' : 'bad')
      setBusy(false)
    }

    function reset() {
      if (state.running) return
      if (state.editor) state.editor.setValue(normalized.starterCode)
      else elements.textarea.value = normalized.starterCode
      resetTestElements()
      setSummary('还没运行')
      setStatus('已恢复初始代码')
    }

    function loadEditor() {
      if (state.editorRequested || normalized.disabled) return
      state.editorRequested = true
      const script = document.createElement('script')
      script.src = runtimeUrl(baseUrl, 'codemirror.bundle.js')
      script.async = true
      script.onload = () => {
        const api = window.CoursewareCodeMirror
        if (!api || typeof api.create !== 'function') return
        const host = elements.editor
        const initial = elements.textarea.value
        const hadFocus = document.activeElement === elements.textarea
        host.textContent = ''
        const mount = document.createElement('div')
        mount.className = 'code-judge-editor-mount'
        host.appendChild(mount)
        try {
          state.editor = api.create(mount, {
            doc: initial,
            onChange() {},
            onRun() { void run() },
          })
          host.classList.add('is-codemirror')
          if (hadFocus) state.editor.focus()
          if (typeof window.fitLessonContent === 'function') window.fitLessonContent()
        } catch (error) {
          host.textContent = ''
          host.appendChild(elements.textarea)
        }
      }
      script.onerror = () => {
        // The textarea remains fully usable when the editor bundle is absent.
        setStatus('代码高亮没有加载，仍可直接输入和运行。')
      }
      document.head.appendChild(script)
    }

    function getCode() {
      return state.editor ? state.editor.getValue() : elements.textarea.value
    }

    elements.run.addEventListener('click', () => { void run() })
    elements.reset.addEventListener('click', reset)
    elements.textarea.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        void run()
      }
    })
    // The shell binds ArrowLeft/ArrowRight/F/A on document; stop editor keys
    // from bubbling so typing in CodeMirror never navigates the lesson.
    elements.root.addEventListener('keydown', (event) => {
      if (event.target && event.target.closest && event.target.closest('.code-judge-editor')) {
        event.stopPropagation()
      }
    })
    loadEditor()
  }

  function bind(rootElement, props) {
    const normalized = normalizeProps(props)
    if (normalized.fallbackMode === 'static' || normalized.disabled) return
    const rootNode = rootElement.querySelector('.code-judge')
    if (!rootNode) return
    const elements = {
      root: rootNode,
      textarea: rootNode.querySelector('[data-role="textarea"]'),
      editor: rootNode.querySelector('[data-role="editor"]'),
      run: rootNode.querySelector('[data-role="run"]'),
      reset: rootNode.querySelector('[data-role="reset"]'),
      status: rootNode.querySelector('[data-role="status"]'),
      summary: rootNode.querySelector('[data-role="summary"]'),
      tests: rootNode.querySelector('[data-role="tests"]'),
      compileDetails: rootNode.querySelector('[data-role="compile-details"]'),
      compileOutput: rootNode.querySelector('[data-role="compile-output"]'),
    }
    if (!elements.textarea || !elements.run || !elements.tests) return
    createJudge(normalized, elements)
  }

  return {
    core: {
      DEFAULTS,
      MAX_TESTS,
      validateProps,
      normalizeProps,
      normalizeOutput,
      compareOutput,
      classifyRun,
      summarize,
      statusLabel,
      safeRuntimeBaseUrl,
    },
    component: { render, bind },
  }
})
