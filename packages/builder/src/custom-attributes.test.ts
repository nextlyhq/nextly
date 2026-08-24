/**
 * What the attributes editor accepts, and what it refuses to accept silently.
 *
 * The security decision is NOT here: `blocks-react` owns the render-safe set
 * and is tested there. What is only true here is that the editor asks that same
 * question rather than keeping a second copy — so these tests drive the real
 * predicate through the real export, and a divergence between the two shows up
 * as a failure rather than as an attribute that saves and never renders.
 *
 * @module custom-attributes.test
 */
import { isAllowedAttribute } from "@nextlyhq/blocks-react";
import { describe, expect, it } from "vitest";

import {
  attributeKey,
  problemMessage,
  rowProblem,
  rowsOf,
  storedAttributes,
  type AttributeRow,
} from "./custom-attributes";

const row = (name: string, value = "x"): AttributeRow => ({ name, value });

describe("the editor asks the renderer, and does not restate it", () => {
  it("accepts exactly what the renderer accepts", () => {
    /*
     * Driven through the RENDERER's own predicate rather than a list written
     * here. A list would pass on the day it was written and drift afterwards,
     * which is the failure this arrangement exists to prevent — and it would
     * drift silently, because the editor is where an author is told and the
     * renderer is where the value is dropped.
     */
    for (const name of [
      "data-analytics",
      "aria-label",
      "role",
      "title",
      "lang",
      "dir",
      "id",
      "onclick",
      "href",
      "src",
      "style",
      "class",
      "srcdoc",
    ]) {
      const refused = rowProblem([row(name)], 0, "") !== undefined;
      expect(refused, name).toBe(!isAllowedAttribute(name));
    }
  });

  it("has something to test", () => {
    // The control on the loop above: if the predicate accepted everything, or
    // refused everything, that assertion would hold vacuously.
    expect(isAllowedAttribute("data-x")).toBe(true);
    expect(isAllowedAttribute("onclick")).toBe(false);
  });
});

describe("two rows that are one attribute", () => {
  it("treats names differing only in capitals as the same", () => {
    // HTML attribute names are ASCII case-insensitive and the renderer
    // lowercases before writing, so these are one attribute on the page.
    expect(attributeKey("Data-X")).toBe(attributeKey("data-x"));
    const rows = [row("data-x", "first"), row("Data-X", "second")];
    expect(rowProblem(rows, 0, "")).toBeUndefined();
    expect(rowProblem(rows, 1, "")).toEqual({
      kind: "duplicate",
    });
  });

  it("reports the LOSING row, not both", () => {
    // Reporting both would leave an author with two errors and no indication
    // which value survives; the first is the one the renderer keeps.
    const rows = [row("data-x"), row("data-x")];
    const reported = rows.filter(
      (_each, index) => rowProblem(rows, index, "") !== undefined
    );
    expect(reported).toHaveLength(1);
  });
});

describe("an id the CSS id field already owns", () => {
  it("says the row will not be used", () => {
    /*
     * The renderer resolves this in favour of `cssId` and says so: the modelled
     * field wins over an attribute of the same name. That is the right
     * precedence and it is invisible from the editor — without this an author
     * types an id, sees it saved, and the page carries a different one.
     */
    const rows = [row("id", "from-the-bag")];
    expect(rowProblem(rows, 0, "from-the-field")).toEqual({
      kind: "overridden-by-css-id",
    });
  });

  it("allows the row when no CSS id is set", () => {
    // The control. `id` is on the renderer's allowlist, so the bag is a valid
    // way to set one when the dedicated field is empty.
    const rows = [row("id", "from-the-bag")];
    expect(rowProblem(rows, 0, "")).toBeUndefined();
    expect(rowProblem(rows, 0, "   ")).toBeUndefined();
  });
});

describe("what gets stored", () => {
  it("drops rows that would not reach the page", () => {
    // Storing a value the page never uses is the silent half of the problem
    // this surface exists to make loud.
    const rows = [row("data-keep", "yes"), row("onclick", "no"), row("")];
    expect(storedAttributes(rows, "")).toEqual({ "data-keep": "yes" });
  });

  it("stores NOTHING rather than an empty bag", () => {
    // So removing the last attribute leaves the node as it was before any were
    // added, rather than carrying an empty record forever.
    expect(storedAttributes([row("")], "")).toBeUndefined();
    expect(storedAttributes([], "")).toBeUndefined();
  });

  it("lowercases the stored name, as the renderer will", () => {
    expect(storedAttributes([row("Data-X", "v")], "")).toEqual({
      "data-x": "v",
    });
  });

  it("round-trips what it stored", () => {
    // The property an author actually feels: what they typed comes back.
    const rows = [row("data-b", "two"), row("data-a", "one")];
    const stored = storedAttributes(rows, "");
    expect(rowsOf(stored)).toEqual([
      { name: "data-a", value: "one" },
      { name: "data-b", value: "two" },
    ]);
  });
});

describe("what the author is told", () => {
  it("names the open prefixes rather than only refusing", () => {
    // A refusal that does not say what IS allowed leaves an author guessing at
    // an allowlist they cannot see.
    const said = problemMessage({ kind: "not-allowed" });
    expect(said).toContain("data-");
    expect(said).toContain("aria-");
  });

  it("tells the author how to resolve an overridden id", () => {
    expect(problemMessage({ kind: "overridden-by-css-id" })).toContain(
      "CSS id"
    );
  });
});
