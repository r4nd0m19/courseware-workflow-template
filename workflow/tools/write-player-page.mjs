#!/usr/bin/env node
// Write the fixed-canvas player.html into a shell/site directory.
import { parseFlagValue } from './self-review-lib.mjs'
import { writePlayerPage } from './player-page-lib.mjs'

const args = process.argv.slice(2)
const siteDir = parseFlagValue(args, '--site')
const force = args.includes('--force')

if (!siteDir) {
  console.error('usage: node write-player-page.mjs --site <shell-or-site-dir> [--force]')
  process.exit(2)
}
const dest = writePlayerPage(siteDir, { force })
console.log(`OK player ${dest}`)
