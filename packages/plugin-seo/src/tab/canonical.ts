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
import { usableCanonical } from "../resolver/order";

/** What a typed address is. */
export type CanonicalCheck =
  | { kind: "empty" }
  /** Not an address that can be used, and why, in one sentence. */
  | { kind: "bad"; message: string }
  /** An address on this site. */
  | { kind: "same" }
  /** A complete address on another site. */
  | { kind: "elsewhere"; host: string };

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
  if (/\s/.test(typed)) {
    return { kind: "bad", message: "An address can't contain spaces." };
  }
  // A path from the site's root is on the site by construction.
  if (typed.startsWith("/") && !typed.startsWith("//")) {
    return usableCanonical(typed) === undefined
      ? { kind: "bad", message: "That isn't an address on this site." }
      : { kind: "same" };
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(typed);
  if (scheme !== null && !/^https?$/i.test(scheme[1] ?? "")) {
    return {
      kind: "bad",
      message:
        "Only web addresses can be used here, starting with https:// (or http://).",
    };
  }
  if (!/^https?:\/\//i.test(typed)) {
    return {
      kind: "bad",
      message: "Enter the full address, starting with https://.",
    };
  }
  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    return incomplete();
  }
  const host = url.hostname.toLowerCase();
  if (host === "") return incomplete();
  if (url.username !== "" || url.password !== "") {
    return {
      kind: "bad",
      message: "Remove the sign-in details from the address.",
    };
  }
  const onSite = siteHosts.includes(host);
  if (!onSite && (!host.includes(".") || host.endsWith("."))) {
    return {
      kind: "bad",
      message: `The address is missing the site's name, like ${siteHosts[0] ?? "example.com"}.`,
    };
  }
  if (usableCanonical(typed) === undefined) return incomplete();
  return onSite ? { kind: "same" } : { kind: "elsewhere", host };
}

/** The refusal for something that is not a whole address. */
function incomplete(): CanonicalCheck {
  return {
    kind: "bad",
    message:
      "That isn't a complete web address. Check it starts with https:// and then names a site.",
  };
}

/** What the `seo` group stores for a typed address. */
export interface StoredCanonical {
  /** The address, trimmed; nothing where it cannot be used at all. */
  canonical: string | null;
  /**
   * Whether the person confirmed the page lives on another site, which the
   * resolver requires before it uses an address there. Set only for an
   * address elsewhere that was confirmed.
   */
  canonicalElsewhere: true | null;
}

/**
 * What the `seo` group stores for the typed address. An address on another
 * site is stored as typed, and used only once `confirmedElsewhere` is set
 * with it, so the automatic address stays in use until the person confirms.
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
  if (check.kind === "elsewhere") {
    return {
      canonical: raw.trim(),
      canonicalElsewhere: confirmedElsewhere ? true : null,
    };
  }
  return { canonical: null, canonicalElsewhere: null };
}
