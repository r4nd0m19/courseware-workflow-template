// Compile one C++ submission in an isolated module worker.
//
// The main thread terminates this worker after the reply (or after the
// compile timeout). The compiled WebAssembly.Module is structured-cloneable,
// so it can be posted back and run in a fresh worker per test.
import { compile } from './browsercc/index.js'

self.onmessage = async (event) => {
  const data = event.data || {}
  const id = data.id
  const job = data.job || {}
  try {
    const result = await compile({
      source: String(job.source == null ? '' : job.source),
      fileName: String(job.fileName || 'main.cpp'),
      flags: Array.isArray(job.flags) ? job.flags.map(String) : ['-std=c++17', '-O0'],
    })
    self.postMessage({
      id,
      ok: true,
      module: result.module,
      compileOutput: String(result.compileOutput || ''),
    })
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: String((error && error.message) || error || '编译进程出错'),
    })
  }
}
