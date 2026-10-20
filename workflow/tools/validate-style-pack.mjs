#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import { readData, loadSchema, fail, ok } from './lib.mjs'

const args = process.argv.slice(2)
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const packPath = args.find((a) => !a.startsWith('--'))
const checkBaselines = args.includes('--check-baselines')
const freezePath = opt('--freeze')
if (!packPath) {
  console.log('no full style pack provided; validation skipped')
  process.exit(0)
}

const pack = readData(packPath)
const here = path.dirname(fileURLToPath(import.meta.url))
const componentSchema = loadSchema(path.join(here, '../schemas/component-spec.schema.json'))
const packSchema = loadSchema(path.join(here, '../schemas/style-pack.schema.json'))
const ajv = new Ajv({ allErrors: true, strict: false })
ajv.addSchema(componentSchema)
const validate = ajv.compile(packSchema)
const valid = validate(pack)
const errors = []
if (!valid) {
  for (const e of validate.errors || []) {
    errors.push(`${e.instancePath || '/'} ${e.message}`)
  }
}

if (Array.isArray(pack.components)) {
  const ids = new Set()
  for (const c of pack.components) {
    if (ids.has(c.id)) errors.push(`duplicate component id ${c.id}`)
    ids.add(c.id)
    if (checkBaselines && c.baseline) {
      const p = path.resolve(path.dirname(packPath), c.baseline)
      if (!fs.existsSync(p)) errors.push(`baseline missing for ${c.id}: ${c.baseline}`)
    }
  }
}
if (Array.isArray(pack.layouts)) {
  const ids = new Set()
  for (const l of pack.layouts) {
    if (ids.has(l.id)) errors.push(`duplicate layout id ${l.id}`)
    ids.add(l.id)
  }
}

// A frozen style pack is the input to a production run. Recompute the same
// hash freeze-style-pack.mjs writes (pack bytes + every declared baseline),
// so any later edit to the pack or its baselines invalidates the run.
function computeFreeze(packFile) {
  const data = JSON.parse(fs.readFileSync(packFile, 'utf8'))
  const dir = path.dirname(packFile)
  const baselineFiles = []
  for (const component of data.components || []) {
    if (!component.baseline) continue
    const p = path.resolve(dir, component.baseline)
    baselineFiles.push(path.relative(dir, p))
  }
  baselineFiles.sort()
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(packFile))
  for (const rel of baselineFiles) {
    hash.update(rel)
    hash.update(fs.readFileSync(path.resolve(dir, rel)))
  }
  return { sourceHash: hash.digest('hex'), baselineFiles }
}

let freezeChecked = false
if (freezePath) {
  freezeChecked = true
  if (!fs.existsSync(freezePath)) {
    errors.push(
      `freeze manifest missing: ${freezePath} (run freeze-style-pack.mjs before production)`,
    )
  } else {
    let freeze
    try {
      freeze = JSON.parse(fs.readFileSync(freezePath, 'utf8'))
    } catch (err) {
      errors.push(`freeze manifest is not valid JSON: ${err.message}`)
    }
    if (freeze) {
      if (freeze.id !== pack.id) {
        errors.push(`freeze id ${freeze.id} != pack id ${pack.id}`)
      }
      if (freeze.version !== pack.version) {
        errors.push(`freeze version ${freeze.version} != pack version ${pack.version}`)
      }
      if (!freeze.frozenAt || Number.isNaN(Date.parse(freeze.frozenAt))) {
        errors.push('freeze manifest has no valid frozenAt timestamp')
      }
      try {
        const current = computeFreeze(packPath)
        if (freeze.sourceHash !== current.sourceHash) {
          errors.push(
            'freeze sourceHash does not match the current pack + baselines; refreeze after changes',
          )
        }
        const frozenFiles = Array.isArray(freeze.baselineFiles) ? freeze.baselineFiles : []
        if (JSON.stringify(frozenFiles) !== JSON.stringify(current.baselineFiles)) {
          errors.push('freeze baselineFiles does not match the current pack baseline list')
        }
      } catch (err) {
        errors.push(`cannot recompute freeze hash: ${err.message}`)
      }
    }
  }
}

if (errors.length) fail(packPath, errors)
else
  ok(
    packPath,
    `${pack.components?.length || 0} component(s), ${pack.layouts?.length || 0} layout(s)` +
      (freezeChecked ? ', freeze manifest verified' : ''),
  )
if (errors.length) process.exit(1)
