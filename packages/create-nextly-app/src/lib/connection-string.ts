/**
 * A database connection string is a secret: its user name, password and
 * query parameters (a `password=` or `sslpassword=` among them) are written
 * to the project's ignored `.env` and printed nowhere. These helpers find
 * those parts so any text the scaffold prints can be scrubbed of them.
 */

const MASK = "***";
// A query value shorter than this is masked only as `key=value`: alone, it
// would match ordinary words in a message (`ssl=1` and "exit code 1"). The
// user name and password are masked at any length, being the credentials.
const SHORTEST_BARE_QUERY_VALUE = 3;

/**
 * The connection string's parts, read by hand rather than by `URL`, which
 * refuses a password holding an unencoded `#`, `/` or `?`: the credentials run
 * from `//` to the last `@` before the query, and the query from there on.
 * `ambiguous` when an `@` also follows the query's start, as in a password
 * holding both `@` and `?`: where the credentials end cannot then be told.
 */
function splitConnection(url: string) {
  const slashes = url.indexOf("//");
  const hasAuthority = slashes >= 0;
  const rest = hasAuthority ? url.slice(slashes + 2) : url;
  const parts = authorityParts(rest);
  return {
    scheme: hasAuthority ? url.slice(0, slashes) : "",
    rest,
    ...parts,
    // An `@` after the query's start, or a host that is no `host[:port]`
    // (`alice:swordfish` with the `@` left out), may hold credentials.
    ambiguous:
      parts.atAfterQuery || (hasAuthority && !PLAIN_HOST.test(parts.host)),
  };
}

/** What follows `//`: credentials, host, path and query, read by position. */
function authorityParts(rest: string) {
  const firstAt = rest.indexOf("@");
  const queryFrom = rest.indexOf("?", Math.max(firstAt, 0));
  const authorityEnd = queryFrom < 0 ? rest.length : queryFrom;
  const at = firstAt < 0 ? -1 : rest.lastIndexOf("@", authorityEnd);
  const hostAndPath = rest.slice(at + 1, authorityEnd);
  return {
    userinfo: at > 0 ? rest.slice(0, at) : "",
    host: hostAndPath.split("/")[0] ?? "",
    hostAndPath,
    query: queryFrom < 0 ? "" : rest.slice(queryFrom + 1),
    atAfterQuery: rest.lastIndexOf("@") > authorityEnd,
  };
}

/** `host`, `host:5432`, `[::1]:5432`, or nothing (`file:` and a socket path). */
const PLAIN_HOST = /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._~%-]*)(?::\d*)?$/;

/** The parts of `url` that must never be printed, longest first. */
export function connectionSecrets(url: string | undefined): string[] {
  if (!url) return [];
  const { rest, userinfo, host, query, ambiguous } = splitConnection(url);
  // Where the credentials' end is ambiguous, every reading is secret,
  // a host that may be `user:password` with its `@` left out among them.
  const userinfos = ambiguous
    ? [userinfo, rest.slice(0, rest.lastIndexOf("@")), host]
    : [userinfo];
  const secrets = new Set<string>([
    url,
    ...userinfos.flatMap(credentialSecrets),
    ...querySecrets(query),
  ]);
  return [...secrets]
    .filter(secret => secret.length > 0)
    .sort((a, b) => b.length - a.length);
}

/** `user:password` whole, and each half as written and decoded. */
function credentialSecrets(userinfo: string): string[] {
  if (!userinfo) return [];
  const colon = userinfo.indexOf(":");
  const parts =
    colon < 0
      ? [userinfo]
      : [userinfo.slice(0, colon), userinfo.slice(colon + 1)];
  return [userinfo, ...parts.flatMap(part => [part, safeDecode(part)])];
}

/** The query whole, each `key=value`, and each value long enough to stand alone. */
function querySecrets(query: string): string[] {
  if (!query) return [];
  return [
    query,
    ...query.split("&").flatMap(pair => {
      const equals = pair.indexOf("=");
      const value = equals < 0 ? "" : pair.slice(equals + 1);
      const bare = [value, safeDecode(value)].filter(
        form => form.length >= SHORTEST_BARE_QUERY_VALUE
      );
      return [pair, ...bare];
    }),
  ];
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

/**
 * `postgresql://***@db.example.com:5432/app?***`: no user, password or query.
 * An ambiguous URL keeps its scheme only, since what reads as its host may be
 * the end of the password.
 */
export function safeConnection(url: string): string {
  const { scheme, userinfo, hostAndPath, query, ambiguous } =
    splitConnection(url);
  // Not even the scheme is known to be one when there is no `//`.
  if (!scheme) return MASK;
  if (ambiguous) return `${scheme}//${MASK}`;
  return `${scheme}//${userinfo ? `${MASK}@` : ""}${hostAndPath}${query ? `?${MASK}` : ""}`;
}

/**
 * `text` with every URL in it reduced to its safe form. For messages printed
 * before the connection string is known, such as a parse error quoting a
 * misspelt `--database-urll=postgresql://user:password@host/db`.
 */
export function redactUrlsIn(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"`]+/gi, url =>
    safeConnection(url)
  );
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
