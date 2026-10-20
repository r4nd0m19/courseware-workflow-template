import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolveChrome() {
  const configPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'chrome-path.txt',
  )
  const configured = process.env.CHROME_PATH ||
    (fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8').trim() : '')
  const candidates = [
    configured,
    path.join(os.homedir(), '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean)
  return candidates.find((p) => {
    try {
      return fs.statSync(p).isFile()
    } catch {
      return false
    }
  }) || null
}
