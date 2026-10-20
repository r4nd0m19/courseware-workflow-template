import fs from 'node:fs'
import YAML from 'yaml'
import Ajv from 'ajv'

export function readData(file) {
  const text = fs.readFileSync(file, 'utf8')
  if (/\.ya?ml$/i.test(file)) return YAML.parse(text)
  return JSON.parse(text)
}

export function loadSchema(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function validateWithSchema(schemaPath, data) {
  const ajv = new Ajv({ allErrors: true, strict: false })
  const validate = ajv.compile(loadSchema(schemaPath))
  const ok = validate(data)
  return {
    ok,
    errors: (validate.errors || []).map(
      (e) => `${e.instancePath || '/'} ${e.message}`,
    ),
  }
}

export function fail(title, errors) {
  console.error(`FAIL ${title}`)
  for (const e of errors) console.error(`  ${e}`)
  process.exitCode = 1
}

export function ok(title, extra = '') {
  console.log(`OK ${title}${extra ? ` — ${extra}` : ''}`)
}
