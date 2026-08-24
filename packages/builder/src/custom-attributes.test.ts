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
  domIdsTaken,
  htmlUpdate,
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

describe("names the editor needs for itself", () => {
  it("refuses the canvas markers, which the RENDERER has no reason to refuse", () => {
    /*
     * Both are `data-` attributes, so the render-safe rule admits them — rightly,
     * because on a published page they are ordinary author data. They are not
     * ordinary in the editor: the canvas reads one to decide which block was
     * clicked and treats the other as its own chrome, so a block carrying
     * either sends a click to the wrong block or swallows it.
     */
    for (const name of ["data-nx-node", "data-nx-chrome"]) {
      // The control: the renderer DOES allow it, so this refusal is the
      // editor's own narrowing rather than the shared rule showing through.
      expect(isAllowedAttribute(name), name).toBe(true);
      expect(rowProblem([row(name)], 0, ""), name).toEqual({
        kind: "reserved",
      });
    }
  });

  it("still allows an ordinary data attribute", () => {
    // The control that stops the reservation swallowing the namespace it sits
    // in: `data-` is the feature, and only these two names are taken.
    expect(rowProblem([row("data-nx-something-else")], 0, "")).toBeUndefined();
    expect(rowProblem([row("data-analytics")], 0, "")).toBeUndefined();
  });
});

describe("an id another block already uses", () => {
  it("refuses it, and says why two would be a problem", () => {
    const taken = new Set(["hero"]);
    expect(rowProblem([row("id", "hero")], 0, "", taken)).toEqual({
      kind: "duplicate-dom-id",
    });
    expect(problemMessage({ kind: "duplicate-dom-id" })).toContain(
      "two possible targets"
    );
  });

  it("allows an id nobody else holds", () => {
    // The control: the check must be about THIS value, not about ids in general.
    expect(
      rowProblem([row("id", "unique")], 0, "", new Set(["hero"]))
    ).toBeUndefined();
  });
});

describe("which ids a document already holds", () => {
  const node = (over: Record<string, unknown>): never =>
    ({ id: "n", type: "acme/x", version: 1, props: {}, ...over }) as never;

  it("reads BOTH the modelled field and the attribute bag", () => {
    // They become the same page-wide identifier, so a check reading one of them
    // would let the other collide silently.
    const taken = domIdsTaken(
      [
        node({ id: "b", cssId: "from-field" }),
        node({ id: "c", attributes: { id: "from-bag" } }),
      ],
      "a"
    );
    expect([...taken].sort()).toEqual(["from-bag", "from-field"]);
  });

  it("skips the node being edited, and descends into slots", () => {
    const taken = domIdsTaken(
      [
        node({ id: "a", cssId: "mine" }),
        node({
          id: "b",
          slots: { main: [node({ id: "d", cssId: "nested" })] },
        }),
      ],
      "a"
    );
    // Its own id is not a collision with itself.
    expect(taken.has("mine")).toBe(false);
    // And a block inside a slot is still on the page.
    expect(taken.has("nested")).toBe(true);
  });
});

describe("the op that stores the two fields", () => {
  const fields = (
    cssId: string,
    attributes?: Record<string, string>
  ): { cssId: string; attributes: Record<string, string> | undefined } => ({
    cssId,
    attributes,
  });

  it("says nothing when nothing changed", () => {
    // An op that rewrites a value to itself is an undo entry that undoes
    // nothing, and an author pressing undo gets a step that does nothing.
    expect(
      htmlUpdate(fields("hero", { a: "1" }), fields("hero", { a: "1" }))
    ).toBeUndefined();
    expect(htmlUpdate(fields(""), fields(""))).toBeUndefined();
  });

  it("UNSETS rather than patching undefined", () => {
    /*
     * `applyOp` refuses `undefined` as a patch value and says why: the key
     * disappears when the op is stored, so a replayed edit would do nothing.
     */
    expect(htmlUpdate(fields(""), fields("hero"))).toEqual({
      patch: {},
      unset: ["cssId"],
    });
    expect(htmlUpdate(fields("hero"), fields("hero", { a: "1" }))).toEqual({
      patch: {},
      unset: ["attributes"],
    });
  });

  it("does not unset a field the node never had", () => {
    // Setting an id on a block with no attributes must not carry an instruction
    // to remove attributes it does not have.
    expect(htmlUpdate(fields("hero"), fields(""))).toEqual({
      patch: { cssId: "hero" },
      unset: [],
    });
  });

  it("writes both when both changed", () => {
    expect(htmlUpdate(fields("hero", { a: "1" }), fields("old"))).toEqual({
      patch: { cssId: "hero", attributes: { a: "1" } },
      unset: [],
    });
  });
});
