/**
 * The links into the published docs that name a section, held to the docs
 * this repository publishes: a renamed heading moves its anchor, and the
 * link then opens the top of the page with nothing to say it went wrong.
 *
 * @module docs-links.test
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BACKGROUND_JOBS_DOCS_HREF,
  HOW_TEXT_WORKS_DOCS_HREF,
} from "./docs-links";

/** The repository's `docs/` folder, which the site publishes. */
const DOCS = fileURLToPath(new URL("../../../docs/", import.meta.url));

/** The headings of a published page, as written. */
function headingsIn(page: string): string[] {
  const source = readFileSync(`${DOCS}${page}/index.mdx`, "utf8");
  return [...source.matchAll(/^#{2,6}\s+(.+)$/gm)].map(match =>
    (match[1] ?? "").trim()
  );
}

/**
 * The one heading a link's anchor names, and only where every common
 * slugger gives the same id: a heading of plain letters, digits and spaces,
 * whose id is its words lowercased and joined by hyphens, appearing once (a
 * second would be given a numbered id). The docs site is rendered elsewhere,
 * so this asks no more of its slugger than that; a heading that gains
 * punctuation, inline markup or a twin fails here, to be looked at, rather
 * than being judged by a guess at the renderer's rules.
 */
function headingNamedBy(page: string, anchor: string): string[] {
  return headingsIn(page).filter(
    heading =>
      /^[A-Za-z0-9 ]+$/.test(heading) &&
      heading.toLowerCase().split(/ +/).join("-") === anchor
  );
}

describe("links to a section of the docs", () => {
  it("points the background jobs link at a heading the jobs page has", () => {
    const url = new URL(BACKGROUND_JOBS_DOCS_HREF);
    expect(url.pathname).toBe("/docs/jobs");
    expect(headingNamedBy("jobs", url.hash.slice(1))).toEqual([
      "Running the queue",
    ]);
  });
});

describe("links to a page of the docs", () => {
  it("points How text works at the page the docs publish, listed in its section", () => {
    const url = new URL(HOW_TEXT_WORKS_DOCS_HREF);
    expect(url.pathname).toBe("/docs/page-builder/how-text-works");
    expect(url.hash).toBe("");
    // The page is a file of the Page Builder section, named by the path's
    // last part, and the section's list includes it, so the site renders it.
    const page = `${DOCS}page-builder/how-text-works.mdx`;
    expect(existsSync(page)).toBe(true);
    expect(readFileSync(page, "utf8")).toMatch(/^title: How text works$/m);
    const meta = JSON.parse(
      readFileSync(`${DOCS}page-builder/meta.json`, "utf8")
    ) as { pages: string[] };
    expect(meta.pages).toContain("how-text-works");
  });
});
