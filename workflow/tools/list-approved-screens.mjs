import { readData } from './lib.mjs'
import {
  readSectionManifest,
  sectionById,
  validateSectionManifest,
} from './section-lib.mjs'

const args = process.argv.slice(2)
const storyboardPath = args.find((a) => !a.startsWith('--'))
function opt(name, fallback = '') {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const sectionsPath = opt('--sections')
const sectionId = opt('--section')

if (!storyboardPath) {
  console.error(`usage: node list-approved-screens.mjs <storyboard.yml> [options]

Options:
  --sections <file>   review-sections.yml
  --section <id>      restrict to one review section and require its slides APPROVED
`)
  process.exit(2)
}

const storyboard = readData(storyboardPath)
let slides = storyboard.slides

if (sectionsPath || sectionId) {
  if (!sectionsPath || !sectionId) {
    console.error('FAIL --sections and --section must be provided together')
    process.exit(2)
  }
  const manifest = readSectionManifest(sectionsPath)
  const errors = validateSectionManifest(manifest, storyboard.slides, {
    requireAll: true,
  })
  if (errors.length) {
    console.error(`FAIL review sections\n${errors.map((e) => `  ${e}`).join('\n')}`)
    process.exit(1)
  }
  const section = sectionById(manifest, sectionId)
  if (!section) {
    console.error(`FAIL section ${sectionId} is not declared in ${sectionsPath}`)
    process.exit(1)
  }
  const byId = new Map(storyboard.slides.map((s) => [s.id, s]))
  const notApproved = section.slides.filter((id) => byId.get(id)?.status !== 'APPROVED')
  if (notApproved.length) {
    console.error(
      `FAIL section ${sectionId} has non-APPROVED slide(s): ${notApproved.join(', ')}`,
    )
    process.exit(1)
  }
  slides = section.slides.map((id) => byId.get(id))
}

const approved = slides
  .filter((s) => s.status === 'APPROVED')
  .map((s) => ({ id: s.id, title: s.title, objective: s.objective }))

if (!approved.length) {
  console.error('no APPROVED slides found')
  process.exit(1)
}

// stdout must be valid JSON: the workflow shell step uses output_format: json
console.log(JSON.stringify(approved))
