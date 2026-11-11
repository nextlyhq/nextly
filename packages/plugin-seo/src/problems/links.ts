/**
 * Which links in a page lead nowhere: those to an address a content type
 * serves (`/blog/{slug}`) that no page holds, read from the site's record of
 * who holds each address.
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
  /** Whether a page holds `path` in the site's default language. */
  isHeld: (path: string) => Promise<boolean>;
}

/**
 * The path an address names on the site, spelled as the record keeps it
 * (encoded, without dot segments, query, fragment or trailing slash): a path
 * from the root, or a full address on one of the production addresses.
 * Nothing for any other address.
 */
export function sitePath(
  url: string,
  productionAddresses: readonly string[]
): string | undefined {
  if (url.startsWith("/") && !url.startsWith("//")) return pathOf(url);
  const origin = originOf(url);
  const own = productionAddresses.flatMap(each => originOf(each) ?? []);
  if (origin === undefined || !own.includes(origin)) return undefined;
  return pathOf(new URL(url).pathname);
}

/**
 * The links in `links` to an address a content type serves that no page
 * holds. Each address is asked about once, however many links name it.
 */
export async function brokenLinks(
  links: readonly LinkFact[],
  judge: LinkJudge
): Promise<LinkFact[]> {
  const answers = new Map<string, Promise<boolean>>();
  const broken: LinkFact[] = [];
  for (const link of links) {
    const path = sitePath(link.url, judge.productionAddresses);
    if (path === undefined) continue;
    if (!judge.shapes.some(shape => shape.pattern.test(path))) continue;
    let held = answers.get(path);
    if (held === undefined) {
      held = judge.isHeld(path);
      answers.set(path, held);
    }
    if (!(await held)) broken.push(link);
  }
  return broken;
}
