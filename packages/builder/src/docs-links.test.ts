/**
 * The links into the published docs that name a section, held to the docs
 * this repository publishes: a renamed heading moves its anchor, and the
 * link then opens the top of the page with nothing to say it went wrong.
 *
 * @module docs-links.test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BACKGROUND_JOBS_DOCS_HREF } from "./docs-links";

/** The repository's `docs/` folder, which the site publishes. */
const DOCS = fileURLToPath(new URL("../../../docs/", import.meta.url));

/** A heading's anchor as the docs site writes it. */
function anchorOf(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

/** The anchors of a published page's headings. */
function anchorsIn(page: string): string[] {
  const source = readFileSync(`${DOCS}${page}/index.mdx`, "utf8");
  return [...source.matchAll(/^#{2,6}\s+(.+)$/gm)].map(match =>
    anchorOf(match[1] ?? "")
  );
}

describe("links to a section of the docs", () => {
  it("points the background jobs link at a heading the jobs page has", () => {
    const url = new URL(BACKGROUND_JOBS_DOCS_HREF);
    expect(url.pathname).toBe("/docs/jobs");
    expect(anchorsIn("jobs")).toContain(url.hash.slice(1));
  });
});
