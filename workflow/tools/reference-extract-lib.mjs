import fs from 'node:fs'
import path from 'node:path'

// Reference extraction manifests live next to the approved script:
//   specs/<lesson>/reference-extracts/<component-id>.json
// Keeping this convention in one place lets list/build tooling agree without
// adding a second declaration to courseware.md.
export function referenceExtractDir(scriptPath) {
  return path.join(path.dirname(path.resolve(scriptPath)), 'reference-extracts')
}

export function findReferenceExtract(scriptPath, componentId) {
  if (!scriptPath || !componentId) return ''
  const file = path.join(referenceExtractDir(scriptPath), `${componentId}.json`)
  return fs.existsSync(file) ? file : ''
}

export function relativeReferenceExtract(scriptPath, componentId) {
  const file = findReferenceExtract(scriptPath, componentId)
  return file ? path.relative(process.cwd(), file).split(path.sep).join('/') : ''
}
