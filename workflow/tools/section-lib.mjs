import crypto from 'node:crypto'
import fs from 'node:fs'
import { readData } from './lib.mjs'

export function readSectionManifest(file) {
  const manifest = readData(file)
  if (!manifest || !Array.isArray(manifest.sections)) {
    throw new Error(`${file}: expected a top-level "sections" array`)
  }
  return manifest
}

export function sectionById(manifest, id) {
  return manifest.sections.find((s) => s.id === id) || null
}

export function validateSectionManifest(manifest, slides, options = {}) {
  const errors = []
  const active = slides.filter((s) => s.status !== 'SKIP')
  const order = new Map(active.map((s, i) => [s.id, i]))
  const seen = new Map()
  const ids = new Set()

  if (!manifest.sections.length) errors.push('no sections declared')
  if (manifest.schemaVersion && manifest.schemaVersion !== '1.0') {
    errors.push(`unsupported schemaVersion ${manifest.schemaVersion}`)
  }

  let previousEnd = -1
  manifest.sections.forEach((section, index) => {
    const where = `sections[${index}]`
    if (!section || typeof section !== 'object') {
      errors.push(`${where}: must be an object`)
      return
    }
    if (!/^[A-Za-z0-9_-]+$/.test(String(section.id || ''))) {
      errors.push(`${where}: id must match [A-Za-z0-9_-]+`)
    } else if (ids.has(section.id)) {
      errors.push(`${where}: duplicate id ${section.id}`)
    } else {
      ids.add(section.id)
    }
    if (!String(section.title || '').trim()) {
      errors.push(`${where}: title is required`)
    }
    if (!Array.isArray(section.slides) || !section.slides.length) {
      errors.push(`${where}: slides must be a non-empty array`)
      return
    }
    // Human review happens after each rendered page, so every section is exactly
    // one page. Grouping several slides into one section would silently skip the
    // per-page review-page gate and freeze them under a single approval.
    if (section.slides.length !== 1) {
      errors.push(
        `${where}: human review is per page; exactly one slide per section is required (got ${section.slides.length}: ${section.slides.join(', ')})`,
      )
    }
    const positions = []
    for (const id of section.slides) {
      if (typeof id !== 'string' || !id.trim()) {
        errors.push(`${where}: slide ids must be non-empty strings`)
        continue
      }
      if (seen.has(id)) {
        errors.push(`slide ${id} appears in sections ${seen.get(id)} and ${section.id}`)
      } else {
        seen.set(id, section.id)
      }
      if (!order.has(id)) {
        const slide = slides.find((s) => s.id === id)
        errors.push(
          slide
            ? `slide ${id} is SKIP and cannot be reviewed in a section`
            : `slide ${id} does not exist in the storyboard`,
        )
      } else {
        positions.push(order.get(id))
      }
    }
    if (positions.length === section.slides.length) {
      for (let i = 1; i < positions.length; i += 1) {
        if (positions[i] <= positions[i - 1]) {
          errors.push(`${where}: slides must follow storyboard order`)
          break
        }
      }
      if (positions[0] <= previousEnd) {
        errors.push(`${where}: sections must be contiguous and ordered`)
      }
      previousEnd = positions[positions.length - 1]
    }
  })

  if (options.requireAll !== false) {
    for (const slide of active) {
      if (!seen.has(slide.id)) errors.push(`slide ${slide.id} is not assigned to a section`)
    }
    if (seen.size !== active.length) {
      errors.push(`section manifest covers ${seen.size}/${active.length} non-SKIP slides`)
    }
  }

  if (options.requireApproved) {
    for (const slide of active) {
      if (slide.status !== 'APPROVED') {
        errors.push(`slide ${slide.id} is ${slide.status}; the script is not APPROVED`)
      }
    }
  }

  return errors
}

export function sectionPayload(section, slides) {
  const active = slides.filter((s) => s.status !== 'SKIP')
  const positions = section.slides.map((id) => active.findIndex((s) => s.id === id))
  if (positions.some((i) => i < 0)) {
    throw new Error(`section ${section.id} references a missing or SKIP slide`)
  }
  return {
    id: section.id,
    title: section.title,
    slides: [...section.slides],
    start: Math.min(...positions),
    count: section.slides.length,
  }
}

export function readApprovals(file) {
  if (!fs.existsSync(file)) {
    return { schemaVersion: '1.0', sections: {} }
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!data.sections || typeof data.sections !== 'object') data.sections = {}
  return data
}

export function writeApprovals(file, data) {
  fs.mkdirSync(requireDir(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}

function requireDir(file) {
  const parts = file.split('/')
  parts.pop()
  return parts.join('/') || '.'
}

export function slideScriptHash(slide) {
  const snapshot = {
    id: slide.id,
    headingTitle: slide.headingTitle,
    objectiveLine: slide.objectiveLine || '',
    contentLine: slide.contentLine || '',
    purposeLine: slide.purposeLine || '',
    screenContent: slide.screenContent || '',
    interactionDesign: slide.interactionDesign || '',
    narration: slide.narration || '',
    transition: slide.transition || '',
    machine: slide.machine || null,
    unknownSections: slide.unknownSections || [],
  }
  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

export function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function approvalProblems(approvals, manifest, scriptSlides, options = {}) {
  const problems = []
  const byId = new Map(scriptSlides.map((s) => [s.id, s]))
  const sectionIds = new Set(manifest.sections.map((s) => s.id))

  for (const [sectionId, approval] of Object.entries(approvals.sections)) {
    if (!sectionIds.has(sectionId)) {
      problems.push(`approval for unknown section ${sectionId}`)
      continue
    }
    for (const [slideId, frozen] of Object.entries(approval.slides || {})) {
      const slide = byId.get(slideId)
      if (!slide) {
        problems.push(`section ${sectionId}: approved slide ${slideId} no longer exists`)
        continue
      }
      const current = slideScriptHash(slide)
      if (current !== frozen.scriptHash) {
        problems.push(
          `section ${sectionId}: slide ${slideId} changed after approval (script hash mismatch)`,
        )
      }
      if (options.screenshots && frozen.screenshot) {
        const currentShot = `${options.screenshots}/${slideId}.png`
        if (!fs.existsSync(currentShot)) {
          problems.push(`section ${sectionId}: approved screenshot missing for ${slideId}`)
        }
      }
    }
  }

  if (options.requireAll) {
    for (const section of manifest.sections) {
      if (!approvals.sections[section.id]) {
        problems.push(`section ${section.id} has no rendered review approval`)
      }
    }
  }

  return problems
}
