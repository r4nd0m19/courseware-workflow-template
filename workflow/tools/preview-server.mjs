#!/usr/bin/env node
// Detached static preview server used by human-review gates.
//
// Started by preview-lib.mjs with detached: true and a state file. It serves a
// shell's site directory on 127.0.0.1 until the OS or the reviewer stops it;
// the state file is how the workflow finds the URL and PID later.
import fs from 'node:fs'
import path from 'node:path'
import { serveDir } from './shell-lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}

const root = path.resolve(opt('--root'))
const port = Number(opt('--port', '0'))
const stateFile = path.resolve(opt('--state'))
fs.mkdirSync(path.dirname(stateFile), { recursive: true })

try {
  const server = await serveDir(root, port)
  const stop = () => server.close().then(() => process.exit(0))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  fs.writeFileSync(stateFile, JSON.stringify({
    url: server.url,
    pid: process.pid,
    root,
    startedAt: new Date().toISOString(),
  }, null, 2))
} catch (error) {
  fs.writeFileSync(stateFile, JSON.stringify({ error: error.message, root, pid: process.pid }, null, 2))
  process.exit(1)
}
