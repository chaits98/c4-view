/**
 * The schema is a promise to editors and to other tools. A promise that drifts from the parser is
 * worse than none, so every fixture and example must validate against it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
// the model schema declares draft 2020-12; ajv's default export is draft-07 and would reject it
import { Ajv2020 } from 'ajv/dist/2020.js'

const ROOT = new URL('..', import.meta.url).pathname
const schema = JSON.parse(readFileSync(join(ROOT, 'schema.json'), 'utf8'))
const ajv = new Ajv2020({ allErrors: true, strict: false } as never)
const validate = ajv.compile(schema)

const files = [
  ...readdirSync(join(ROOT, 'fixtures')).filter((f) => f.endsWith('.json')).map((f) => join('fixtures', f)),
  ...readdirSync(join(ROOT, 'examples')).filter((f) => f.endsWith('.json')).map((f) => join('examples', f)),
  join('docs', 'c4', 'c4-view.json'),
]

for (const file of files) {
  test(`${file} validates against schema.json`, () => {
    const model = JSON.parse(readFileSync(join(ROOT, file), 'utf8'))
    assert.ok(validate(model), `${file}: ${ajv.errorsText(validate.errors, { separator: '\n  ' })}`)
  })
}
