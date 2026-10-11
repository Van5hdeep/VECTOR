/**
 * Detects credentials and sensitive identifiers so they are never written to
 * long-term memory (which is replayed into every prompt sent to the model).
 * Deliberately conservative: it targets secrets, not ordinary personal facts.
 */

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    kind: "API key or token",
    re: /\b(?:sk-[A-Za-z0-9_-]{16,}|gsk_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|ya29\.[0-9A-Za-z_-]{20,})/g,
  },
  { kind: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    kind: "password or secret",
    re: /\b(?:password|passcode|passwd|pwd|api[ _-]?key|secret|token|otp|cvv|(?:bank|atm|card|sim) pin)\b\s*(?:is|=|:)\s*\S+/gi,
  },
  { kind: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: "Aadhaar number", re: /(?<![\d ])\d{4} \d{4} \d{4}(?![ \d])/g },
];

const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function isCardNumber(match: string): boolean {
  const digits = match.replace(/[ -]/g, "");
  return digits.length >= 13 && digits.length <= 19 && luhn(digits);
}

/** Kinds of sensitive data found in the text (empty when it looks safe to store). */
export function findSensitive(text: string): string[] {
  const kinds = new Set<string>();
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) kinds.add(kind);
  }
  for (const m of text.matchAll(CARD_RE)) {
    if (isCardNumber(m[0])) kinds.add("card number");
  }
  return [...kinds];
}

/** Masks anything findSensitive would flag; used when replaying stored text into a prompt. */
export function redactSensitive(text: string): string {
  let out = text;
  for (const { re } of PATTERNS) out = out.replace(re, "[redacted]");
  return out.replace(CARD_RE, (m) => (isCardNumber(m) ? "[redacted]" : m));
}
