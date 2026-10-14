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

import { z } from "zod";

import type { BreachedPasswordsConfig } from "../../shared/types/config";
import { getCoreVersion } from "../core-version";

/** Have I Been Pwned's range service, at its public address. */
const PWNED_PASSWORDS_RANGE_URL = "https://api.pwnedpasswords.com/range";

/** How this check names itself to a range service. */
const USER_AGENT = `Nextly/${getCoreVersion()} (plugin password helper)`;

/** How long a check waits for its source, unless the site says otherwise. */
const DEFAULT_TIMEOUT_MS = 2000;

/**
 * The waits a site may configure, in milliseconds. Outside them a timer would
 * be clamped to a millisecond, and every check would answer "unavailable".
 */
const TIMEOUT_BOUNDS = { lowest: 1, highest: 60_000 } as const;

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
  const timeoutMs = resolvedTimeoutMs(config);

  let suffixes: readonly string[] | null;
  if (typeof source === "object" && "range" in source) {
    // The site's own list, in the process: no transport here to secure. Its
    // answer is parsed rather than trusted to match its type, since a source
    // in JavaScript, or one passing on a provider's decoded answer, can hand
    // back anything; what is not a list of strings proves nothing.
    const answer = RANGE_ANSWER.safeParse(
      await withinTime(
        Promise.resolve().then(() => source.range(prefix)),
        timeoutMs
      )
    );
    suffixes = answer.success ? answer.data : null;
  } else {
    const base =
      source === "pwned-passwords" ? PWNED_PASSWORDS_RANGE_URL : source.url;
    // Checked before anything is sent: a plain-HTTP address would carry even
    // the prefix in the clear, so it is sent nothing at all.
    if (!isHttps(base)) return "unavailable";
    suffixes = await fetchRange(rangeUrl(base, prefix), timeoutMs, fetchImpl);
  }
  if (suffixes === null) return "unavailable";
  // Read strictly: an answer that is not a list of suffixes (an error page a
  // proxy returned with a 200, say) proves nothing, and absence from it must
  // not pass for "not breached".
  const known = knownSuffixes(
    suffixes,
    typeof source !== "object" || !("range" in source)
  );
  if (known === null) return "unavailable";
  return known.has(suffix) ? "breached" : "not-breached";
}

/**
 * The warnings boot logs for a configuration the check cannot honour: a `url`
 * that is not `https`, which is never asked, and a `timeoutMs` outside its
 * bounds, which is replaced by the default. Empty when there is none.
 */
export function breachedPasswordsWarnings(
  config: BreachedPasswordsConfig | undefined
): string[] {
  const warnings: string[] = [];
  const source = config?.source;
  if (typeof source === "object" && "url" in source && !isHttps(source.url)) {
    warnings.push(
      "[Nextly] security.breachedPasswords.source.url is not an https address, " +
        "so it is sent nothing and every breached-password check answers that " +
        "the password went unchecked."
    );
  }
  if (config?.timeoutMs !== undefined && !isValidTimeout(config.timeoutMs)) {
    warnings.push(
      `[Nextly] security.breachedPasswords.timeoutMs must be a whole number of milliseconds from ${TIMEOUT_BOUNDS.lowest} to ${TIMEOUT_BOUNDS.highest}; the default of ${DEFAULT_TIMEOUT_MS} is used instead.`
    );
  }
  return warnings;
}

/** The configured wait when it is within bounds; otherwise the default. */
function resolvedTimeoutMs(
  config: BreachedPasswordsConfig | undefined
): number {
  const value = config?.timeoutMs;
  return value !== undefined && isValidTimeout(value)
    ? value
    : DEFAULT_TIMEOUT_MS;
}

function isValidTimeout(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= TIMEOUT_BOUNDS.lowest &&
    value <= TIMEOUT_BOUNDS.highest
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

/**
 * The prefix appended as the last segment of `base`'s path, with exactly one
 * slash before it. Parsed rather than concatenated, so a query string or a
 * fragment in the configured address stays where it was and the prefix lands
 * in the path.
 */
function rangeUrl(base: string, prefix: string): string {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${prefix}`;
  return url.toString();
}

/** What a site's own range source must answer: a list of entries. */
const RANGE_ANSWER = z.array(z.string());

/** A range answer's entry: a 35-hex-digit suffix, and a count when given. */
const RANGE_ENTRY = /^([0-9A-Fa-f]{35})(?::(\d+))?$/;

/**
 * The suffixes a range answer names, upper-cased, leaving out padding (a
 * count of 0); or null when any entry is not a suffix, or a range service's
 * entry carries no count. A site's own list may give bare suffixes.
 */
function knownSuffixes(
  entries: readonly string[],
  countRequired: boolean
): Set<string> | null {
  const known = new Set<string>();
  for (const raw of entries) {
    const entry = raw.trim();
    if (entry === "") continue;
    const match = RANGE_ENTRY.exec(entry);
    if (!match || (countRequired && match[2] === undefined)) return null;
    if (match[2] !== undefined && Number(match[2]) === 0) continue;
    known.add((match[1] ?? "").toUpperCase());
  }
  return known;
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
        // Have I Been Pwned asks every client to name itself in its user
        // agent, and may refuse one that does not; refused, every check would
        // answer "unavailable".
        headers: { "Add-Padding": "true", "User-Agent": USER_AGENT },
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
