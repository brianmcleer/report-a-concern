// Run: node tests/transpile.js && node --test tests/
// Help guide content rules (handoff Section 10.8 and 10.9).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { buildHelpSections } = require('./build/runtime/helpSections.js')
const messages = require('./build/runtime/translations/default.js').default

const t = (id, values) => {
  assert.ok(id in messages, `missing translation ${id}`)
  let s = String(messages[id])
  if (values) for (const k of Object.keys(values)) s = s.split(`{${k}}`).join(values[k])
  return s
}
const FLAGS = ['mapConnected', 'comments', 'survey', 'sidebar']
const ALL_ON = Object.fromEntries(FLAGS.map(k => [k, true]))
const ALL_OFF = Object.fromEntries(FLAGS.map(k => [k, false]))
const flat = (secs) => secs.map(s => [s.title, s.intro || '', ...s.body].join('\n')).join('\n')
const widgetSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime', 'widget.tsx'), 'utf8')

test('every string resolves and no token is left unfilled', () => {
  for (const flags of [ALL_ON, ALL_OFF]) {
    const text = flat(buildHelpSections(t, flags))
    assert.ok(!/\{\w+\}/.test(text), 'unfilled token')
    assert.ok(!/\bhelp[A-Z]\w+/.test(text), 'raw key leaked')
  }
})

test('section order, unique keys, distinct icons, only start is ordered', () => {
  const secs = buildHelpSections(t, ALL_ON)
  assert.deepEqual(secs.map(s => s.key), ['start', 'find', 'views', 'edit', 'comments', 'photos', 'survey', 'export', 'keep', 'trouble', 'tips'])
  assert.equal(new Set(secs.map(s => s.icon)).size, secs.length)
  assert.deepEqual(secs.filter(s => s.ordered).map(s => s.key), ['start'])
  assert.equal(secs[0].body.length, 3)
  assert.deepEqual(buildHelpSections(t, ALL_OFF).map(s => s.key), ['start', 'find', 'views', 'edit', 'photos', 'export', 'keep', 'trouble', 'tips'])
  for (const s of secs) assert.ok(s.body.length > 0, `empty section ${s.key}`)
})

test('feature gating in both directions, one flag at a time', () => {
  const offText = flat(buildHelpSections(t, ALL_OFF))
  for (const word of ['on the map', 'Map extent', 'lights up', 'Has Comments keeps', 'Has Survey keeps', 'Has Photos keeps', 'fewest comments', 'survey answered', 'speech bubble', 'a star when', 'Leave a note', 'Survey tab shows', 'Comments sheet', 'Surveys sheet', 'side panel', 'photo did not']) {
    assert.ok(!offText.includes(word), `${word} present with flags off`)
  }
  const cases = [
    ['mapConnected', 'on the map'], ['mapConnected', 'Map extent'], ['mapConnected', 'lights up'],
    ['comments', 'Has Comments keeps'], ['comments', 'fewest comments'], ['comments', 'speech bubble'], ['comments', 'Leave a note'], ['comments', 'Comments sheet'], ['comments', 'Has Photos keeps'], ['comments', 'photo did not'],
    ['survey', 'Has Survey keeps'], ['survey', 'survey answered'], ['survey', 'a star when'], ['survey', 'Survey tab shows'], ['survey', 'Surveys sheet'], ['survey', 'Has Photos keeps'],
    ['sidebar', 'side panel']
  ]
  for (const [flag, word] of cases) {
    const on = flat(buildHelpSections(t, { ...ALL_OFF, [flag]: true }))
    assert.ok(on.includes(word), `${word} missing with ${flag} on`)
    const off = flat(buildHelpSections(t, { ...ALL_ON, [flag]: false }))
    if (word !== 'Has Photos keeps') assert.ok(!off.includes(word), `${word} present with ${flag} off`)
  }
  // The badge filter row exists when either table was found, so Has Photos stays while one is on.
  assert.ok(flat(buildHelpSections(t, { ...ALL_ON, comments: false })).includes('Has Photos keeps'))
  assert.ok(flat(buildHelpSections(t, { ...ALL_ON, survey: false })).includes('Has Photos keeps'))
  // Start step one changes shape with the map rather than gaining a line.
  assert.equal(buildHelpSections(t, ALL_OFF)[0].body.length, 3)
  assert.equal(buildHelpSections(t, ALL_ON)[0].body.length, 3)
  // Sections that need a table are dropped whole, not left empty.
  assert.ok(!buildHelpSections(t, { ...ALL_ON, comments: false }).some(s => s.key === 'comments'))
  assert.ok(!buildHelpSections(t, { ...ALL_ON, survey: false }).some(s => s.key === 'survey'))
})

test('listOf builds a, a and b, a, b and c', () => {
  const one = flat(buildHelpSections(t, ALL_OFF))
  assert.ok(one.includes('Badges on a card or in the Activity column: a camera with the number of pictures.'))
  const two = flat(buildHelpSections(t, { ...ALL_OFF, comments: true }))
  assert.ok(two.includes('a speech bubble with the number of comments and a camera with the number of pictures.'))
  const three = flat(buildHelpSections(t, ALL_ON))
  assert.ok(three.includes('a speech bubble with the number of comments, a camera with the number of pictures and a star when a survey answer exists.'))
  assert.ok(three.includes('newest first, oldest first, priority, status, category, most or fewest comments and survey answered first or last.'))
})

test('writing rules: no dashes, no jargon, troubleshooting shape, contact line last', () => {
  const secs = buildHelpSections(t, ALL_ON)
  const text = flat(secs)
  assert.ok(!/[\u2013\u2014]/.test(text), 'em or en dash in guide')
  for (const word of ['instance', 'session', 'persist', 'sync', 'toggle', 'modal']) assert.ok(!new RegExp(`\\b${word}\\b`, 'i').test(text), `jargon: ${word}`)
  const trouble = secs.find(s => s.key === 'trouble')
  const lines = trouble.body
  assert.equal(lines[lines.length - 1], 'Still stuck? Contact the GIS Division and mention the RAC Ticket Manager name and this app.')
  for (const l of lines.slice(0, -1)) { assert.ok(l.includes(':'), `no colon: ${l}`); assert.ok(/\.$/.test(l), `no full stop: ${l}`) }
  assert.equal(secs[secs.length - 2].key, 'trouble')
  assert.equal(secs[secs.length - 1].key, 'tips')
  assert.equal(messages.helpTitle, 'Help')
  assert.equal(messages.close, 'Close')
  assert.match(messages.helpSearchPlaceholder, /^Search the guide \(try ".+" or ".+"\)$/)
  assert.equal(messages.helpNoMatches, 'Nothing in the guide matches that word. Try another, or open the sections above.')
  assert.equal(messages.helpAnd, 'and')
  assert.equal(messages.firstRunTitle, 'New here?')
  assert.equal(messages.firstRunHelpLink, 'Open the guide.')
  assert.equal(messages.firstRunBody.split('. ').length, 1)
  assert.equal(messages.helpIntro.split('. ').length, 1)
  for (const k of Object.keys(messages)) assert.ok(!/[\u2013\u2014]/.test(String(messages[k])), `dash in ${k}`)
})

test('control names in the guide match the interface exactly', () => {
  const text = flat(buildHelpSections(t, ALL_ON))
  const ctl = Object.keys(messages).filter(k => k.startsWith('ctl'))
  assert.ok(ctl.length >= 20)
  for (const key of ctl) {
    const name = messages[key]
    assert.ok(text.includes(name), `control ${name} (${key}) not in guide`)
    assert.ok(widgetSrc.includes(name), `control ${name} (${key}) not in widget.tsx`)
  }
  // The two words the search placeholder suggests are really in the guide.
  const [, a, b] = messages.helpSearchPlaceholder.match(/"(.+)" or "(.+)"/)
  assert.ok(text.toLowerCase().includes(a) && text.toLowerCase().includes(b))
})

test('search finds the words a user would type', () => {
  const text = flat(buildHelpSections(t, ALL_ON)).toLowerCase()
  for (const w of ['status', 'photo', 'comment', 'export', 'excel', 'filter', 'sort', 'resolved', 'internal', 'refresh', 'column', 'survey']) assert.ok(text.includes(w), w)
})

test('theme.ts is a byte copy of the reference widget', () => {
  const candidates = [
    path.join(__dirname, '..', '..', 'ref', 'time-machine', 'theme.ts'),
    path.join(__dirname, '..', '..', 'time-machine', 'src', 'runtime', 'theme.ts'),
    path.join(__dirname, '..', '..', 'property-report', 'src', 'runtime', 'theme.ts')
  ]
  const ref = candidates.find(f => fs.existsSync(f))
  if (!ref) return
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime', 'theme.ts'), 'utf8'), fs.readFileSync(ref, 'utf8'), 'theme.ts differs from the reference')
})

test('no hex color and no inline svg in the help files; widget uses no *-light theme variable', () => {
  const rt = path.join(__dirname, '..', 'src', 'runtime')
  for (const f of ['components/HelpPopup.tsx', 'components/FirstRunHint.tsx', 'helpSections.ts']) {
    const src = fs.readFileSync(path.join(rt, f), 'utf8')
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(src), `hex color in ${f}`)
    assert.ok(!/<svg/.test(src), `inline svg in ${f}`)
  }
  assert.ok(!/(info|primary|warning|success|error)-light/.test(widgetSrc.replace(/\/\/.*$/gm, '')), 'a *-light theme variable in widget.tsx')
  // 10.5 wiring: Help button, popup, hint and the per-widget dismissal key.
  assert.ok(/icon="question"/.test(widgetSrc))
  assert.ok(/<HelpPopup/.test(widgetSrc) && /<FirstRunHint/.test(widgetSrc))
  assert.ok(/helpHintDismissed/.test(widgetSrc))
  assert.ok(/showHelp !== false/.test(widgetSrc))
})

test('every help translation key referenced in widget.tsx or helpSections.ts exists', () => {
  const hs = fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime', 'helpSections.ts'), 'utf8')
  const used = new Set([...(widgetSrc + hs).matchAll(/\bt\(["']([A-Za-z_0-9]+)["']/g)].map(m => m[1]))
  const usedWhen = new Set([...hs.matchAll(/when\([^)]*?\)/g)].flatMap(m => [...m[0].matchAll(/'([A-Za-z_0-9]+)'/g)].map(x => x[1])))
  for (const k of [...used, ...usedWhen]) assert.ok(k in messages, `missing key ${k}`)
})
