// Run: node tests/transpile.js && node --test tests/
// The fallback category to boundary map used when no lookup table is configured.
const test = require('node:test')
const assert = require('node:assert/strict')
const { CATEGORY_BOUNDARY_MAP } = require('./build/runtime/lib/categoryBoundaries.js')

test('utility categories need their own service boundary', () => {
  assert.equal(CATEGORY_BOUNDARY_MAP[1], 'WATER_DIST')
  assert.equal(CATEGORY_BOUNDARY_MAP[2], 'SEWER_DIST')
})

test('every other listed category needs the city limits, Other is accepted anywhere', () => {
  for (const code of [3, 4, 5, 6, 7, 8, 9, 10, 11, 13]) assert.equal(CATEGORY_BOUNDARY_MAP[code], 'CITY_LIMITS', `code ${code}`)
  assert.equal(CATEGORY_BOUNDARY_MAP[12], null)
})

test('an unknown category code has no entry, so the caller treats it as unrestricted', () => {
  assert.equal(CATEGORY_BOUNDARY_MAP[99], undefined)
  assert.equal(Object.keys(CATEGORY_BOUNDARY_MAP).length, 13)
  for (const val of Object.values(CATEGORY_BOUNDARY_MAP)) assert.ok(val === null || typeof val === 'string')
})
