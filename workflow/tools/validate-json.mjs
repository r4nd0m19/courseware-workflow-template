import { readData, validateWithSchema, fail, ok } from './lib.mjs'

const [schemaPath, dataPath] = process.argv.slice(2)
if (!schemaPath || !dataPath) {
  console.error('usage: node validate-json.mjs <schema.json> <data.json|data.yml>')
  process.exit(2)
}

const data = readData(dataPath)
const { ok: valid, errors } = validateWithSchema(schemaPath, data)
if (!valid) fail(`${dataPath} vs ${schemaPath}`, errors)
else ok(`${dataPath}`, `schema ${schemaPath}`)
