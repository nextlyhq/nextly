/**
 * Asking the site's breached-password source whether a password has appeared
 * in a breach, by k-anonymity: only the first 5 hex digits (20 bits) of the
 * password's SHA-1 leave the process, and the answer is every known suffix
 * under that prefix, compared here.
 *
 * Every way this can fail answers `"unavailable"` rather than refusing the
 * password or calling it checked: a source that is down must neither lock
 * people out nor pretend to have vouched for a password.
 *
 * @module plugins/security/breached-passwords
 */

import { createHash } from "node:crypto";

import type { BreachedPasswordsConfig } from "../../shared/types/config";

/** Have I Been Pwned's range service, at its public address. */
const PWNED_PASSWORDS_RANGE_URL = "https://api.pwnedpasswords.com/range";

/** How long a check waits for its source, unless the site says otherwise. */
const DEFAULT_TIMEOUT_MS = 2000;

/** What a breached-password check found. */
export type BreachedAnswer = "breached" | "not-breached" | "unavailable";

/** The `fetch` the check calls, injectable so a test can record what leaves. */
type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Ask the source whether the password (already NFC-normalised) is breached.
 *
 * Unset, the source is `"pwned-passwords"`. A range service is fetched only
 * over `https`, asking for padded answers so the response's size says nothing
 * about the prefix; the padding entries carry a count of 0 and never match.
 */
export async function checkBreached(
  password: string,
  config: BreachedPasswordsConfig | undefined,
  fetchImpl: Fetch = fetch
): Promise<BreachedAnswer> {
  const digest = createHash("sha1").update(password, "utf8").digest("hex");
  const prefix = digest.slice(0, 5).toUpperCase();
  const suffix = digest.slice(5).toUpperCase();
  const source = config?.source ?? "pwned-passwords";
  const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let suffixes: readonly string[] | null;
  if (typeof source === "object" && "range" in source) {
    // The site's own list, in the process: no transport here to secure.
    suffixes = await withinTime(
      Promise.resolve().then(() => source.range(prefix)),
      timeoutMs
    );
  } else {
    const base =
      source === "pwned-passwords" ? PWNED_PASSWORDS_RANGE_URL : source.url;
    // Checked before anything is sent: a plain-HTTP address would carry even
    // the prefix in the clear, so it is sent nothing at all.
    if (!isHttps(base)) return "unavailable";
    suffixes = await fetchRange(rangeUrl(base, prefix), timeoutMs, fetchImpl);
  }
  if (suffixes === null) return "unavailable";
  return suffixes.some(entry => knownSuffix(entry) === suffix)
    ? "breached"
    : "not-breached";
}

/**
 * The warning boot logs for a source that will never be asked: a `url` that
 * is not `https`. Null when there is nothing to warn about.
 */
export function breachedPasswordsSourceWarning(
  config: BreachedPasswordsConfig | undefined
): string | null {
  const source = config?.source;
  if (typeof source !== "object" || !("url" in source)) return null;
  if (isHttps(source.url)) return null;
  return (
    "[Nextly] security.breachedPasswords.source.url is not an https address, " +
    "so it is sent nothing and every breached-password check answers that " +
    "the password went unchecked."
  );
}

/** Whether `url` parses as an `https` address. */
function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** `<base>/<prefix>`, with exactly one slash between them. */
function rangeUrl(base: string, prefix: string): string {
  return `${base.replace(/\/+$/, "")}/${prefix}`;
}

/**
 * The suffix a range answer's line names, upper-cased, or null for a padding
 * entry: a line is `SUFFIX:COUNT`, and padding carries a count of 0. A bare
 * suffix, as a site's own list may give, counts as known.
 */
function knownSuffix(entry: string): string | null {
  const [suffix = "", count] = entry.trim().split(":");
  if (count !== undefined && Number(count) === 0) return null;
  return suffix.toUpperCase();
}

/** Fetch one range, or null when it fails, answers badly or runs out of time. */
async function fetchRange(
  url: string,
  timeoutMs: number,
  fetchImpl: Fetch
): Promise<readonly string[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await withinTime(
      fetchImpl(url, {
        headers: { "Add-Padding": "true" },
        signal: controller.signal,
        redirect: "error",
      }),
      timeoutMs
    );
    if (response === null || !response.ok) return null;
    const body = await withinTime(response.text(), timeoutMs);
    return body === null ? null : body.split("\n");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** `work`'s value, or null when it rejects or takes longer than `ms`. */
async function withinTime<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work.catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}
