// Run: node tests/transpile.js && node --test tests/
// Profanity filter, the pure parts: leet normalizer, matcher, and the false-positive
// list that earlier releases confirmed safe (the given name Dick, Scunthorpe, and so on).
const test = require('node:test')
const assert = require('node:assert/strict')
const pf = require('./build/runtime/lib/profanity.js')

test('normalizeLeet lowercases, strips accents and maps leet characters', () => {
  assert.equal(pf.normalizeLeet('Cabrón COÑO chingón'), 'cabron cono chingon')
  assert.equal(pf.normalizeLeet('@ 3 1 ! 0 $ 5'), 'a e i i o s s')
  assert.equal(pf.normalizeLeet('verga'), 'uerga', 'v maps to u so fvck style evasion is caught')
  assert.equal(pf.normalizeLeet(''), '')
})

test('blocks plain profanity and leet-speak evasion', () => {
  const blocked = [
    'what the fuck', 'F U C K'.replace(/ /g, ''), 'fvck this', 'sh1t everywhere', 'horseshit', 'bullsh!t',
    'you asshole', 'dumbass driver', 'this is bullshit', 'b!tch', 'goddamn pothole', 'wtf', 'dickhead',
    'stupid retard', 'wanker', 'bollocks'
  ]
  for (const s of blocked) assert.equal(pf.containsProfanity(s), true, s)
})

test('blocks Spanish profanity, with and without accents', () => {
  for (const s of ['chinga tu madre', 'pinche chingón', 'eres un pendejo', 'cabrón', 'que mierda', 'hijo de puta', 'hijoputa', 'gilipollas', 'me vale verga']) {
    assert.equal(pf.containsProfanity(s), true, s)
  }
})

test('blocks the middle finger emoji in every skin tone', () => {
  for (const e of ['\u{1F595}', '\u{1F595}\u{1F3FB}', '\u{1F595}\u{1F3FD}', '\u{1F595}\u{1F3FF}']) {
    assert.equal(pf.containsProfanity('pothole ' + e), true, JSON.stringify(e))
  }
})

test('catches concatenated runs of eleven or more letters', () => {
  assert.equal(pf.containsProfanity('fuckmyballs'), true)
  assert.equal(pf.containsProfanity('thisisbullshitright'), true)
  assert.equal(pf.containsProfanity('youaretotallyawanker'), true)
})

test('keeps legitimate words and names', () => {
  const safe = [
    '', 'The class was full', 'grassland near the pass', 'harassment of a mass', 'Scunthorpe United',
    'cockroaches in the alley', 'a bass in the canal', 'Dick Smith reported it', "Dick's house", 'Dickens Street',
    'Dickinson Avenue', 'raccoon in the bin', 'Pakistan Avenue', 'spice shop', 'hospice entrance',
    'putativo', 'icono', 'vehiculo', 'ampolla', 'bullock', 'assist me please', 'passage blocked',
    'water main break on 7th', 'Hello world', 'classic car show'
  ]
  for (const s of safe) assert.equal(pf.containsProfanity(s), false, JSON.stringify(s))
})

test('does not modify its input', () => {
  const input = 'Cabrón street'
  pf.containsProfanity(input)
  assert.equal(input, 'Cabrón street')
})
