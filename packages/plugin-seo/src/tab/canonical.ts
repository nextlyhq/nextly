/**
 * Whether a person's typed official address (the canonical) can be used, and
 * what is stored for it.
 *
 * An address on the site is used as typed. One on another site makes search
 * engines credit that site instead, so it is stored only once the person
 * confirms the page lives there; until then the automatic address stays in
 * use. What counts as an address a search engine can follow at all is the
 * resolver's own rule (`usableCanonical`), so the tab never stores a value
 * the page's head would pass over.
 *
 * @module tab/canonical
 */
import { usableCanonical } from "../canonical";

/** What a typed address is. */
export type CanonicalCheck =
  | { kind: "empty" }
  /** Not an address that can be used, and why, in one sentence. */
  | { kind: "bad"; message: string }
  /** An address on this site. */
  | { kind: "same" }
  /** A complete address on another site. */
  | { kind: "elsewhere"; host: string };

/** A refusal, in one sentence. */
function bad(message: string): CanonicalCheck {
  return { kind: "bad", message };
}

/**
 * Why the typed text is not written as a whole web address, or nothing: the
 * checks a person can fix by retyping, before the address is read.
 */
function spellingProblem(typed: string): CanonicalCheck | undefined {
  if (/\s/.test(typed)) return bad("An address can't contain spaces.");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(typed)?.[1];
  if (scheme !== undefined && !/^https?$/i.test(scheme)) {
    return bad(
      "Only web addresses can be used here, starting with https:// (or http://)."
    );
  }
  return /^https?:\/\//i.test(typed)
    ? undefined
    : bad("Enter the full address, starting with https://.");
}

/** The address read, or nothing where it is not one. */
function urlOf(typed: string): URL | undefined {
  try {
    return new URL(typed);
  } catch {
    return undefined;
  }
}

/** Where a whole address points, against the hosts the site is served from. */
function placeOf(
  url: URL,
  typed: string,
  siteHosts: readonly string[]
): CanonicalCheck {
  const host = url.hostname.toLowerCase();
  if (host === "") return incomplete();
  if (url.username !== "" || url.password !== "") {
    return bad("Remove the sign-in details from the address.");
  }
  const onSite = siteHosts.includes(host);
  if (!onSite && (!host.includes(".") || host.endsWith("."))) {
    return bad(
      `The address is missing the site's name, like ${siteHosts[0] ?? "example.com"}.`
    );
  }
  if (usableCanonical(typed) === undefined) return incomplete();
  return onSite ? { kind: "same" } : { kind: "elsewhere", host };
}

/**
 * The typed address read against the hosts the site is served from
 * (`siteHosts`, lower case, with no port).
 */
export function checkCanonical(
  raw: string,
  siteHosts: readonly string[]
): CanonicalCheck {
  const typed = raw.trim();
  if (typed === "") return { kind: "empty" };
  // A browser reads a backslash as a slash, so `/\other.example` names
  // another site while it reads as a path on this one.
  if (typed.includes("\\")) return bad("An address can't contain a backslash.");
  // A path from the site's root is on the site by construction.
  if (typed.startsWith("/") && !typed.startsWith("//") && !/\s/.test(typed)) {
    return usableCanonical(typed) === undefined
      ? bad("That isn't an address on this site.")
      : { kind: "same" };
  }
  const problem = spellingProblem(typed);
  if (problem !== undefined) return problem;
  const url = urlOf(typed);
  return url === undefined ? incomplete() : placeOf(url, typed, siteHosts);
}

/** The refusal for something that is not a whole address. */
function incomplete(): CanonicalCheck {
  return bad(
    "That isn't a complete web address. Check it starts with https:// and then names a site."
  );
}

/** What the `seo` group stores for a typed address. */
export interface StoredCanonical {
  /** The address, trimmed; nothing where it cannot be used yet. */
  canonical: string | null;
  /**
   * Whether the person confirmed the page lives on another site, which the
   * resolver requires before it uses an address there. Set only for an
   * address elsewhere that was confirmed.
   */
  canonicalElsewhere: true | null;
}

/**
 * What the `seo` group stores for the typed address: an address on the site
 * as typed, and one on another site only once the person confirms the page
 * lives there, marked so. Until then nothing is stored, so neither the
 * preview nor the page's head uses it, and the automatic address stays.
 */
export function storedCanonical(
  raw: string,
  siteHosts: readonly string[],
  confirmedElsewhere: boolean
): StoredCanonical {
  const check = checkCanonical(raw, siteHosts);
  if (check.kind === "same") {
    return { canonical: raw.trim(), canonicalElsewhere: null };
  }
  if (check.kind === "elsewhere" && confirmedElsewhere) {
    return { canonical: raw.trim(), canonicalElsewhere: true };
  }
  return { canonical: null, canonicalElsewhere: null };
}
