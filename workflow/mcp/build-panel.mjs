#!/usr/bin/env node
// Build workflow/mcp/panel.html by inlining the MCP Apps browser runtime.
//
// The runtime comes from @modelcontextprotocol/ext-apps (MIT), installed in
// workflow/tools/node_modules. Panel HTML must be self-contained: ZCode loads
// the resource as text/html;profile=mcp-app, and an external script would be
// blocked by the host's app CSP.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..', '..')
const bundleCandidates = [
  process.env.MCP_APPS_BUNDLE,
  path.join(
    projectRoot,
    'workflow',
    'tools',
    'node_modules',
    '@modelcontextprotocol',
    'ext-apps',
    'dist',
    'src',
    'app-with-deps.js',
  ),
].filter(Boolean)

const bundlePath = bundleCandidates.find((candidate) => {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
})
if (!bundlePath) {
  console.error('FAIL cannot find the MCP Apps browser runtime.')
  console.error('Tried:')
  for (const candidate of bundleCandidates) console.error(`  - ${candidate}`)
  console.error('Install it with: npm ci --prefix workflow/tools')
  console.error('Or pass its path in MCP_APPS_BUNDLE.')
  process.exit(2)
}

let bundle = fs.readFileSync(bundlePath, 'utf8')
const exportBlocks = bundle.match(/export\{/g) || []
if (exportBlocks.length !== 1) {
  console.error(
    `FAIL unexpected MCP Apps runtime shape: expected exactly one export block, found ${exportBlocks.length}`,
  )
  process.exit(1)
}
const appBinding = bundle.match(/([A-Za-z0-9_$]+) as App(?:[,}])/)
if (!appBinding) {
  console.error('FAIL MCP Apps runtime does not export App')
  process.exit(1)
}
if (bundle.includes('</script')) {
  console.error('FAIL runtime contains </script and cannot be inlined safely')
  process.exit(1)
}
if (bundle.includes('__PANEL_TOKEN__')) {
  console.error('FAIL runtime contains the panel token placeholder')
  process.exit(1)
}

bundle = bundle.replace(
  'export{',
  `globalThis.__MCP_APPS__={App:${appBinding[1]}};export{`,
)

const templatePath = path.join(here, 'panel.template.html')
const template = fs.readFileSync(templatePath, 'utf8')
const placeholders = (template.match(/\/\*__MCP_APP_BUNDLE__\*\//g) || []).length
if (placeholders !== 1) {
  console.error(
    `FAIL panel.template.html must contain exactly one /*__MCP_APP_BUNDLE__*/ placeholder, found ${placeholders}`,
  )
  process.exit(1)
}
const tokenPlaceholders = (template.match(/__PANEL_TOKEN__/g) || []).length
if (tokenPlaceholders !== 1) {
  console.error(
    `FAIL panel.template.html must contain exactly one __PANEL_TOKEN__ placeholder, found ${tokenPlaceholders}`,
  )
  process.exit(1)
}

const html = template.replace('/*__MCP_APP_BUNDLE__*/', () => bundle)
const outPath = path.join(here, 'panel.html')
fs.writeFileSync(outPath, html)
console.log(`OK wrote ${outPath} (${html.length} bytes)`)
console.log(`   runtime: ${bundlePath}`)
