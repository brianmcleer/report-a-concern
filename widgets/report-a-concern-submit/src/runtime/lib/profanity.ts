// Client-side profanity filter for the Report a Concern submit widget.
// Pure functions, no React or Esri imports, so tests/profanity.test.js can run them in Node.
// Moved unchanged from widget.tsx; the widget imports containsProfanity from here.

// ══════════════════════════════════════════════════════════════
//  PROFANITY FILTER
//  Client-side courtesy filter to prevent staff mistreatment in
//  open text fields (description, name). Targets PG-13 level , 
//  blocks words that would earn a film a PG-13 or R rating.
//  Covers English and Spanish (Mexican/pan-Latin American and
//  Castilian). Uses word-boundary / lookbehind matching to avoid
//  false positives inside legitimate words (e.g. "bass", "classic",
//  "passage", "scunthorpe", "putativo", "icono"). Leet-speak
//  substitutions (@→a, 3→e, 1/!→i, 0→o, $→s, 5→s, v→u) are
//  normalised before checking. Unicode diacriticals are stripped
//  via NFD decomposition so accented Spanish input (cabrón, coño,
//  chingón) reduces to ASCII before pattern matching.
//
//  This is a UX-layer filter only. Server-side moderation is the
//  authoritative gate for policy enforcement.
// ══════════════════════════════════════════════════════════════

/**
 * Normalise common leet-speak character substitutions before
 * profanity checking. Applied to a lowercase copy of the input;
 * the original value is never modified.
 *
 * NFD decomposition + diacritic strip is applied first so that
 * accented characters in any language reduce to their ASCII base
 * before pattern matching (cabrón→cabron, coño→cono, chingón→chingon,
 * etc.). This also ensures \b word boundaries work correctly, JS regex
 * \b only recognises ASCII \w chars, so accented letters without
 * normalisation silently break boundary matching.
 */
export function normalizeLeet(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // strip combining diacriticals (á→a, é→e, ñ→n, ü→u …)
        .replace(/@/g, "a")
        .replace(/3/g, "e")
        .replace(/[1!]/g, "i")
        .replace(/0/g, "o")
        .replace(/[$5]/g, "s")
        .replace(/v/g, "u");   // catches fvcking, fvck, etc.
}

/**
 * Common word-form suffixes: -s, -es, -ed, -er, -ers, -ing, -ings,
 * and common compound suffixes (-face, -head, -wad, -bag, -tard).
 * Appended to root patterns so inflected forms are all caught.
 * The group is optional so the bare root still matches.
 */
const SUFFIX = /(?:e?s|e?d|e?r|e?rs|in[g]?|ings|face|head|wad|bag|tard)?\b/;

// ── Pass 1: word-boundary-anchored patterns ───────────────────
// Applied to the leet-normalised text with spacing intact.
// Most patterns carry a leading \b to prevent false positives inside
// legitimate words (e.g. "class", "grassland", "Scunthorpe").
//
// Reference: patterns are cross-referenced against the LDNOOBW
// (List of Dirty, Naughty, Obscene and Otherwise Bad Words, MIT
// license) to ensure comprehensive coverage. The FCC's seven dirty
// words (FCC v. Pacifica Foundation, 1978) form the legal baseline.
//
// Two roots are unanchored because no common English word contains
// them innocuously:
//   fuck , catches "horsefucker", "brotherfucking", "pigfucker"
//   shit , catches "horseshit", "bullshit", "dipshit"
const PROFANITY_PATTERNS: RegExp[] = [
    // ── Core profanity ────────────────────────────────────────
    // fuck, fully unanchored, NO trailing \b or SUFFIX.
    // The \b in SUFFIX blocked matches when a word char immediately follows
    // the root (e.g. "fuckmyballs" → "fuck"+"m", both word chars, no boundary).
    // No English word contains "fuck" innocuously, so no false-positive risk.
    /f+u+c+k+/i,

    // shit, same reasoning as fuck above.
    /sh[i!1]+t+/i,

    // ass standalone, \b prevents "class", "mass", "grassland", "harass"
    new RegExp(/\ba+s{2,}/.source + SUFFIX.source, "i"),

    // asshole / arsehole (British spelling), arsehole needs explicit match
    // because the SUFFIX \b pattern fires between "arse" and "hole" (both
    // word chars), so /\barse/ + SUFFIX only catches standalone "arse".
    // Using /\barse(?:hole)?/ catches both.
    new RegExp(/\ba+s+h+o+l+e+/.source + SUFFIX.source, "i"),
    /\barse(?:hole)?\b/i,

    // -ass compounds: dumbass, jackass, smartass, badass, etc.
    new RegExp(/(?:dumb|jack|smart|bad|wise|hard|fat|kick|lard|horse|tight|half|candy|lazy)ass/.source + SUFFIX.source, "i"),

    // bitch / bitching / bitches
    new RegExp(/\bb+i+t+c+h+/.source + SUFFIX.source, "i"),

    // bastard
    new RegExp(/\bb+a+s+t+a+r+d+/.source + SUFFIX.source, "i"),

    // bollocks (British), \b prevents "bullock" (young bull)
    /\bbollocks\b/i,

    // bunghole / butthole
    /\bbunghole\b/i,
    /\bbutthole\b/i,

    // cunt, \b prevents "Scunthorpe"
    new RegExp(/\bc+u+n+t+/.source + SUFFIX.source, "i"),

    // damn / goddamn / god damn / damned
    new RegExp(/\bd+a+m+n+/.source + SUFFIX.source, "i"),
    new RegExp(/\bg+o+d+\s*d+a+m+n+/.source + SUFFIX.source, "i"),

    // dick, bare word ALLOWED (common given name, e.g. a resident named
    // "Dick"). Reported 2026-09: a resident named Dick could not submit
    // because the old /\bd+i+c+k+/ + SUFFIX pattern flagged his name in
    // both the name and description fields. Only the aggressive compounds
    // are blocked now (dickhead, dickface, dickwad, dickbag, dicktard).
    // The compound suffix is required, so standalone "dick", "dicks", and
    // "Dick's" pass. \b on both sides still keeps "Dickens", "Dickinson",
    // "Dickson" safe.
    new RegExp(/\bd+i+c+k+(?:head|face|wad|bag|tard)/.source + SUFFIX.source, "i"),

    // cock, \b + SUFFIX \b prevents "cockroach"
    new RegExp(/\bc+o+c+k+/.source + SUFFIX.source, "i"),

    // piss
    new RegExp(/\bp+i+s+s+/.source + SUFFIX.source, "i"),

    // prick
    new RegExp(/\bp+r+i+c+k+/.source + SUFFIX.source, "i"),

    // tosser / wanker (British profanity, in LDNOOBW)
    /\btosser\b/i,
    /\bwanker\b/i,

    // whore
    new RegExp(/\bw+h+o+r+e+/.source + SUFFIX.source, "i"),

    // slut
    new RegExp(/\bs+l+u+t+/.source + SUFFIX.source, "i"),

    // twat
    new RegExp(/\bt+w+a+t+/.source + SUFFIX.source, "i"),

    // ── Abbreviations ─────────────────────────────────────────
    /\bwtf\b/i,
    /\btf\b/i,

    // ── Racial / ethnic slurs ──────────────────────────────────
    // Black / African-American
    new RegExp(/\bn[i!1]+g+[e3]+r+/.source + SUFFIX.source, "i"),  // nigger
    new RegExp(/\bn[i!1]+g+[a@]+/.source + SUFFIX.source, "i"),    // nigga
    /\bcoon\b/i,            // \b: safe for "raccoon", "cocoon"
    /\bdarkie\b/i,
    /\bjig+[ae]boo\b/i,     // jigaboo / jiggaboo / jiggerboo

    // Hispanic / Latino
    /\bbeaner[s]?\b/i,
    /\bspic[s]?\b/i,        // \b: safe for "spice", "hospice", "auspicious"
    /\bwetback[s]?\b/i,

    // Asian
    /\bslanteye\b/i,

    // Middle Eastern / Muslim
    /\braghead\b/i,
    /\btowelhead\b/i,

    // South Asian
    /\bpaki\b/i,            // \b: safe for "Pakistan" (paki not at word boundary)

    // LGBTQ+ slurs
    new RegExp(/\bf+[a@]+g+[o0]+t+/.source + SUFFIX.source, "i"),  // faggot
    new RegExp(/\bf+[a@]+g+/.source + SUFFIX.source, "i"),         // fag
    new RegExp(/\bd+y+k+e+/.source + SUFFIX.source, "i"),          // dyke
    /\btranny\b/i,

    // ── Disability / other slurs ──────────────────────────────
    new RegExp(/\br+[e3]+t+[a@]+r+d+/.source + SUFFIX.source, "i"),

    // kike
    new RegExp(/\bk+[i!1]+k+[e3]*/.source + SUFFIX.source, "i"),

    // ── Hate ideology / symbols ────────────────────────────────
    /\bswastika\b/i,
    /\bneo[-\s]?nazi\b/i,

    // ── Spanish profanity, core ──────────────────────────────
    // normalizeLeet() strips diacriticals before this runs, so all
    // patterns use plain ASCII. Accented input (cabrón, coño, chingón)
    // normalises to the unaccented form and is caught here.
    //
    // False-positive audit (confirmed safe with \b):
    //   puta   → "putativo" (putative), \bputa\b does NOT match ✓
    //   cono   → "icono"              , \bcono\b does NOT match ✓
    //   culo   → "vehiculo","muscular", \bculo\b does NOT match ✓
    //   polla  → "ampolla"            , \bpolla\b does NOT match ✓
    //   mamon  → "mammon"             , different spelling          ✓

    // chingar / chinga / chingado / chingada / chingon / chingo
    // Unanchored like fuck/shit, no innocent Spanish word contains "chinga" or "chingo".
    // Two roots needed: chinga* (chinga, chingada, chingadera) and chingo* (chingón→chingon).
    /chinga/i,
    /chingo/i,

    // puta / puto (whore; also used as intensifier), \b required: "putativo"
    /\bputa[s]?\b/i,
    /\bputo[s]?\b/i,

    // pendejo / pendeja (dumbass / idiot)
    /\bpendej[oa][s]?\b/i,

    // cabron / cabrona (bastard / bitch; after diacritic strip: cabrón→cabron)
    /\bcabron[ao]?\b/i,

    // cono / coño (cunt; after strip: coño→cono), \b: "icono" safe ✓
    /\bcono\b/i,

    // mierda (shit)
    /\bmierda[s]?\b/i,

    // culo (ass), \b: "vehiculo", "muscular" safe ✓
    /\bculo[s]?\b/i,

    // verga (cock, Mexican Spanish)
    // NOTE: normalizeLeet applies v→u, so "verga" normalises to "uerga" before
    // pattern matching. Pattern targets the post-normalisation form.
    // \b: "uerga" has no false positives.
    /\buerga[s]?\b/i,

    // joder / jodete / jodido / jodida (fuck, Castilian)
    // Two patterns: jode[rt] for joder/jodete, jodid[oa] for jodido/jodida.
    /\bjode[rt]/i,
    /\bjodid[oa][s]?\b/i,

    // maricon / marica (faggot, LGBTQ+ slur; after strip: maricón→maricon)
    /\bmaric[oa]n?\b/i,

    // culero / culera (asshole, Mexican)
    /\bculer[oa][s]?\b/i,

    // hijo de puta / hijoputa (son of a bitch)
    /\bhijo\s+de\s+puta\b/i,
    /\bhijoputa\b/i,

    // perra / perro used as insult (bitch / fucker)
    /\bperra[s]?\b/i,

    // polla (cock, Castilian), \b: "ampolla" safe ✓
    /\bpolla[s]?\b/i,

    // hostia / hostias (damn / shit, Castilian; very common)
    /\bhostia[s]?\b/i,

    // mamon / mamona (wanker, after strip: mamón→mamon)
    /\bmamon[ao]?\b/i,

    // gilipollas (idiot / asshole, Castilian)
    /\bgilipollas\b/i,

    // cojones / cojon (balls, used as curse; after strip: cojón→cojon)
    /\bcojon[es]*\b/i,

    // sudaca (derogatory slur for South Americans)
    /\bsudaca[s]?\b/i,
];

// ── Pass 2: unanchored root patterns for concatenated runs ────
// Applied ONLY to alpha runs of 12+ consecutive characters extracted
// from the normalised text. The 12-char threshold is chosen to keep
// common legitimate words safe:
//   "Scunthorpe"  (10 chars), below threshold ✓
//   "cockroaches" (11 chars), below threshold ✓
//   "horsefucker" (11 chars), caught by Pass 1's unanchored /fuck/ ✓
// Runs >= 12 chars are almost always deliberate concatenation evasion.
//
// /cock/ and /cunt/ are intentionally omitted, covered by Pass 1
// anchored patterns; their absence avoids any hypothetical 12+ char
// proper-noun false positive.
const PROFANITY_ROOTS_EMBEDDED: RegExp[] = [
    /fuck/i,
    /shit/i,
    /(?:dumb|jack|smart|bad|wise|hard|fat|kick|lard|horse|tight|half|candy|lazy)ass/i,
    /asshole/i,
    /arsehole/i,
    /bitch/i,
    /bastard/i,
    /bollocks/i,
    /bunghole/i,
    /butthole/i,
    /goddamn/i,
    /damn/i,
    /prick/i,
    /tosser/i,
    /wanker/i,
    /whore/i,
    /slut/i,
    /twat/i,
    // Racial / ethnic slurs
    /nigger/i,
    /nigga/i,
    /beaner/i,
    /spic/i,
    /wetback/i,
    /slanteye/i,
    /raghead/i,
    /towelhead/i,
    /faggot/i,
    /tranny/i,
    /retard/i,
    /kike/i,
    /dyke/i,
    // Hate ideology
    /swastika/i,
    /neonazi/i,
    // Spanish profanity roots (for concatenated-evasion runs ≥11 chars)
    // Note: v→u leet sub is already applied before Pass 2 runs, so
    // "verga" is matched as "uerga" here.
    /chinga/i,
    /chingo/i,
    /pendejo/i,
    /cabron/i,
    /mierda/i,
    /uerga/i,    // verga after v→u normalisation
    /jodido/i,
    /maricon/i,
    /culero/i,
    /hijoputa/i,
    /gilipollas/i,
    /cojones/i,
];

/**
 * Returns true if `text` contains any profanity after leet-speak normalisation.
 *
 * Word list cross-referenced against:
 *   - LDNOOBW (List of Dirty, Naughty, Obscene and Otherwise Bad Words,
 *     MIT license, github.com/LDNOOBW)
 *   - FCC v. Pacifica Foundation (1978) "seven dirty words" legal baseline
 *   - Common Mexican/pan-Latin American and Castilian Spanish profanity
 *
 * Two-pass strategy:
 *
 *   Pass 1, Anchored patterns on the full normalised text.
 *             Word-boundary anchors protect legitimate words.
 *             fuck, shit, and chinga are unanchored (no innocent word
 *             embeds them) to catch compound forms like "horsefucker".
 *             normalizeLeet() strips Unicode diacriticals via NFD before
 *             this runs so accented Spanish input matches ASCII patterns.
 *
 *   Pass 2, Unanchored root patterns applied to every run of 11+
 *             consecutive alpha characters in the normalised text.
 *             Catches deliberate concatenation evasion while keeping
 *             "Scunthorpe" (10) and "cockroaches" (11) safely below
 *             the threshold.
 */
// ── Offensive emoji blocklist ─────────────────────────────────
// Emojis are outside ASCII and are not touched by normalizeLeet()
// or the [a-z]{11,} Pass 2 alpha-run scan, so they require a
// separate pre-normalisation check.
//
// The `u` flag is required for \u{XXXXXX} literals that reference
// Unicode code points above U+FFFF (astral plane).
//
// Skin-tone modifier sequence: U+1F595 followed by any Fitzpatrick
// modifier (U+1F3FB-U+1F3FF) covers all six middle-finger variants:
//   🖕  🖕🏻  🖕🏼  🖕🏽  🖕🏾  🖕🏿
//
// ZWJ sequences (e.g. emoji + U+200D + another emoji) are handled
// implicitly, if the base codepoint is present, it matches.
const OFFENSIVE_EMOJI_RE = /\u{1F595}[\u{1F3FB}-\u{1F3FF}]?/u;  // 🖕 middle finger, all skin tones

export function containsProfanity(text: string): boolean {
    if (!text) return false;

    // ── Emoji check, runs on raw input before normalisation ─────
    // normalizeLeet() does not touch astral-plane codepoints, so emoji
    // must be detected here against the original string.
    if (OFFENSIVE_EMOJI_RE.test(text)) return true;

    const normalised = normalizeLeet(text);

    // Pass 1: standard check, handles normally typed text
    if (PROFANITY_PATTERNS.some((re) => re.test(normalised))) return true;

    // Pass 2: long alpha-run check, handles concatenated evasion.
    // Threshold is 11+ chars (lowered from 12 in v2.8.1 to catch
    // 11-char compounds like "fuckmyballs" as a safety net).
    // Common legitimate 11-char words are safe: "cockroaches" contains
    // no Pass 2 roots (/cock/ and /cunt/ are intentionally excluded).
    const longRuns = normalised.match(/[a-z]{11,}/g);
    if (longRuns) {
        for (const run of longRuns) {
            if (PROFANITY_ROOTS_EMBEDDED.some((re) => re.test(run))) return true;
        }
    }

    return false;
}
