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

/**
 * The connection string's parts, read by hand rather than by `URL`, which
 * refuses a password holding an unencoded `#`, `/` or `?`: the credentials run
 * from `//` to the last `@` before the query, and the query from there on.
 */
function splitConnection(url: string) {
  const slashes = url.indexOf("//");
  const scheme = slashes >= 0 ? url.slice(0, slashes) : "";
  const rest = slashes >= 0 ? url.slice(slashes + 2) : url;
  const firstAt = rest.indexOf("@");
  const queryFrom = rest.indexOf("?", Math.max(firstAt, 0));
  const authorityEnd = queryFrom < 0 ? rest.length : queryFrom;
  const at = firstAt < 0 ? -1 : rest.lastIndexOf("@", authorityEnd);
  return {
    scheme,
    userinfo: at > 0 ? rest.slice(0, at) : "",
    hostAndPath: rest.slice(at + 1, authorityEnd),
    query: queryFrom < 0 ? "" : rest.slice(queryFrom + 1),
  };
}

/** The parts of `url` that must never be printed, longest first. */
export function connectionSecrets(url: string | undefined): string[] {
  if (!url) return [];
  const secrets = new Set<string>([url]);
  const { userinfo, query } = splitConnection(url);
  if (userinfo) {
    secrets.add(userinfo);
    const colon = userinfo.indexOf(":");
    const parts =
      colon < 0
        ? [userinfo]
        : [userinfo.slice(0, colon), userinfo.slice(colon + 1)];
    for (const part of parts) {
      secrets.add(part);
      secrets.add(safeDecode(part));
    }
  }
  if (query) {
    secrets.add(query);
    for (const pair of query.split("&")) {
      const equals = pair.indexOf("=");
      const value = equals < 0 ? pair : pair.slice(equals + 1);
      for (const form of [pair, value, safeDecode(value)]) secrets.add(form);
    }
  }
  return [...secrets]
    .filter(secret => secret.length >= SHORTEST_SCRUBBED)
    .sort((a, b) => b.length - a.length);
}

/**
 * `text` with every secret part of the connection string masked. The whole
 * URL becomes its safe form, which keeps the scheme, host, port and database
 * so a message still says which server it is about. A fragment is masked only
 * where it stands as a word of its own, so a user named `postgres` does not
 * turn `postgresql` into `***ql`, nor a `sslmode=require` value `required`.
 */
export function redactConnection(
  text: string,
  url: string | undefined
): string {
  if (!url) return text;
  // Held aside while the fragments are masked, so they are not masked in it.
  const placeholder = "\u0000connection\u0000";
  let out = text.split(url).join(placeholder);
  for (const secret of connectionSecrets(url)) {
    if (secret === url) continue;
    out = out.replace(standingAlone(secret), MASK);
  }
  return out.split(placeholder).join(safeConnection(url));
}

/** `postgresql://***@db.example.com:5432/app?***`: no user, password or query. */
export function safeConnection(url: string): string {
  const { scheme, userinfo, hostAndPath, query } = splitConnection(url);
  if (!scheme) return MASK;
  return `${scheme}//${userinfo ? `${MASK}@` : ""}${hostAndPath}${query ? `?${MASK}` : ""}`;
}

function standingAlone(fragment: string): RegExp {
  const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "g");
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
