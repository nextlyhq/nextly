/**
 * A database connection string is a secret: its user name, password and
 * query parameters (a `password=` or `sslpassword=` among them) are written
 * to the project's ignored `.env` and printed nowhere. These helpers find
 * those parts so any text the scaffold prints can be scrubbed of them.
 */

const MASK = "***";
// Shorter fragments would match ordinary words in a message ("db", "1"), and
// the whole URL and its query string are scrubbed regardless.
const SHORTEST_SCRUBBED = 3;

/** The parts of `url` that must never be printed, longest first. */
export function connectionSecrets(url: string | undefined): string[] {
  if (!url) return [];
  const secrets = new Set<string>([url]);
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    // Not a URL Node can read: only the whole string is known to be secret.
  }
  if (parsed) {
    for (const raw of [parsed.username, parsed.password]) {
      secrets.add(raw);
      secrets.add(safeDecode(raw));
    }
    if (parsed.search) {
      secrets.add(parsed.search.slice(1));
      for (const [key, value] of parsed.searchParams) {
        secrets.add(value);
        secrets.add(encodeURIComponent(value));
        secrets.add(`${key}=${value}`);
      }
    }
    // A URL with credentials as it may be quoted without its scheme.
    const at = url.indexOf("@");
    if (at > 0) secrets.add(url.slice(url.indexOf("//") + 2, at));
  }
  return [...secrets]
    .filter(secret => secret.length >= SHORTEST_SCRUBBED)
    .sort((a, b) => b.length - a.length);
}

/**
 * `text` with every secret part of the connection string masked. The whole
 * URL becomes its safe form, which keeps the scheme, host, port and database
 * so a message still says which server it is about.
 */
export function redactConnection(
  text: string,
  url: string | undefined
): string {
  if (!url) return text;
  let out = text.split(url).join(safeConnection(url));
  for (const secret of connectionSecrets(url)) {
    if (secret === url) continue;
    out = out.split(secret).join(MASK);
  }
  return out;
}

/** `postgresql://***@db.example.com:5432/app?***`: no user, password or query. */
export function safeConnection(url: string): string {
  try {
    const parsed = new URL(url);
    const credentials = parsed.username || parsed.password ? `${MASK}@` : "";
    const query = parsed.search ? `?${MASK}` : "";
    return `${parsed.protocol}//${credentials}${parsed.host}${parsed.pathname}${query}`;
  } catch {
    return MASK;
  }
}

/** Whether `url` holds a user name, a password or query parameters. */
export function holdsCredentials(url: string): boolean {
  try {
    const parsed = new URL(url);
    return Boolean(parsed.username || parsed.password || parsed.search);
  } catch {
    // Unreadable as a URL, so it may hold anything: treat it as a secret.
    return true;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
