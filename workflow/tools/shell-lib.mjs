import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// Resolve `--shell` either as a package directory or as a shell id from a
// shells/index.json. Generation commands should be able to say `--shell
// branch-choice` without knowing the library layout.
export function resolveShellDir(value, { cwd = process.cwd() } = {}) {
  if (!value) throw new Error('shell is required (pass a shell directory or a shell id from shells/index.json)')
  const direct = path.resolve(cwd, value)
  if (fs.existsSync(path.join(direct, 'shell.json'))) return direct

  const indexCandidates = [
    path.join(cwd, 'shells', 'index.json'),
    path.resolve(HERE, '..', '..', 'shells', 'index.json'),
  ]
  for (const indexFile of [...new Set(indexCandidates)]) {
    if (!fs.existsSync(indexFile)) continue
    let index
    try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')) } catch { continue }
    const entry = (index.shells || []).find((shell) => shell.id === value)
    if (!entry) continue
    const shellDir = path.resolve(path.dirname(indexFile), entry.path || entry.id)
    if (!fs.existsSync(path.join(shellDir, 'shell.json'))) {
      throw new Error(`shell "${value}" is listed at ${indexFile} but ${shellDir}/shell.json is missing`)
    }
    return shellDir
  }
  throw new Error(`shell not found: ${value} (not a package directory, and no matching id in shells/index.json)`)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
}

export function serveDir(root, port = 0) {
  const base = path.resolve(root)
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      let rel = decodeURIComponent(url.pathname)
      if (rel.endsWith('/')) rel += 'index.html'
      const file = path.resolve(base, `.${rel}`)
      if (file !== base && !file.startsWith(`${base}${path.sep}`)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      fs.readFile(file, (error, data) => {
        if (error) {
          res.writeHead(404)
          res.end('not found')
          return
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
        res.end(data)
      })
    } catch {
      res.writeHead(400)
      res.end('bad request')
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        close: () => new Promise((done) => {
          server.closeAllConnections?.()
          server.close(() => done())
        }),
      })
    })
  })
}

export function readJson(file, label = file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${label}: ${error.message}`)
  }
}

export function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function loadShell(shellDir) {
  const root = path.resolve(shellDir)
  const manifestFile = path.join(root, 'shell.json')
  if (!fs.existsSync(manifestFile)) throw new Error(`shell.json not found: ${manifestFile}`)
  const shell = readJson(manifestFile)
  const siteDir = path.join(root, 'site')
  return { root, manifestFile, shell, siteDir }
}

export function validateShellPackage(shellDir) {
  const errors = []
  const warnings = []
  const notes = []
  let loaded
  try {
    loaded = loadShell(shellDir)
  } catch (error) {
    return { ok: false, errors: [error.message], warnings, notes }
  }
  const { root, shell, siteDir } = loaded
  if (!/^[a-z][a-z0-9-]*$/.test(String(shell.id || ''))) errors.push('shell.json: id must match ^[a-z][a-z0-9-]*$')
  if (!shell.name) errors.push('shell.json: name is missing')
  if (!shell.version) errors.push('shell.json: version is missing')
  if (!Array.isArray(shell.dataContract?.slideTypes) || !shell.dataContract.slideTypes.length) {
    errors.push('shell.json: dataContract.slideTypes is empty')
  }
  const required = [
    'site/index.html',
    'site/styles.css',
    'site/lesson.js',
    'site/deck.js',
    'site/shell-art-data.js',
    'SOURCE.json',
    'fidelity.json',
    'style-pack.manifest.json',
    'style-pack.full.json',
  ]
  for (const rel of required) {
    if (!fs.existsSync(path.join(root, rel))) errors.push(`missing ${rel}`)
  }
  const lessonFile = path.join(siteDir, 'lesson.js')
  if (fs.existsSync(lessonFile)) {
    const lesson = fs.readFileSync(lessonFile, 'utf8')
    for (const marker of ['COURSEWARE_SHELL_DATA', 'COURSEWARE_SHELL_ART', 'COURSEWARE_DEBUG', 'function shellArt(']) {
      if (!lesson.includes(marker)) errors.push(`site/lesson.js: missing data hook ${marker}`)
    }
    if (lesson.includes('const slides = [')) errors.push('site/lesson.js: embedded reference slide array is still present')
    if (/分支选择结构的简单应用/.test(lesson)) errors.push('site/lesson.js: reference lesson title is still embedded')
  }
  const indexFile = path.join(siteDir, 'index.html')
  if (fs.existsSync(indexFile)) {
    const html = fs.readFileSync(indexFile, 'utf8')
    const deckAt = html.indexOf('<script src="deck.js"></script>')
    const lessonAt = html.indexOf('<script src="lesson.js"></script>')
    const artAt = html.indexOf('<script src="shell-art-data.js"></script>')
    if (deckAt < 0) errors.push('site/index.html: deck.js is not loaded')
    if (artAt < 0) errors.push('site/index.html: shell-art-data.js is not loaded')
    if (lessonAt < 0) errors.push('site/index.html: lesson.js is not loaded')
    if (deckAt >= 0 && lessonAt >= 0 && deckAt > lessonAt) errors.push('site/index.html: deck.js must load before lesson.js')
    if (artAt >= 0 && lessonAt >= 0 && artAt > lessonAt) errors.push('site/index.html: shell-art-data.js must load before lesson.js')
  }
  const forbiddenDirs = ['site/reference', 'site/assets/narration']
  for (const rel of forbiddenDirs) {
    if (fs.existsSync(path.join(root, rel))) errors.push(`${rel} must not be shipped inside a shell site (lesson/reference content)`)
  }
  const sourceManifest = path.join(root, 'SOURCE.json')
  if (fs.existsSync(sourceManifest)) {
    const source = readJson(sourceManifest)
    for (const entry of source.files || []) {
      const file = path.join(root, entry.file)
      if (!fs.existsSync(file)) { errors.push(`SOURCE.json: missing ${entry.file}`); continue }
      if (sha256(file) !== entry.sha256) errors.push(`SOURCE.json: hash mismatch ${entry.file}`)
    }
    notes.push(`source ledger: ${source.files?.length || 0} file(s) verified`)
  }
  const full = path.join(root, 'style-pack.full.json')
  if (fs.existsSync(full)) {
    const pack = readJson(full)
    const componentTypes = new Set()
    for (const component of pack.components || []) {
      for (const type of component.sourceTypes || []) componentTypes.add(type)
    }
    for (const type of shell.dataContract?.slideTypes || []) {
      if (!componentTypes.has(type)) errors.push(`style-pack.full.json: no component declares sourceTypes "${type}"`)
    }
    const ids = new Set()
    for (const component of pack.components || []) {
      if (ids.has(component.id)) errors.push(`style-pack.full.json: duplicate component id ${component.id}`)
      ids.add(component.id)
      if (component.baseline && !fs.existsSync(path.join(root, component.baseline))) {
        errors.push(`style-pack.full.json: baseline missing for ${component.id}: ${component.baseline}`)
      }
    }
  }
  const fidelity = path.join(root, 'fidelity.json')
  if (fs.existsSync(fidelity)) {
    const manifest = readJson(fidelity)
    for (const selector of manifest.shell?.selectors || []) {
      if (typeof selector !== 'string') errors.push('fidelity.json: shell selectors must be strings')
    }
  }
  for (const art of shell.assets?.illustrations || []) {
    const ref = path.join(root, art.reference)
    if (!fs.existsSync(ref)) { errors.push(`illustration ${art.slot}: reference missing ${art.reference}`); continue }
    if (art.referenceSha256 && sha256(ref) !== art.referenceSha256) errors.push(`illustration ${art.slot}: reference hash mismatch`)
  }
  return { ok: errors.length === 0, errors, warnings, notes, shell, root, siteDir, manifestFile: loaded.manifestFile }
}
