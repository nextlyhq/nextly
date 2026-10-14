import type { AccountsSettings } from "../settings";

/** The most known-browser tokens one cookie holds; the oldest is dropped first. */
const TOKENS_PER_COOKIE = 10;

/** The plugin's cookies, never named as the admin's are. */
const BASE_NAMES = {
  /** The signed-in session's token. */
  session: "nx-account",
  /** Up to ten tokens, one per account this browser has signed in to. */
  knownBrowsers: "nx-account-known",
  /** Ties a pending sign-up to the browser that made it. */
  signUp: "nx-account-signup",
  /** The plugin's own CSRF token, which a write sends back in a header. */
  csrf: "nx-account-csrf",
} as const;

export type CookieKind = keyof typeof BASE_NAMES;

/**
 * A cookie's name on this site: with the `__Host-` prefix where the site is
 * served over HTTPS, so no subdomain can set or overwrite it.
 */
export function cookieName(
  settings: Pick<AccountsSettings, "origin">,
  kind: CookieKind
): string {
  return isHttps(settings) ? `__Host-${BASE_NAMES[kind]}` : BASE_NAMES[kind];
}

/** A cookie's value on a request, or undefined. */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (header === null) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name)
      return decodeURIComponent(part.slice(index + 1).trim());
  }

  return undefined;
}

/**
 * How one of the plugin's cookies is written, as a framework's cookie store
 * takes it (Next.js's `cookies().set(name, value, options)` among them): the
 * value unencoded, since the store encodes it.
 */
export interface CookieWrite {
  readonly name: string;
  readonly value: string;
  readonly options: {
    readonly httpOnly: true;
    readonly sameSite: "lax";
    readonly path: "/";
    readonly secure: boolean;
    /** Whole seconds; 0 removes the cookie. */
    readonly maxAge: number;
  };
}

/**
 * One of the plugin's cookies: HTTP-only, `SameSite=Lax`, path `/`, `Secure`
 * over HTTPS, and lasting until `expiresAt`, so it outlives a browser
 * restart but never what it names.
 */
export function cookieWrite(
  settings: Pick<AccountsSettings, "origin">,
  kind: CookieKind,
  value: string,
  expiresAt: Date,
  now: Date
): CookieWrite {
  return {
    name: cookieName(settings, kind),
    value,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isHttps(settings),
      maxAge: Math.max(
        0,
        Math.floor((expiresAt.getTime() - now.getTime()) / 1000)
      ),
    },
  };
}

/** A `Set-Cookie` value for one of the plugin's cookies, written as {@link cookieWrite} says. */
export function setCookie(
  settings: Pick<AccountsSettings, "origin">,
  kind: CookieKind,
  value: string,
  expiresAt: Date,
  now: Date
): string {
  return serializeCookie(cookieWrite(settings, kind, value, expiresAt, now));
}

/** A cookie write as a `Set-Cookie` value. */
export function serializeCookie(write: CookieWrite): string {
  const parts = [
    `${write.name}=${encodeURIComponent(write.value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${write.options.maxAge}`,
  ];
  if (write.options.secure) parts.push("Secure");

  return parts.join("; ");
}

/** A `Set-Cookie` value that removes one of the plugin's cookies. */
export function clearCookie(
  settings: Pick<AccountsSettings, "origin">,
  kind: CookieKind
): string {
  return serializeCookie(cookieClear(settings, kind));
}

/** The write that removes one of the plugin's cookies: empty, with its own attributes, so a `__Host-` cookie is matched. */
export function cookieClear(
  settings: Pick<AccountsSettings, "origin">,
  kind: CookieKind
): CookieWrite {
  return cookieWrite(settings, kind, "", new Date(0), new Date(0));
}

/** The known-browser tokens a request's cookie holds, at most ten. */
export function knownTokensOf(
  settings: Pick<AccountsSettings, "origin">,
  request: Request
): string[] {
  const value = readCookie(request, cookieName(settings, "knownBrowsers"));
  if (value === undefined || value === "") return [];

  return value
    .split(".")
    .filter(token => token !== "")
    .slice(-TOKENS_PER_COOKIE);
}

/**
 * The known-browser cookie's next value with `token` added as the newest,
 * once, and the oldest dropped past ten. Tokens are base64url, which never
 * holds the separator.
 */
export function withKnownToken(
  tokens: readonly string[],
  token: string
): string {
  return [...tokens.filter(held => held !== token), token]
    .slice(-TOKENS_PER_COOKIE)
    .join(".");
}

function isHttps(settings: Pick<AccountsSettings, "origin">): boolean {
  return new URL(settings.origin).protocol === "https:";
}
