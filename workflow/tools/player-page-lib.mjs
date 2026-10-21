// Shared fixed-canvas player page.
//
// The courseware shell is responsive: browser zoom changes its CSS viewport and
// the shell reflows. The player renders the deck in a 1440×900 iframe and scales
// the iframe as a whole, so the internal layout stays identical to the AI
// screenshot at any window size or browser zoom.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const templatePath = fileURLToPath(new URL('../runtime/player.html', import.meta.url))

export function playerHtml() {
  return fs.readFileSync(templatePath, 'utf8')
}

export function playerUrlFor(baseUrl) {
  const base = String(baseUrl || '').trim()
  if (!base) return ''
  if (/\/index\.html(?:[?#].*)?$/.test(base)) return base.replace(/\/index\.html/, '/player.html')
  return base.endsWith('/') ? `${base}player.html` : `${base}/player.html`
}

export function writePlayerPage(siteDir, { force = false } = {}) {
  const html = playerHtml()
  const dest = path.join(siteDir, 'player.html')
  fs.mkdirSync(siteDir, { recursive: true })
  if (!force && fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === html) {
    return dest
  }
  fs.writeFileSync(dest, html)
  return dest
}
