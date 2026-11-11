/**
 * The checks made across the site rather than on one page: a title or
 * description shared by pages, a missing production address, and a content
 * type SEO is added to whose pages have no public address. Pure: what each
 * is judged from is gathered elsewhere.
 *
 * @module problems/site-checks
 */
import { WHOLE_SITE, type Problem, type ProblemSubject } from "./contract";

/** A page as the last check left it: what it is, and its title and description. */
export interface CheckedPage {
  subject: ProblemSubject;
  title?: string;
  description?: string;
}

/**
 * A value as two pages are compared by: trimmed, its runs of spacing made
 * one, and in lower case, since a reader sees those as the same title.
 */
function compared(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** `also on A`, `also on A and 2 other pages`: who else has the value. */
function alsoOn(others: readonly CheckedPage[]): string {
  const [first] = others;
  if (first === undefined) return "";
  const rest = others.length - 1;
  return rest === 0
    ? `also on ${first.subject.label}`
    : `also on ${first.subject.label} and ${rest} other ${rest === 1 ? "page" : "pages"}`;
}

/** The pages with a value for `key`, grouped by that value as compared. */
function groupedBy(
  pages: readonly CheckedPage[],
  key: "title" | "description"
): CheckedPage[][] {
  const groups = new Map<string, CheckedPage[]>();
  for (const page of pages) {
    const value = page[key];
    if (value === undefined || value.trim() === "") continue;
    const group = groups.get(compared(value)) ?? [];
    group.push(page);
    groups.set(compared(value), group);
  }
  return [...groups.values()];
}

/** How each value a page shares is reported and fixed. */
const SHARED = {
  title: {
    kind: "sharedTitle",
    label: "Title",
    action: "Change the title",
    field: "metaTitle",
  },
  description: {
    kind: "sharedDescription",
    label: "Description",
    action: "Change the description",
    field: "metaDescription",
  },
} as const;

/** The pages sharing one of `key`'s values, each told who else has it. */
function shared(
  pages: readonly CheckedPage[],
  key: "title" | "description"
): Problem[] {
  const words = SHARED[key];
  return groupedBy(pages, key)
    .filter(group => group.length > 1)
    .flatMap(group =>
      group.map(page => ({
        kind: words.kind,
        subject: page.subject,
        what: `${words.label}: “${page[key]}”, ${alsoOn(group.filter(other => other !== page))}`,
        action: words.action,
        fix: {
          place: "page" as const,
          tab: "seo" as const,
          field: words.field,
        },
      }))
    );
}

/** Every page sharing a title or description with another. */
export function sharedValueProblems(pages: readonly CheckedPage[]): Problem[] {
  return [...shared(pages, "title"), ...shared(pages, "description")];
}

/** How a site with no production address is served. */
export type Standing = "listable" | "guarded" | undefined;

/** The site's missing production address, where it has none. */
export function productionAddressProblems(
  addresses: readonly string[],
  standing: Standing
): Problem[] {
  if (addresses.length > 0) return [];
  const effect =
    standing === "guarded"
      ? "No production address is saved. Until it is, every page asks search engines to stay away."
      : "No production address is saved, so copies of the site can show up in search.";
  return [
    {
      kind: "productionAddress",
      subject: WHOLE_SITE,
      what: `${effect} Save the address people visit in SEO settings, or set NEXTLY_PRODUCTION_ADDRESSES on the server.`,
      action: "Set the address",
      fix: { place: "settings", tab: "general" },
    },
  ];
}

/** A content type SEO is added to whose pages have no public address. */
export interface TypeWithoutAddress {
  /** Its key: the collection's slug. */
  key: string;
  label: string;
  /** How many entries it holds. */
  entries: number;
  /** Declared in code, where its address is declared too. */
  inCode: boolean;
}

/** Each content type whose pages have no public address. */
export function noAddressProblems(
  types: readonly TypeWithoutAddress[]
): Problem[] {
  return types.map(type => ({
    kind: "noAddress",
    subject: {
      type: type.key,
      label: type.label,
      detail: `${type.entries} ${type.entries === 1 ? "entry" : "entries"}`,
    },
    what: "No public address, so these pages have no official address and aren't in the sitemap",
    // A type declared in code declares its address there; one made in the
    // Schema Builder takes it from the SEO settings.
    ...(type.inCode
      ? {
          action: "Copy a note for a developer",
          fix: {
            place: "developer" as const,
            note: `The ${type.key} collection has no public address. Add one to its config, such as publicAddress: "/${type.key}/{slug}".`,
          },
        }
      : {
          action: "Set an address",
          fix: { place: "settings" as const, tab: "types" as const },
        }),
  }));
}

/** A redirect whose To address is itself redirected, and where that goes. */
export interface RedirectChain {
  source: string;
  target: string;
  end: string;
}

/** Each redirect that takes more than one hop. */
export function redirectChainProblems(
  chains: readonly RedirectChain[]
): Problem[] {
  return chains.map(chain => ({
    kind: "redirectChain",
    subject: { label: chain.source },
    what: `${chain.source} → ${chain.target} → ${chain.end}`,
    action: "Copy a note for a developer",
    // Saving the redirect again follows its chain to the end, which is what
    // a person fixes it with; until the redirects screen offers that, a
    // developer does it.
    fix: {
      place: "developer",
      note: `Point ${chain.source} straight at ${chain.end}: its redirect now passes through ${chain.target} first. Saving the redirect again does this.`,
    },
  }));
}
