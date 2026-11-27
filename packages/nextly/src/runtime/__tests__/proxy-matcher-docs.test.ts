/**
 * The matcher the docs tell a site to write out in `proxy.ts` is the one the
 * Proxy is built for: Next.js refuses an imported matcher, so each page
 * copies the pattern, and this holds every copy to `nextlyProxyMatcher`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { nextlyProxyMatcher } from "../proxy";

/** The docs pages that show a site's `proxy.ts`. */
const PAGES = ["plugins/proxy.mdx", "plugins/seo.mdx"];

/** Every matcher a page's code samples write out, as the strings they hold. */
function matchersIn(page: string): string[][] {
  const text = readFileSync(
    fileURLToPath(new URL(`../../../../../docs/${page}`, import.meta.url)),
    "utf8"
  );
  const found: string[][] = [];
  for (const match of text.matchAll(
    /matcher:\s*\[([\s\S]*?)\]\s*,?\s*\n\s*\}/g
  )) {
    const listed = match[1] ?? "";
    // Each entry is a TypeScript string literal, read as the compiler does.
    found.push(
      [...listed.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(
        entry => JSON.parse(`"${entry[1] ?? ""}"`) as string
      )
    );
  }
  return found;
}

describe("the matcher the docs write out", () => {
  it.each(PAGES)("is nextlyProxyMatcher wherever %s shows proxy.ts", page => {
    const matchers = matchersIn(page);
    expect(matchers.length).toBeGreaterThan(0);
    for (const matcher of matchers) {
      expect(matcher).toEqual([...nextlyProxyMatcher]);
    }
  });
});
