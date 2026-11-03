#!/usr/bin/env node
// Install the browser-side C++ toolchain used by the code-judge component.
//
// The toolchain is ~95 MB, so it is not committed to this repository. This
// script downloads the exact npm release, verifies the tarball and every file
// we copy, and writes a small manifest under judge-runtime/browsercc/.
//
// Usage:
//   node judge-runtime/install.mjs                 # download browsercc@0.1.1
//   node judge-runtime/install.mjs --check         # verify an existing install
//   node judge-runtime/install.mjs --from <dir>    # install from an unpacked
//                                                  # npm package directory
//   node judge-runtime/install.mjs --force         # replace a stale install
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DEST = path.join(HERE, 'browsercc')

const PACKAGE = {
  name: 'browsercc',
  version: '0.1.1',
  tarball: 'https://registry.npmjs.org/browsercc/-/browsercc-0.1.1.tgz',
  tarballSha256: 'a937c2588bef53124ebcb4909248393fdf4b08c9baec254d071a6bf1d3b57d9a',
  // The precompiled header is only fetched by getPrecompiledHeader(); the
  // compile() API used by the judge never requests it.
  files: {
    'index.js': '0265e7fccbf29facb65db6cc59045bec746fc184fe5f0fdf05aa0150d9699570',
    'clang.js': '27aeadfcdb71f37fdeb6f1ca339de913ef9e2fdd1fd53c238a5decf635d9b129',
    'clang.wasm': 'd574339640a9764544f405d4b5ae79ef7d05e49725b416fba74f5b15c00f8ee5',
    'lld.js': 'b5054c24942687c744adbadcd549073ce3ecaf69b9fed5fa85a20c046751c1bf',
    'lld.wasm': '810bb3be4eec8ad6bae60ceb7355c07bf7de8a54b5c8acb4d7a80613bd43c4bf',
    'sysroot.tar': 'dbed83f93f0fa695f36041b82a95a8cd78f106a3f49d9cd860e57ae1ac823318',
  },
  license: 'LICENSE',
  licenseSha256: '23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3',
}

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback
}
const flag = (name) => args.includes(name)
const check = flag('--check')
const force = flag('--force')
const dest = path.resolve(opt('--dest', DEFAULT_DEST))
const from = opt('--from')

function fail(message) {
  console.error(`FAIL judge runtime — ${message}`)
  process.exit(1)
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function verifyFile(file, expected, label) {
  if (!fs.existsSync(file)) return `${label} is missing`
  const actual = sha256File(file)
  if (actual !== expected) return `${label} hash mismatch (expected ${expected}, got ${actual})`
  return ''
}

function verifyInstall(root) {
  const errors = []
  for (const [relative, expected] of Object.entries(PACKAGE.files)) {
    const file = path.join(root, relative)
    const error = verifyFile(file, expected, relative)
    if (error) errors.push(error)
    else if (fs.statSync(file).size === 0) errors.push(`${relative} is empty`)
  }
  const licenseError = verifyFile(path.join(root, PACKAGE.license), PACKAGE.licenseSha256, PACKAGE.license)
  if (licenseError) errors.push(licenseError)
  const manifestFile = path.join(root, 'INSTALL.json')
  if (!fs.existsSync(manifestFile)) {
    errors.push('INSTALL.json is missing')
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
      if (manifest.package !== PACKAGE.name || manifest.version !== PACKAGE.version) {
        errors.push(`INSTALL.json describes ${manifest.package}@${manifest.version}, expected ${PACKAGE.name}@${PACKAGE.version}`)
      }
      if (JSON.stringify(manifest.files) !== JSON.stringify(PACKAGE.files)) {
        errors.push('INSTALL.json file hashes do not match this installer')
      }
    } catch (error) {
      errors.push(`INSTALL.json is invalid: ${error.message}`)
    }
  }
  return errors
}

function copyKnownFiles(sourceDir) {
  fs.mkdirSync(dest, { recursive: true })
  for (const [relative, expected] of Object.entries(PACKAGE.files)) {
    const source = path.join(sourceDir, relative)
    if (!fs.existsSync(source)) fail(`${relative} not found in ${sourceDir}`)
    const actual = sha256File(source)
    if (actual !== expected) {
      fail(`${relative} in ${sourceDir} has hash ${actual}; expected the browsercc@${PACKAGE.version} release`)
    }
    fs.copyFileSync(source, path.join(dest, relative))
  }
  const licenseCandidates = [
    path.join(sourceDir, PACKAGE.license),
    path.join(path.dirname(sourceDir), PACKAGE.license),
  ]
  const license = licenseCandidates.find((file) => fs.existsSync(file))
  if (!license) fail(`${PACKAGE.license} not found in ${sourceDir} or its parent`)
  if (sha256File(license) !== PACKAGE.licenseSha256) fail(`${PACKAGE.license} hash mismatch`)
  fs.copyFileSync(license, path.join(dest, PACKAGE.license))
  fs.writeFileSync(
    path.join(dest, 'INSTALL.json'),
    `${JSON.stringify(
      {
        package: PACKAGE.name,
        version: PACKAGE.version,
        source: PACKAGE.tarball,
        tarballSha256: PACKAGE.tarballSha256,
        files: PACKAGE.files,
      },
      null,
      2,
    )}\n`,
  )
}

async function download(url, target) {
  let response
  try {
    response = await fetch(url, { redirect: 'follow' })
  } catch (error) {
    fail(`cannot download ${url}: ${error.message}\nRun again with network access, or pass --from <unpacked browsercc package directory>.`)
  }
  if (!response.ok) fail(`download ${url} failed: HTTP ${response.status}`)
  const data = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(target, data)
  return data
}

if (check) {
  const errors = verifyInstall(dest)
  if (errors.length) fail(`browsercc install at ${dest} is not usable:\n  ${errors.join('\n  ')}`)
  console.log(`OK judge runtime — browsercc@${PACKAGE.version} verified at ${dest}`)
  process.exit(0)
}

if (fs.existsSync(dest) && !force) {
  const errors = verifyInstall(dest)
  if (!errors.length) {
    console.log(`OK judge runtime — browsercc@${PACKAGE.version} already installed at ${dest}`)
    process.exit(0)
  }
  fail(`an incomplete browsercc install exists at ${dest}:\n  ${errors.join('\n  ')}\nRun with --force to replace it.`)
}

function resolvePackageDir(value) {
  const root = path.resolve(value)
  if (!fs.existsSync(root)) fail(`--from directory not found: ${root}`)
  const candidates = [
    root,
    path.join(root, 'dist'),
    path.join(root, 'package', 'dist'),
    path.join(root, 'browsercc', 'dist'),
  ]
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, 'index.js')))
  if (!found) fail(`no dist/ with index.js under --from ${root} (looked in ${candidates.join(', ')})`)
  return found
}

const fromDir = from || process.env.COURSEWARE_JUDGE_RUNTIME_FROM
if (fromDir) {
  const sourceDir = resolvePackageDir(fromDir)
  if (sourceDir === dest || sourceDir.startsWith(`${dest}${path.sep}`)) {
    fail(`--from cannot be the install destination (${dest}); point it at an unpacked browsercc package`)
  }
  fs.rmSync(dest, { recursive: true, force: true })
  copyKnownFiles(sourceDir)
  console.log(`OK judge runtime — browsercc@${PACKAGE.version} installed from ${sourceDir} into ${dest}`)
  process.exit(0)
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'courseware-browsercc-'))
const tarball = path.join(tempDir, `${PACKAGE.name}-${PACKAGE.version}.tgz`)
try {
  const data = await download(PACKAGE.tarball, tarball)
  const hash = crypto.createHash('sha256').update(data).digest('hex')
  if (hash !== PACKAGE.tarballSha256) {
    fail(`tarball hash mismatch (expected ${PACKAGE.tarballSha256}, got ${hash})`)
  }
  const extractDir = path.join(tempDir, 'extract')
  fs.mkdirSync(extractDir)
  const tar = spawnSync('tar', ['-xzf', tarball, '-C', extractDir], { stdio: 'inherit' })
  if (tar.error) fail(`cannot run tar: ${tar.error.message}`)
  if (tar.status !== 0) fail(`tar exited ${tar.status}`)
  const packageDir = path.join(extractDir, 'package', 'dist')
  if (!fs.existsSync(packageDir)) fail('downloaded tarball does not contain package/dist')
  fs.rmSync(dest, { recursive: true, force: true })
  copyKnownFiles(packageDir)
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}

const errors = verifyInstall(dest)
if (errors.length) fail(`installed files failed verification:\n  ${errors.join('\n  ')}`)
console.log(`OK judge runtime — browsercc@${PACKAGE.version} installed into ${dest}`)
