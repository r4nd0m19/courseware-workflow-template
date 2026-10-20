#!/usr/bin/env node
import path from 'node:path'
import { ensureRegistry } from './registry-lib.mjs'
import { fail, ok } from './lib.mjs'

const [registryPath, stylePath] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!registryPath || !stylePath) {
  console.error('usage: node ensure-registry.mjs <registry.json> <style-pack-manifest.json>')
  process.exit(2)
}
try {
  const result = ensureRegistry(registryPath, stylePath)
  ok(
    result.created ? 'component registry created' : 'component registry',
    `${path.resolve(registryPath)} — ${result.index.components.length} component(s)`,
  )
} catch (err) {
  fail('component registry', [err.message])
  process.exit(1)
}
