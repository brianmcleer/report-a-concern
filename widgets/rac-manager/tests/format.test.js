// Run: node tests/transpile.js && node --test tests/
// Date formatters and the table name matcher (src/runtime/lib/format.ts).
const test = require('node:test')
const assert = require('node:assert/strict')
const f = require('./build/runtime/lib/format.js')

const MIN = 60000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

test('fmt and fmtDay: empty epoch gives an em dash placeholder, otherwise en-US text', () => {
  assert.equal(f.fmt(0), '\u2014')
  assert.equal(f.fmtDay(0), '\u2014')
  const e = new Date(2026, 8, 25, 14, 5).getTime()
  assert.equal(f.fmtDay(e), 'Sep 25, 2026')
  const full = f.fmt(e)
  assert.ok(full.startsWith('Sep 25, 2026'), full)
  assert.ok(/02:05/.test(full), full)
})

test('ago: minutes, hours, then the full date', () => {
  const now = Date.now()
  assert.equal(f.ago(0), '')
  assert.equal(f.ago(now - 5 * MIN), '5m ago')
  assert.equal(f.ago(now - 3 * HOUR), '3h ago')
  assert.equal(f.ago(now - 2 * DAY), f.fmt(now - 2 * DAY))
})

test('agoFull: spoken form for aria labels, days up to a month', () => {
  const now = Date.now()
  assert.equal(f.agoFull(0), '')
  assert.equal(f.agoFull(now - 5 * MIN), '5 minutes ago')
  assert.equal(f.agoFull(now - 3 * HOUR), '3 hours ago')
  assert.equal(f.agoFull(now - 2 * DAY), '2 days ago')
  assert.equal(f.agoFull(now - 40 * DAY), f.fmt(now - 40 * DAY))
})

test('agoDate: short form, then a long date for table cells', () => {
  const now = Date.now()
  assert.equal(f.agoDate(0), '')
  assert.equal(f.agoDate(now - 59 * MIN), '59m ago')
  assert.equal(f.agoDate(now - 23 * HOUR), '23h ago')
  const e = new Date(2026, 0, 3).getTime()
  assert.equal(f.agoDate(e), 'January 3, 2026')
})

test('ymd: local YYYY-MM-DD with zero padding, today when omitted', () => {
  assert.equal(f.ymd(new Date(2026, 0, 3, 23, 59).getTime()), '2026-01-03')
  assert.equal(f.ymd(new Date(2026, 11, 31).getTime()), '2026-12-31')
  const d = new Date()
  assert.equal(f.ymd(), `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
})

test('matchAll and nameTokens: every token must appear, underscores count as spaces, case folded', () => {
  assert.deepEqual(f.nameTokens('Ticket_Comments'), ['ticket', 'comments'])
  assert.deepEqual(f.nameTokens('Survey  Responses'), ['survey', 'responses'])
  assert.equal(f.matchAll('DBO.Ticket_Comments', f.nameTokens('Ticket_Comments')), true)
  assert.equal(f.matchAll('Ticket Comments (staff)', ['ticket', 'comments']), true)
  assert.equal(f.matchAll('Tickets', ['ticket', 'comments']), false)
  assert.equal(f.matchAll('', ['ticket']), false)
  assert.equal(f.matchAll('anything', []), true)
})
