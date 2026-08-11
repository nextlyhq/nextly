/**
 * A public route's trust bound must reach EVERY read the route performs, not
 * only the one a fix was written against.
 *
 * There are four, and they do not share a path:
 *
 * 1. the render read, through `resolveContent`
 * 2. the metadata read, through the same
 * 3. the draft grant's by-id re-read, INSIDE `resolveContent`
 * 4. **`generateStaticParams`, which calls `find` DIRECTLY** and never touches
 *    `resolveContent` at all
 *
 * The fourth is why this file exists. It is the PRE-RENDERING path: what it
 * reads is written into a static artifact, served to everyone, and outlives the
 * source row being unpublished. A previous fix on this route asserted only
 * through the page component, looked complete, and left this path open.
 *
 * Asserted on the source rather than by rendering, because the difference is
 * invisible to a unit harness: a read missing the bound returns the same rows
 * unless a target collection actually holds a restricted or unpublished row, so
 * a behavioural test passes on any fixture that does not have one — which is
 * the fixture most people write.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROUTING = join(__dirname, "..");

function source(file: string): string {
  return readFileSync(join(ROUTING, file), "utf8");
}

/** How many reads a routing module issues, and how many carry the bound. */
function reads(file: string): { issued: number; bounded: number } {
  const text = source(file);
  return {
    issued: [...text.matchAll(/\.(find|findByID)\(\{/g)].length,
    // The pass-through form only. A `trusted?:` in a doc block or an
    // interface is a declaration, not a read carrying the bound.
    bounded: [...text.matchAll(/^\s*(trusted|trustedCollections)[,:][^?]*$/gm)]
      .length,
  };
}

describe("the trust bound reaches every read a route performs", () => {
  it("is exercised — the route module issues reads at all", () => {
    // Without this, the assertions below pass against zero matches, which is
    // the shape of a guard that reports success because it found nothing.
    expect(reads("content-route.ts").issued).toBeGreaterThanOrEqual(1);
    expect(reads("resolve-content.ts").issued).toBeGreaterThanOrEqual(3);
  });

  it("carries the bound on the static-params scan, not only the render", () => {
    // The specific regression: `generateStaticParams` builds its query inline
    // instead of calling `resolveContent`, so it is missed by any fix applied
    // to the shared helper.
    const text = source("content-route.ts");
    const scan = text.slice(
      text.indexOf("async function generateStaticParams")
    );
    expect(scan).toContain("nextly.find({");
    expect(
      /\btrusted,/.test(scan.slice(0, scan.indexOf("} catch"))),
      "generateStaticParams reads without the trust bound. It PRE-RENDERS, so " +
        "what it pulls in through a relationship is written to a static " +
        "artifact and outlives the row being unpublished."
    ).toBe(true);
  });

  it("carries the bound on every read resolveContent issues", () => {
    // Includes the by-id re-read a draft grant triggers, which is a distinct
    // entry point into the same expansion and reached only on the preview path.
    // One bound per read, counted rather than parsed around: the number of
    // reads is small, known, and the thing that changes when someone adds a
    // fifth entry point without threading it.
    const { issued, bounded } = reads("resolve-content.ts");
    expect(
      bounded,
      `resolveContent issues ${issued} reads but only ${bounded} carry the ` +
        "trust bound. A read that forwards the access override without it " +
        "reads every populated target trusted."
    ).toBe(issued);
  });
});
