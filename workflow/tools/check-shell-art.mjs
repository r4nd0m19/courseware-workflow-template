#!/usr/bin/env node
// Verify that per-lesson illustration variants are fresh, complete and
// traceable. This is the gate that prevents a shell's reference art from being
// shipped as a generated deck's art.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readJson, resolveShellDir, validateShellPackage } from './shell-lib.mjs'
import { countTransparent } from './image-alpha.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
function flag(name) { return args.includes(name) }

let shellDir
try {
  shellDir = resolveShellDir(opt('--shell', 'branch-choice'))
} catch (error) {
  console.error(`FAIL ${error.message}`)
  process.exit(2)
}
const artPath = opt('--art')
const siteDir = opt('--site')
const requireAll = flag('--require-all')
const jsonOut = flag('--json')
const errors = []
const warnings = []
const notes = []

if (!artPath) {
  console.error('usage: node check-shell-art.mjs --shell shells/<id> --art <art-manifest.json> [--site <assembled-site>] [--require-all] [--json]')
  process.exit(2)
}
const packageCheck = validateShellPackage(shellDir)
if (!packageCheck.ok) {
  console.error(`FAIL shell package\n${packageCheck.errors.map((e) => `  - ${e}`).join('\n')}`)
  process.exit(1)
}
const { shell } = packageCheck

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
function imageSize(buffer) {
  if (buffer.length > 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let off = 2
    while (off + 9 < buffer.length) {
      if (buffer[off] !== 0xff) { off += 1; continue }
      const marker = buffer[off + 1]
      const length = buffer.readUInt16BE(off + 2)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { format: 'jpeg', height: buffer.readUInt16BE(off + 5), width: buffer.readUInt16BE(off + 7) }
      }
      off += 2 + length
    }
  }
  if (buffer.length > 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16)
    if (chunk === 'VP8X') return { format: 'webp', width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) }
    if (chunk === 'VP8 ') return { format: 'webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
  }
  return null
}

const artFile = path.resolve(artPath)
const art = readJson(artFile, 'art manifest')
const artRoot = path.dirname(artFile)
if (art.shell && art.shell !== shell.id) errors.push(`art manifest is for shell ${art.shell}, not ${shell.id}`)
if (!art.images || typeof art.images !== 'object') errors.push('art.images is missing')
const slots = shell.assets?.illustrations || []
const seen = new Map()
for (const illustration of slots) {
  const entry = art.images?.[illustration.slot]
  if (!entry) {
    if (requireAll) errors.push(`${illustration.slot}: missing generated variant`)
    else warnings.push(`${illustration.slot}: no generated variant (the shell will fall back to reference art)`)
    continue
  }
  const src = entry.src || entry.file
  if (!src) { errors.push(`${illustration.slot}: src/file is missing`); continue }
  const file = path.resolve(artRoot, src)
  if (!fs.existsSync(file)) { errors.push(`${illustration.slot}: generated file not found: ${file}`); continue }
  const buffer = fs.readFileSync(file)
  const actualSha = sha256(file)
  if (entry.sha256 && actualSha !== entry.sha256) errors.push(`${illustration.slot}: hash ${actualSha} != manifest ${entry.sha256}`)
  const referenceFile = path.join(packageCheck.root, illustration.reference)
  const referenceSha = sha256(referenceFile)
  if (art.images[illustration.slot].referenceSha256 && art.images[illustration.slot].referenceSha256 !== referenceSha) {
    errors.push(`${illustration.slot}: manifest reference hash does not match shell reference ${illustration.reference}`)
  }
  if (actualSha === referenceSha) errors.push(`${illustration.slot}: generated file is byte-identical to the reference`)
  if (seen.has(actualSha)) errors.push(`${illustration.slot}: same file as ${seen.get(actualSha)}; variants must differ`)
  seen.set(actualSha, illustration.slot)
  const size = imageSize(buffer)
  if (!size || size.width < 256 || size.height < 256) errors.push(`${illustration.slot}: invalid image size ${JSON.stringify(size)}`)
  const pixelate = shell.assets?.postprocess?.pixelate
  if (pixelate) {
    if (entry.pixelated !== true) errors.push(`${illustration.slot}: shell requests pixelation but the manifest does not record it`)
    if (size && (size.width % pixelate.scale !== 0 || size.height % pixelate.scale !== 0)) {
      errors.push(`${illustration.slot}: size ${size.width}x${size.height} is not a multiple of the pixel scale ${pixelate.scale}`)
    }
  }
  if (size?.format !== 'png') {
    errors.push(`${illustration.slot}: generated mascot art must be PNG with alpha (got ${size?.format || 'unknown'})`)
  } else {
    const transparent = countTransparent(buffer)
    if (transparent === 0) {
      errors.push(`${illustration.slot}: art has no transparent pixels; the shell drop-shadow would outline a white rectangle`)
    }
  }
  if (!entry.prompt) errors.push(`${illustration.slot}: prompt provenance is missing`)
  if (entry.seed === undefined || entry.seed === null) errors.push(`${illustration.slot}: seed provenance is missing`)
  if (!entry.model) errors.push(`${illustration.slot}: model provenance is missing`)
  if (entry.reference && entry.reference !== illustration.reference) errors.push(`${illustration.slot}: used reference ${entry.reference}, expected ${illustration.reference}`)
  notes.push(`${illustration.slot}: ${size?.width}x${size?.height} seed=${entry.seed}`)
}

if (siteDir) {
  const manifestFile = path.join(path.resolve(siteDir), 'build-manifest.json')
  if (fs.existsSync(manifestFile)) {
    const build = readJson(manifestFile, 'build manifest')
    if (Array.isArray(build.missingArt) && build.missingArt.length) {
      errors.push(`site/build-manifest.json records missing art: ${build.missingArt.join(', ')}`)
    }
    const recorded = Object.keys(build.illustrations || {})
    for (const illustration of slots) {
      if (!recorded.includes(illustration.slot)) errors.push(`site/build-manifest.json has no illustration entry for ${illustration.slot}`)
    }
  }
  const artDataFile = path.join(path.resolve(siteDir), 'shell-art-data.js')
  if (!fs.existsSync(artDataFile)) errors.push('site/shell-art-data.js is missing')
  else {
    const source = fs.readFileSync(artDataFile, 'utf8')
    for (const illustration of slots) {
      if (!source.includes(`"${illustration.slot}"`) && !source.includes(`'${illustration.slot}'`)) {
        errors.push(`site/shell-art-data.js does not map slot ${illustration.slot}`)
      }
    }
    if (/reference\//.test(source)) errors.push('site/shell-art-data.js references reference/, which must not ship in a generated site')
    if (!/assets\/generated\//.test(source)) warnings.push('site/shell-art-data.js has no assets/generated/ entries')
  }
}

const report = { ok: errors.length === 0, shell: shell.id, art: artFile, site: siteDir || '', slots: slots.map((s) => s.slot), notes, warnings, errors }
if (jsonOut) console.log(JSON.stringify(report, null, 2))
else {
  console.log(report.ok ? `OK shell art ${shell.id}` : `FAIL shell art ${shell.id}`)
  for (const note of notes) console.log(`  - ${note}`)
  for (const warning of warnings) console.error(`  warning: ${warning}`)
  for (const error of errors) console.error(`  - ${error}`)
}
process.exit(report.ok ? 0 : 1)
