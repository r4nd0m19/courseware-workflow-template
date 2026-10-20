import fs from 'node:fs'
import path from 'node:path'
import { readData, validateWithSchema } from './lib.mjs'

const PACKAGE_SCHEMA = new URL('../schemas/component-package.schema.json', import.meta.url).pathname
const REGISTRY_SCHEMA = new URL('../schemas/component-registry.schema.json', import.meta.url).pathname

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

export function isSafeRelative(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]/).includes('..')
  )
}

export function resolveInside(base, relative) {
  if (!isSafeRelative(relative)) {
    throw new Error(`unsafe path "${relative}" (must be relative, no ..)`)
  }
  const resolved = path.resolve(base, relative)
  const root = path.resolve(base)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`path "${relative}" escapes ${base}`)
  }
  return resolved
}

export function semverParts(version) {
  const m = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!m) throw new Error(`invalid semver "${version}"`)
  return m.slice(1).map(Number)
}

export function compareSemver(a, b) {
  const pa = semverParts(a)
  const pb = semverParts(b)
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

export function bumpSemver(version, kind = 'patch') {
  const [major, minor, patch] = semverParts(version)
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

function* walkStrings(value) {
  if (typeof value === 'string') yield value
  else if (Array.isArray(value)) {
    for (const v of value) yield* walkStrings(v)
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) yield* walkStrings(v)
  }
}

function hasPlaceholderText(value) {
  const s = String(value || '').toLowerCase()
  return ['todo', 'tbd', '待补', '待定', '[needs clarification]', '???', 'lorem ipsum', 'placeholder'].some(
    (p) => s.includes(p),
  )
}

export function inspectPackage(packageDir, { projectRoot = '' } = {}) {
  const errors = []
  const warnings = []
  const manifestPath = path.join(packageDir, 'component.json')
  if (!fs.existsSync(manifestPath)) {
    return { errors: [`${manifestPath} not found`], warnings, manifest: null }
  }
  let manifest
  try {
    manifest = readJson(manifestPath)
  } catch (err) {
    return { errors: [`${manifestPath}: ${err.message}`], warnings, manifest: null }
  }
  const schemaCheck = validateWithSchema(PACKAGE_SCHEMA, manifest)
  for (const e of schemaCheck.errors) errors.push(`component.json ${e}`)
  if (errors.length) return { errors, warnings, manifest }

  for (const s of walkStrings(manifest)) {
    if (hasPlaceholderText(s)) {
      errors.push(`component.json contains a placeholder string: "${s.slice(0, 80)}"`)
      break
    }
  }

  if (manifest.propsSchema?.additionalProperties !== false) {
    errors.push('propsSchema must set additionalProperties=false (unknown props are a hard error)')
  }

  const fidelityKind = manifest.sourceFidelity?.kind
  const provenanceType = manifest.provenance?.type
  if (fidelityKind === 'reference-verbatim') {
    if (provenanceType !== 'reference-verbatim') {
      errors.push('sourceFidelity.kind=reference-verbatim requires provenance.type=reference-verbatim')
    }
    if (!(manifest.sourceFidelity.sourceRefs || []).length) {
      errors.push('reference-verbatim component needs sourceFidelity.sourceRefs (reference files/hashes)')
    }
  } else if (fidelityKind === 'generated' && provenanceType === 'reference-verbatim') {
    errors.push('provenance.type=reference-verbatim requires sourceFidelity.kind=reference-verbatim')
  }

  for (const [label, value, many] of [
    ['implementation', manifest.implementation, false],
    ['stories', manifest.stories, true],
    ['tests', manifest.tests, true],
    ['baselines', manifest.baselines, true],
  ]) {
    const list = many ? value : [value]
    for (const rel of list) {
      try {
        const abs = resolveInside(packageDir, rel)
        if (!fs.existsSync(abs)) errors.push(`${label} file not found: ${rel}`)
      } catch (err) {
        errors.push(`${label}: ${err.message}`)
      }
    }
  }

  const needsTransitions =
    manifest.category === 'interactive' ||
    (manifest.interactionLevels || []).some((l) => l !== 'watch')
  if (needsTransitions && (manifest.interactionModel?.transitions || []).length === 0) {
    errors.push('interactive component needs at least one interactionModel transition')
  }
  const stateSet = new Set(manifest.interactionModel?.states || [])
  for (const [i, t] of (manifest.interactionModel?.transitions || []).entries()) {
    for (const side of ['from', 'to']) {
      if (!stateSet.has(t[side])) {
        warnings.push(`transition ${i + 1} references state "${t[side]}" not listed in interactionModel.states`)
      }
    }
  }

  if (!manifest.fallback?.description?.trim()) {
    errors.push('fallback.description is required')
  }

  if (manifest.provenance?.type === 'generated') {
    if (!manifest.provenance.brief?.trim()) {
      errors.push('generated component needs provenance.brief')
    } else if (projectRoot && isSafeRelative(manifest.provenance.brief)) {
      const brief = path.resolve(projectRoot, manifest.provenance.brief)
      if (!fs.existsSync(brief)) {
        errors.push(`provenance.brief not found: ${manifest.provenance.brief}`)
      }
    }
  }

  if (manifest.status === 'deprecated' && (manifest.usedBy || []).length > 0) {
    warnings.push(`deprecated component still used by: ${manifest.usedBy.join(', ')}`)
  }

  return { errors, warnings, manifest, manifestPath }
}

export function loadRegistry(indexPath, { stylePackPath = '' } = {}) {
  const absolute = path.resolve(indexPath)
  if (!fs.existsSync(absolute)) throw new Error(`registry not found: ${absolute}`)
  const index = readData(absolute)
  const schemaCheck = validateWithSchema(REGISTRY_SCHEMA, index)
  if (!schemaCheck.ok) {
    throw new Error(`registry schema: ${schemaCheck.errors.join('; ')}`)
  }
  const registryDir = path.dirname(absolute)
  const seen = new Set()
  for (const entry of index.components || []) {
    if (seen.has(entry.id)) throw new Error(`duplicate component id in registry: ${entry.id}`)
    seen.add(entry.id)
    const packageDir = resolveInside(registryDir, entry.package)
    if (!fs.existsSync(packageDir)) {
      throw new Error(`component ${entry.id}: package not found at ${entry.package}`)
    }
  }
  if (stylePackPath) {
    const style = readData(stylePackPath)
    if (
      index.stylePack &&
      style.id &&
      (index.stylePack.id !== style.id || index.stylePack.version !== (style.version || ''))
    ) {
      throw new Error(
        `registry targets style pack ${index.stylePack.id}@${index.stylePack.version}, but style pack is ${style.id}@${style.version || '(no version)'}`,
      )
    }
  }
  return { index, registryDir, path: absolute }
}

export function loadRegistryPackages(indexPath, options = {}) {
  const loaded = loadRegistry(indexPath, options)
  const packages = loaded.index.components.map((entry) => {
    const packageDir = resolveInside(loaded.registryDir, entry.package)
    const inspected = inspectPackage(packageDir, options)
    return { entry, packageDir, ...inspected }
  })
  return { ...loaded, packages }
}

export function copyDirFiltered(source, dest) {
  fs.mkdirSync(dest, { recursive: true })
  fs.cpSync(source, dest, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(source, src)
      const parts = rel.split(path.sep)
      return !parts.includes('node_modules') && !parts.includes('.git') && !parts.includes('staging')
    },
  })
}

export function registerPackage({
  registryPath,
  packageDir,
  lesson = '',
  approvedBy = '',
  update = false,
  dryRun = false,
  projectRoot = '',
}) {
  const inspected = inspectPackage(packageDir, { projectRoot })
  if (inspected.errors.length) {
    throw new Error(`component package invalid:\n  ${inspected.errors.join('\n  ')}`)
  }
  const manifest = inspected.manifest
  const loaded = loadRegistry(registryPath)
  const existing = loaded.index.components.find((c) => c.id === manifest.id)
  if (existing && !update) {
    throw new Error(`component ${manifest.id} already registered (use --update to replace)`)
  }
  if (existing && compareSemver(manifest.version, existing.version) <= 0) {
    throw new Error(
      `component ${manifest.id} version ${manifest.version} must be greater than registered ${existing.version}`,
    )
  }

  const destDir = path.join(loaded.registryDir, 'components', manifest.id)
  const nextManifest = JSON.parse(JSON.stringify(manifest))
  if (lesson && !nextManifest.usedBy.includes(lesson)) nextManifest.usedBy.push(lesson)
  if (approvedBy) {
    nextManifest.provenance.approvedBy = approvedBy
    nextManifest.provenance.approvedAt = new Date().toISOString()
  }

  const entry = {
    id: manifest.id,
    version: manifest.version,
    status: manifest.status,
    package: `components/${manifest.id}`,
  }
  const nextIndex = JSON.parse(JSON.stringify(loaded.index))
  if (existing) {
    nextIndex.components = nextIndex.components.map((c) => (c.id === manifest.id ? entry : c))
    nextIndex.version = bumpSemver(nextIndex.version, 'patch')
  } else {
    nextIndex.components.push(entry)
    nextIndex.components.sort((a, b) => a.id.localeCompare(b.id))
    nextIndex.version = bumpSemver(nextIndex.version, 'minor')
  }

  if (!dryRun) {
    if (path.resolve(destDir) !== path.resolve(packageDir)) {
      fs.rmSync(destDir, { recursive: true, force: true })
      copyDirFiltered(packageDir, destDir)
    }
    writeJsonAtomic(path.join(destDir, 'component.json'), nextManifest)
    writeJsonAtomic(loaded.path, nextIndex)
  }

  return {
    id: manifest.id,
    version: manifest.version,
    registryVersion: nextIndex.version,
    package: entry.package,
    updated: Boolean(existing),
    dryRun,
  }
}

export function ensureRegistry(indexPath, stylePath) {
  const absolute = path.resolve(indexPath)
  if (fs.existsSync(absolute)) {
    return { created: false, ...loadRegistry(absolute, { stylePackPath: stylePath }) }
  }
  const style = readData(stylePath)
  const index = {
    schemaVersion: '1.0',
    registryId: style.id || 'courseware',
    version: '0.0.0',
    stylePack: {
      id: style.id || 'courseware',
      version: style.version || '0.0.0',
    },
    components: [],
  }
  const schemaCheck = validateWithSchema(REGISTRY_SCHEMA, index)
  if (!schemaCheck.ok) throw new Error(schemaCheck.errors.join('; '))
  writeJsonAtomic(absolute, index)
  return { created: true, index, registryDir: path.dirname(absolute), path: absolute }
}

export function recordComponentUsage({ registryPath, storyboardPath, lesson }) {
  const loaded = loadRegistry(registryPath)
  const storyboard = readData(storyboardPath)
  const used = new Set(
    (storyboard.slides || [])
      .filter((s) => s.status !== 'SKIP')
      .flatMap((s) => s.components || []),
  )
  const changes = []
  for (const entry of loaded.index.components) {
    if (!used.has(entry.id)) continue
    const packageDir = resolveInside(loaded.registryDir, entry.package)
    const manifestPath = path.join(packageDir, 'component.json')
    const manifest = readJson(manifestPath)
    if (!Array.isArray(manifest.usedBy)) manifest.usedBy = []
    if (manifest.usedBy.includes(lesson)) continue
    manifest.usedBy.push(lesson)
    writeJsonAtomic(manifestPath, manifest)
    changes.push(entry.id)
  }
  if (changes.length) {
    loaded.index.version = bumpSemver(loaded.index.version, 'patch')
    writeJsonAtomic(loaded.path, loaded.index)
  }
  return { changes, registryVersion: loaded.index.version }
}
