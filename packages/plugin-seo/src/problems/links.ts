/**
 * What a page's links reach: the pages holding each address they name, read
 * from the site's record of who holds each address, and which links lead
 * nowhere, those to an address a content type serves (`/blog/{slug}`) that
 * no page holds. One read gives both, so the link counts and the broken-link
 * check never read a page's links differently.
 *
 * Only addresses under a content type's own prefix are judged. A type served
 * from the root (`/{slug}`) shares every address with the pages a site
 * builds in code, which hold none in the record, so a link there cannot be
 * told broken from the record alone and is not reported.
 *
 * @module problems/links
 */
import { originOf } from "../origin";
import { isRecord } from "../plain-values";
import { pathOf } from "../redirects/addresses";

import { linkedPageKey } from "./link-graph";
import type { LinkFact } from "./page-checks";

/** The addresses one content type serves. */
export interface AddressShape {
  type: string;
  pattern: RegExp;
}

/** `text` as a regular expression matching it literally. */
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The addresses `template` gives, as a pattern: each placeholder one segment,
 * or one or more where `slugPaths` lets a slug span several. None for a
 * template whose first segment is a placeholder (see the module's note).
 */
function shapeOf(template: string, slugPaths: boolean): RegExp | undefined {
  const segments = template.split("/").slice(1);
  const placeholder = /^\{([^{}]+)\}$/;
  if (segments.length === 0 || placeholder.test(segments[0] ?? "")) {
    return undefined;
  }
  const parts = segments.map(segment => {
    const named = placeholder.exec(segment)?.[1];
    if (named === undefined) return literal(segment);
    return slugPaths && named === "slug" ? "[^/]+(?:/[^/]+)*" : "[^/]+";
  });
  return new RegExp(`^/${parts.join("/")}$`);
}

/**
 * The address shapes of the content types `collections` declares in code,
 * from each one's `publicAddress`.
 */
export function addressShapes(collections: readonly unknown[]): AddressShape[] {
  return collections.flatMap(collection => {
    if (!isRecord(collection)) return [];
    const { slug, publicAddress, db } = collection;
    if (typeof slug !== "string" || typeof publicAddress !== "string") {
      return [];
    }
    const pattern = shapeOf(
      publicAddress,
      isRecord(db) && db.slugPaths === true
    );
    return pattern === undefined ? [] : [{ type: slug, pattern }];
  });
}

/** What a link is judged against. */
export interface LinkJudge {
  shapes: readonly AddressShape[];
  /** Where the site itself is served, so a full address on it is judged too. */
  productionAddresses: readonly string[];
  /**
   * The origin the linking page is served on, which a path from the root is
   * read on, as a visitor's browser reads it; the first production address
   * where none is given.
   */
  origin?: string;
  /**
   * The language a request for `url` is served in and the path its pages
   * are kept at, as the site's language rule reads it; none where no
   * language serves it.
   */
  keptOf: (url: URL) => Promise<{ locale: string; path: string } | undefined>;
  /** What holds `path` in `locale`: none for an address nothing holds. */
  holders: (
    path: string,
    locale: string
  ) => Promise<readonly { collection: string; id: string }[]>;
  /**
   * The pages a request for `path`, which `holders` hold, arrives at: a
   * redirect followed to the page it sends people to, with the language it
   * is reached in where a redirect crossed into another. Each holder as it
   * is where not given.
   */
  pagesOf?: (
    holders: readonly { collection: string; id: string }[],
    locale: string,
    path: string
  ) => Promise<readonly { collection: string; id: string; locale?: string }[]>;
}

/** What a page's links reach. */
export interface LinkReading {
  /** The links to an address a content type serves that no page holds. */
  broken: LinkFact[];
  /**
   * The pages the links reach, each once, by `linkedPageKey` with the
   * language its address is served in, in the order first linked.
   */
  to: string[];
}

/** The origin a path from the root is read on where the site names none. */
const NO_ORIGIN = "https://site.invalid";

/**
 * A link as the address a visitor's request would ask for: a path from the
 * root on the linking page's origin, or a full address on one of the
 * production addresses. Nothing for any other link.
 */
function requestOf(
  url: string,
  productionAddresses: readonly string[],
  pageOrigin: string | undefined
): URL | undefined {
  const own = productionAddresses.flatMap(each => originOf(each) ?? []);
  if (url.startsWith("/") && !url.startsWith("//")) {
    return new URL(url, pageOrigin ?? own[0] ?? NO_ORIGIN);
  }
  const origin = originOf(url);
  return origin !== undefined && own.includes(origin)
    ? new URL(url)
    : undefined;
}

/** A holder of an address, as the record names it. */
type Holder = { collection: string; id: string };

/** What one link reaches: its address as kept, what holds it, and the pages. */
interface LinkTarget {
  path: string;
  holders: readonly Holder[];
  /** The pages reached, by `linkedPageKey`. */
  pages: string[];
}

/**
 * What `link` reaches on the site, or nothing for a link off it. Who holds
 * each address is asked once per language, whatever links name it, through
 * `asked`.
 */
async function targetOf(
  link: LinkFact,
  judge: LinkJudge,
  asked: Map<string, Promise<readonly Holder[]>>
): Promise<LinkTarget | undefined> {
  const request = requestOf(link.url, judge.productionAddresses, judge.origin);
  const kept = request === undefined ? undefined : await judge.keptOf(request);
  if (kept === undefined) return undefined;
  const path = pathOf(kept.path);
  const key = `${kept.locale}\u0000${path}`;
  const held = asked.get(key) ?? judge.holders(path, kept.locale);
  asked.set(key, held);
  const holders = await held;
  const pages: readonly (Holder & { locale?: string })[] = judge.pagesOf
    ? await judge.pagesOf(holders, kept.locale, path)
    : holders;
  return {
    path,
    holders,
    // In the language the page is reached in, which a redirect may change.
    pages: pages.map(page =>
      linkedPageKey(page.collection, page.id, page.locale ?? kept.locale)
    ),
  };
}

/**
 * What `links` reach: each page holding an address they name on the site,
 * and the links to an address a content type serves that no page holds in
 * the language the address is served in. Each address is asked about once
 * in each language, however many links name it.
 */
export async function readLinks(
  links: readonly LinkFact[],
  judge: LinkJudge
): Promise<LinkReading> {
  const asked = new Map<string, Promise<readonly Holder[]>>();
  const broken: LinkFact[] = [];
  const to = new Set<string>();
  for (const link of links) {
    const target = await targetOf(link, judge, asked);
    if (target === undefined) continue;
    for (const page of target.pages) to.add(page);
    // Held, by a page or a redirect sending people on, is not broken.
    const unheld = target.holders.length === 0;
    if (unheld && judge.shapes.some(shape => shape.pattern.test(target.path))) {
      broken.push(link);
    }
  }
  return { broken, to: [...to] };
}

/** The links in `links` that lead nowhere, as {@link readLinks} reads them. */
export async function brokenLinks(
  links: readonly LinkFact[],
  judge: LinkJudge
): Promise<LinkFact[]> {
  return (await readLinks(links, judge)).broken;
}
