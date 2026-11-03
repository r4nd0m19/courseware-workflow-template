// Run one compiled submission against one test in an isolated module worker.
//
// The main thread terminates this worker on the wall-clock limit (TLE). This
// worker only enforces the output cap; it never hosts the compiler, so a
// runaway student program cannot block compilation or the page.
import { WASI, File, OpenFile, ConsoleStdout } from './wasi-shim/index.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

class OutputLimitError extends Error {}

self.onmessage = async (event) => {
  const data = event.data || {}
  const id = data.id
  const module = data.module
  const input = String(data.input == null ? '' : data.input)
  const maxOutputBytes = Number.isInteger(data.maxOutputBytes) && data.maxOutputBytes > 0 ? data.maxOutputBytes : 65536

  let stdout = ''
  let stderr = ''
  let outputBytes = 0
  let outputLimitExceeded = false

  const collect = (target) => (chunk) => {
    outputBytes += chunk.length
    if (outputBytes > maxOutputBytes) {
      outputLimitExceeded = true
      throw new OutputLimitError(target)
    }
    const text = decoder.decode(chunk, { stream: true })
    if (target === 'stdout') stdout += text
    else stderr += text
  }

  try {
    const fds = [
      new OpenFile(new File(encoder.encode(input))),
      new ConsoleStdout(collect('stdout')),
      new ConsoleStdout(collect('stderr')),
    ]
    const wasi = new WASI(['main.wasm'], [], fds)
    const instance = await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: wasi.wasiImport,
    })
    const exitCode = wasi.start(instance)
    stdout += decoder.decode()
    stderr += decoder.decode()
    self.postMessage({
      id,
      ok: true,
      exitCode,
      stdout,
      stderr,
      outputLimitExceeded: false,
    })
  } catch (error) {
    stdout += decoder.decode()
    stderr += decoder.decode()
    if (outputLimitExceeded) {
      self.postMessage({
        id,
        ok: true,
        exitCode: null,
        stdout,
        stderr,
        outputLimitExceeded: true,
      })
      return
    }
    self.postMessage({
      id,
      ok: false,
      exitCode: null,
      stdout,
      stderr,
      outputLimitExceeded: false,
      error: String((error && error.message) || error || '运行进程出错'),
    })
  }
}
