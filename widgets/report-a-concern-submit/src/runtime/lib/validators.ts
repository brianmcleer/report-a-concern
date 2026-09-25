// Contact field validators for the Report a Concern submit widget.
// Pure functions, no React or Esri imports, so tests/validators.test.js can run them in Node.
// Moved unchanged from widget.tsx; the widget imports them from here.

/**
 * RFC 5321-aligned email validator.
 *
 * Rules enforced:
 *   · Local part: a-z 0-9 . _ % + − only; max 64 chars; no consecutive dots
 *   · Exactly one @
 *   · Domain: one or more labels separated by dots; each label is alphanumeric
 *     + hyphens, must not start or end with a hyphen, max 63 chars per label
 *   · TLD: alpha only, 2-24 chars (rejects numeric TLDs like .123)
 *   · Total length: ≤ 254 chars (RFC 5321 max path length)
 *
 * Intentionally stricter than RFC 5321 in two ways:
 *   · Quoted local parts ("user name"@domain.com) are rejected, uncommon and
 *     a frequent vector for injection attempts.
 *   · IP-address domain literals ([192.168.1.1]) are rejected, not relevant
 *     for a public municipal form.
 */
export const EMAIL_RE =
    /^[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,24}$/;

/**
 * Reserved / non-deliverable email domains.
 *
 * These are syntactically valid but can never receive mail. The city SMTP
 * relay rejects them with a hard 501 5.1.5 ("Recipient address reserved by
 * RFC 2606"), and because the notification scripts retry on failure, a single
 * placeholder submission (e.g. the "your.email@example.com" hint text) re-queues
 * on every run and floods Notification_Log. Blocking here stops it at the source.
 *
 * RESERVED_EMAIL_TLDS , RFC 2606 / RFC 6761 / RFC 6762 reserved top-level names.
 *                        Matches ANY subdomain (foo.test, a.b.invalid, etc.).
 * RESERVED_EMAIL_SLDS , RFC 2606 reserved second-level example domains.
 *
 * Deliberately scoped to RFC-reserved names only, real user domains (gmail.com,
 * test-corp.org, etc.) are never caught. Typo domains that ARE registered still
 * fail downstream; the Python mailer's permanent-failure handling covers those.
 */
const RESERVED_EMAIL_TLDS = new Set(["test", "example", "invalid", "localhost", "local"]);
const RESERVED_EMAIL_SLDS = new Set(["example.com", "example.net", "example.org"]);

export function isReservedEmailDomain(domain: string): boolean {
    const d = domain.toLowerCase();
    // example.com/.net/.org and any subdomain of them.
    for (const sld of RESERVED_EMAIL_SLDS) {
        if (d === sld || d.endsWith("." + sld)) return true;
    }
    const lastDot = d.lastIndexOf(".");
    const tld = lastDot === -1 ? d : d.slice(lastDot + 1);
    return RESERVED_EMAIL_TLDS.has(tld);
}

export function isValidEmail(raw: string): boolean {
    const t = raw.trim();
    if (!t || t.length > 254) return false;
    // Reject consecutive dots anywhere in the local part
    const atIdx = t.indexOf("@");
    if (atIdx < 1) return false;
    if (/\.{2,}/.test(t.slice(0, atIdx))) return false;
    if (!EMAIL_RE.test(t)) return false;
    // Reject RFC 2606/6761 reserved domains, valid syntax, undeliverable.
    if (isReservedEmailDomain(t.slice(atIdx + 1))) return false;
    return true;
}
export const PHONE_DIGITS_RE = /^\d{10}$/;
export const stripPhoneDigits = (val: string) => val.replace(/\D/g, "");
