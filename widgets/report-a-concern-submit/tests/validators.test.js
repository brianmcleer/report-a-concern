// Run: node tests/transpile.js && node --test tests/
// Contact field validators, the pure parts: email syntax, reserved domains, phone digits.
const test = require('node:test')
const assert = require('node:assert/strict')
const v = require('./build/runtime/lib/validators.js')

test('accepts ordinary email addresses', () => {
  for (const ok of ['jane@gmail.com', 'first.last+tag@sub.example-corp.org', 'a@b.co', 'USER_1%x@mail.museum']) {
    assert.equal(v.isValidEmail(ok), true, ok)
  }
  assert.equal(v.isValidEmail('  padded@mail.com  '), true, 'leading and trailing spaces are trimmed')
})

test('rejects malformed email addresses', () => {
  const bad = [
    '', 'plain', '@no-local.com', 'no-at.com', 'two@@at.com',
    'double..dot@mail.com', 'user@-hyphen.com', 'user@hyphen-.com',
    'user@mail.c', 'user@mail.123', 'user@mail', '"quoted"@mail.com',
    'user@[192.168.1.1]', 'a'.repeat(65) + '@mail.com', 'user@' + 'a'.repeat(64) + '.com',
    'user@mail.com.' , 'user name@mail.com'
  ]
  for (const b of bad) assert.equal(v.isValidEmail(b), false, JSON.stringify(b))
  const long = 'x@' + ['a', 'b', 'c', 'd', 'e'].map((ch) => ch.repeat(60)).join('.') + '.com'
  assert.ok(long.length > 254)
  assert.equal(v.isValidEmail(long), false, 'over 254 characters')
})

test('rejects RFC 2606 and 6761 reserved domains, keeps real ones', () => {
  for (const d of ['example.com', 'example.net', 'example.org', 'mail.example.com', 'foo.test', 'a.b.invalid', 'host.localhost', 'printer.local', 'x.example']) {
    assert.equal(v.isReservedEmailDomain(d), true, d)
    assert.equal(v.isValidEmail('someone@' + d), false, 'someone@' + d)
  }
  for (const d of ['gmail.com', 'test-corp.org', 'examples.com', 'myexample.com', 'localhosting.net', 'local.gov']) {
    assert.equal(v.isReservedEmailDomain(d), false, d)
  }
  assert.equal(v.isReservedEmailDomain('EXAMPLE.COM'), true, 'case does not matter')
})

test('phone: strip to digits and require exactly ten', () => {
  assert.equal(v.stripPhoneDigits('(970) 555-0123'), '9705550123')
  assert.equal(v.stripPhoneDigits('970.555.0123 ext'), '9705550123')
  assert.equal(v.stripPhoneDigits(''), '')
  assert.equal(v.PHONE_DIGITS_RE.test(v.stripPhoneDigits('(970) 555-0123')), true)
  assert.equal(v.PHONE_DIGITS_RE.test(v.stripPhoneDigits('+1 970 555 0123')), false, 'eleven digits with country code')
  assert.equal(v.PHONE_DIGITS_RE.test(v.stripPhoneDigits('555-0123')), false, 'seven digits')
})
