// Run: node tests/transpile.js && node --test tests/
// Coded value labels and the filter toggle helper (src/runtime/lib/labels.ts).
const test = require('node:test')
const assert = require('node:assert/strict')
const l = require('./build/runtime/lib/labels.js')

test('status, priority and category tables match the Tickets layer domains', () => {
  assert.deepEqual(Object.values(l.S), ['Open', 'Received', 'In Progress', 'Resolved', 'Closed'])
  assert.deepEqual(Object.values(l.P), ['Low', 'Medium', 'High', 'Critical'])
  assert.equal(Object.keys(l.C).length, 13)
  assert.equal(l.C[1], 'Water')
  assert.equal(l.C[13], 'Code Enforcement')
  assert.deepEqual(Object.keys(l.CT), ['INTERNAL', 'STATUS', 'ASSIGN', 'PUBLIC'])
})

test('label helpers fall back to Unknown for codes outside the domain', () => {
  assert.equal(l.statusLabel(4), 'Resolved')
  assert.equal(l.statusLabel(9), 'Unknown')
  assert.equal(l.statusLabel(null), 'Unknown')
  assert.equal(l.statusLabel(undefined), 'Unknown')
  assert.equal(l.priorityLabel(4), 'Critical')
  assert.equal(l.priorityLabel(0), 'Unknown')
  assert.equal(l.categoryLabel(3), 'Roads & Pavement')
  assert.equal(l.categoryLabel(99), 'Unknown')
})

test('toggleVal adds a missing value and removes a present one without mutating', () => {
  const a = [1, 3]
  assert.deepEqual(l.toggleVal(a, 2), [1, 3, 2])
  assert.deepEqual(l.toggleVal(a, 3), [1])
  assert.deepEqual(a, [1, 3])
  assert.deepEqual(l.toggleVal([], 5), [5])
})
