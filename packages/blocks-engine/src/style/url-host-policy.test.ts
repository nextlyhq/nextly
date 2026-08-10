/**
 * Every place a stored style value can name a host, and whether the site's host
 * policy is asked about it.
 *
 * The positions are DERIVED from the catalog rather than listed here. A written
 * list is a snapshot: the property added next month is not in it, its leaf is
 * never exercised, and the suite still reports full coverage. Walking the
 * catalog means a new URL-bearing leaf joins these assertions by existing.
 */
import { describe, expect, it } from "vitest";

import { STYLE_CATALOG } from "./catalog";
import type { StyleShape } from "./catalog-types";
import { compilePageCss } from "./compile-page";
import type { BlockDocument } from "../document";
import { DOCUMENT_FORMAT_VERSION } from "../document";

/** A value the leaf will accept, carrying `url` at the given host. */
type UrlWriter = (url: string) => unknown;

/**
 * One writer per URL-bearing LEAF in this shape, each placing the URL at that
 * leaf and nowhere else.
 *
 * Per leaf rather than per property, because a property can hold several: the
 * background object carries a `url` beside two free-form values, and a walk
 * that stopped at the first would leave the other two never exercised while
 * still reporting the property covered.
 */
function urlWriters(shape: StyleShape): UrlWriter[] {
  switch (shape.kind) {
    case "url":
      return [url => url];
    case "cssValue":
      return [url => `url("${url}")`];
    case "logicalSides":
      return nested(shape.sides);
    case "logicalCorners":
      return nested(shape.corners);
    case "object":
      return nested(shape.fields);
    case "union":
      // Each variant separately: they are alternative spellings of the same
      // value, and a leaf reachable only through the second is still reachable.
      return shape.of.flatMap(urlWriters);
    default:
      return [];
  }
}

/** Writers for every URL-bearing leaf under a record of named members. */
function nested(members: Readonly<Record<string, StyleShape>>): UrlWriter[] {
  return Object.entries(members).flatMap(([name, inner]) =>
    urlWriters(inner).map(write => (url: string) => ({ [name]: write(url) }))
  );
}

/** Every leaf in the catalog that can carry a URL, with how to put one there. */
const URL_BEARING = STYLE_CATALOG.flatMap(entry =>
  urlWriters(entry.shape).map((write, leaf) => ({
    property: entry.property,
    leaf,
    write,
  }))
);

const ALLOWED = "https://cdn.allowed.test/a.png";
const REFUSED = "https://cdn.refused.test/a.png";

function compile(
  property: string,
  value: unknown,
  host?: (url: string) => boolean
) {
  const doc: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "n1",
        type: "core/text",
        version: 1,
        props: {},
        styles: { base: { base: { [property]: value } } },
      },
    ],
  };
  return compilePageCss(doc, {
    breakpoints: { base: {} },
    ...(host === undefined ? {} : { mayFetchUrl: host }),
  });
}

describe("style values that name a host", () => {
  it("finds the URL-bearing leaves rather than trusting a written list", () => {
    // The precondition for everything below. Were the walk to return nothing —
    // a renamed shape kind, a restructured catalog — every `it.each` beneath it
    // would run zero cases and the file would report success having asserted
    // nothing at all.
    expect(URL_BEARING.length).toBeGreaterThanOrEqual(15);
    const kinds = new Set(
      STYLE_CATALOG.filter(entry =>
        URL_BEARING.some(found => found.property === entry.property)
      ).map(entry => entry.shape.kind)
    );
    // Both leaf kinds that reach `checkUrlValue` are represented, so a policy
    // wired to one route and not the other cannot pass this file.
    expect(kinds.size).toBeGreaterThan(1);
  });

  it.each(URL_BEARING)(
    "$property leaf $leaf does not emit a refused host",
    ({ property, write }) => {
      const refused = compile(
        property,
        write(REFUSED),
        url => !url.includes("refused")
      );
      expect(refused.css).not.toContain("cdn.refused.test");

      // The positive control, in the SAME position. Without it a compiler that
      // emitted nothing at all for this property — a shape this test writes
      // wrongly, a property behind a `supports` flag — would pass the assertion
      // above by writing no CSS whatsoever.
      const allowed = compile(
        property,
        write(ALLOWED),
        url => !url.includes("refused")
      );
      expect(allowed.css).toContain("cdn.allowed.test");
    }
  );

  it.each(URL_BEARING)(
    "$property leaf $leaf is unrestricted when no policy is supplied",
    ({ property, write }) => {
      // Absent means unasked, not allowed-nothing. A caller with no host policy
      // must compile exactly as it did before the policy existed.
      const compiled = compile(property, write(REFUSED));
      expect(compiled.css).toContain("cdn.refused.test");
    }
  );

  it("refuses a protocol-relative URL, which carries no scheme but names a host", () => {
    // The case the scheme allowlist cannot see: `//host/x` has no scheme to
    // reject and still reaches somewhere other than this origin.
    const entry = URL_BEARING[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    const compiled = compile(
      entry.property,
      entry.write("//cdn.refused.test/a.png"),
      () => false
    );
    expect(compiled.css).not.toContain("cdn.refused.test");
  });
});
