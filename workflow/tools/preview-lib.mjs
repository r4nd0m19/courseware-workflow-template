// Human-review presentation helpers.
//
// A review gate must show the real artifact, not a re-description of it. For
// local HTML artifacts (the shell preview), that means a stable URL that stays
// up while the reviewer looks at it, plus a static snapshot for the record.
// This module owns the detached server, URL opening, and the review sheet.
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

async function reachable(url, timeout = 1500) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    return response.ok
  } catch {
    return false
  }
}

async function portFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
    tester.once('error', () => resolve(false))
    tester.once('listening', () => tester.close(() => resolve(true)))
    tester.listen(port, '127.0.0.1')
  })
}

export async function findFreePort(preferred, attempts = 20) {
  for (let port = preferred; port < preferred + attempts; port += 1) {
    if (await portFree(port)) return port
  }
  return 0
}

// Start (or reuse) a static server that outlives this process. The workflow
// gate can then point the reviewer at a URL that does not disappear when the
// validation script exits. State is written by the detached child so the
// parent learns the actual port (port 0 means the OS chose one).
export async function ensurePreviewServer({ root, stateFile, preferredPort = 8083 }) {
  const resolvedRoot = path.resolve(root)
  const resolvedState = path.resolve(stateFile)
  const existing = readState(resolvedState)
  if (existing?.url && existing.root === resolvedRoot && !existing.error && await reachable(existing.url)) {
    return { ...existing, reused: true }
  }

  const port = await findFreePort(preferredPort)
  fs.mkdirSync(path.dirname(resolvedState), { recursive: true })
  try { fs.unlinkSync(resolvedState) } catch {}

  const child = spawn(process.execPath, [
    path.join(here, 'preview-server.mjs'),
    '--root', resolvedRoot,
    '--port', String(port),
    '--state', resolvedState,
  ], { detached: true, stdio: 'ignore', cwd: process.cwd() })
  child.unref()

  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const state = readState(resolvedState)
    if (state?.error) throw new Error(state.error)
    if (state?.url && await reachable(state.url)) return { ...state, reused: false }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`preview server did not start within 8s (state: ${resolvedState})`)
}

function hasCommand(command) {
  if (process.platform === 'win32') return true
  return (process.env.PATH || '').split(path.delimiter).some((dir) => {
    try {
      fs.accessSync(path.join(dir, command), fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

// Best-effort only: WSL, desktop Linux, macOS, and Windows each use a
// different opener. Failure is not a gate failure; the URL is always printed.
export function openUrl(url) {
  const candidates = process.platform === 'darwin'
    ? [['open', [url]]]
    : process.platform === 'win32'
      ? [['cmd', ['/c', 'start', '', url]]]
      : [['wslview', [url]], ['xdg-open', [url]], ['gio', ['open', url]]]
  for (const [command, args] of candidates) {
    if (!hasCommand(command)) continue
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' })
      child.on('error', () => {})
      child.unref()
      return command
    } catch {
      // try the next opener
    }
  }
  return ''
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

// The gate can display one text file, so this sheet is the decision surface:
// the live URL first, then what to check, then the evidence. It stays well
// under the gate's 200-line display cap for the standard 30-slide preview.
export function writeShellPreview({ file, shell, shellDir, report, previewUrl, playerUrl, shotsDir }) {
  const shotFiles = shotsDir && fs.existsSync(shotsDir)
    ? fs.readdirSync(shotsDir).filter((name) => name.endsWith('.png')).sort()
    : []
  const slides = report.slides || []
  const types = report.types || []
  const nativeTypes = report.nativeTypes || [...new Set(types)]
  const interactions = report.interactions || { passed: [], failed: [] }
  const preview = report.preview || {}
  const narration = report.narration || {}
  const relativeShell = path.relative(process.cwd(), shellDir) || shellDir
  const relativeShots = shotsDir ? path.relative(process.cwd(), path.resolve(shotsDir)) : ''

  const lines = [
    `# 壳预览审核：${shell.name || shell.id}`,
    '',
    `- 预览地址（固定 1440×900 播放器）：${playerUrl || previewUrl}`,
    `- 直接地址（调试用，缩放会重排）：${previewUrl}`,
    `- 壳包：\`${relativeShell}\`（${shell.id}@${shell.version}）`,
    `- 预览 deck：${slides.length} 页占位内容；覆盖 ${nativeTypes.length} 种原生类型`,
    `- 占位标记：${preview.markedSlides ?? 0}/${preview.totalSlides ?? slides.length} 页标题含“占位”`,
    `- 占位语音：${narration.voiceCount ?? 0} 个音色、${narration.pageCount ?? 0} 页、${narration.clipCount ?? 0} 个音频文件；已解码 ${narration.decodedClips ?? 0} 个${narration.playedVoices?.length ? `，已播放 ${narration.playedVoices.join('、')}` : ''}`,
    `- 截图目录：${relativeShots ? `\`${relativeShots}\`（${shotFiles.length} 张）` : '未生成'}`,
    `- 自动播放：互动页停住并提示“下一页”${report.notes?.some((note) => /auto-play holds/.test(note)) ? '（已验证）' : ''}`,
    '',
    '## 怎么审',
    '',
    '1. 打开上面的预览地址，从第 1 页翻到最后一页。',
    '2. 对照下面的类型清单逐页看版式、字体、留白、顶栏/底栏/侧边学习路径。',
    '3. 点主要互动，确认有反馈；试一次自动播放，确认互动页会停住。',
    `4. 切换角色音色，确认 ${narration.voiceCount ?? 0} 个占位语音都能播放；语音只用于检查播放与切换。`,
    '5. 预览 deck 的所有文字与语音都是占位内容，不是本课教学内容；这里审的是壳本身。',
    '',
    '## 占位内容与语音',
    '',
    `- 内容标记：${preview.contentLabel || '占位内容'}（meta.preview.dummy=${preview.dummy === true}）`,
    `- 语音标记：${narration.label || preview.voiceLabel || '占位语音'}（manifest.dummy=${narration.dummy === true}）`,
    `- 音频目录：\`shells/<id>/site/preview-audio/\`；生成工具：\`workflow/tools/make-preview-voice.mjs\``,
    '',
    '## 类型覆盖',
    '',
    nativeTypes.length ? nativeTypes.map((type) => `- ${type}`).join('\n') : '- （未读取到类型）',
    '',
    '## 互动自检',
    '',
    interactions.passed.length ? `- 通过：${interactions.passed.join('、')}` : '- 通过：无',
    interactions.failed.length ? `- 失败：${interactions.failed.join('；')}` : '- 失败：无',
    '',
    '## 逐页证据',
    '',
    '| # | 类型 | 截图 | 渲染文本 |',
    '| --- | --- | --- | --- |',
    ...slides.map((slide) => {
      const shot = shotFiles.find((name) => name.startsWith(`${String(slide.index + 1).padStart(2, '0')}-`)) || ''
      return `| ${slide.index + 1} | ${escapeCell(slide.type)} | ${shot ? `\`${shot}\`` : '—'} | ${escapeCell(slide.text)} |`
    }),
    '',
  ]
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.writeFileSync(path.resolve(file), `${lines.join('\n')}\n`)
}

export function fileUrl(file) {
  return pathToFileURL(path.resolve(file)).href
}
