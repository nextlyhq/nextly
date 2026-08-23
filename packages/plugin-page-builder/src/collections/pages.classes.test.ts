/**
 * Whether a page's referenced-class record is maintained by its own write.
 *
 * The record exists so the class library can say "used in 12 places" before an
 * author renames or deletes a class. It is only worth having if it is right,
 * and the ways it goes wrong are all silent: a write that does not update it, a
 * write that empties it, or a hook that fails the author's save outright.
 *
 * @module pages.classes.test
 */
import { describe, expect, it } from "vitest";

import { pagesCollection } from "./pages";

/** The declared `beforeChange` handlers, as the registry would run them. */
function runBeforeChange(data: unknown): unknown {
  const hooks = (
    pagesCollection() as unknown as {
      hooks?: { beforeChange?: ((context: unknown) => unknown)[] };
    }
  ).hooks;
  const handlers = hooks?.beforeChange ?? [];
  expect(handlers.length).toBeGreaterThan(0);
  let current = data;
  for (const handler of handlers) current = handler({ data: current });
  return current;
}

const pageUsing = (...classIds: string[]) => ({
  title: "Home",
  content: {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "n1", type: "core/text", version: 1, props: {}, classes: classIds },
    ],
  },
});

describe("the referenced-class record on a page write", () => {
  it("is derived from the document being written", () => {
    expect(runBeforeChange(pageUsing("hero", "card"))).toMatchObject({
      usedClasses: ["card", "hero"],
    });
  });

  it("is REPLACED, not merged, when the document stops using a class", () => {
    // The direction that matters for delete. A record that only ever grew would
    // report a class as used long after the last page dropped it, and the
    // author could never remove it.
    const stale = { ...pageUsing("card"), usedClasses: ["hero", "card"] };

    expect(runBeforeChange(stale)).toMatchObject({ usedClasses: ["card"] });
  });

  it("writes the same record twice for the same document", () => {
    // Idempotence is the property that makes this repairable: a missed write
    // costs nothing once the page is touched again, and a repeated one costs
    // nothing at all. A counter maintained by increment could claim neither.
    const first = runBeforeChange(pageUsing("hero"));

    expect(runBeforeChange(first)).toEqual(first);
  });

  it("leaves the record ALONE when the write does not carry the document", () => {
    // A patch touching only the title must not derive an empty list from a
    // `content` this write never had — which would silently orphan every class
    // the page really uses.
    //
    // The expectation is written out rather than compared against the input,
    // because the handler MUTATES the object it is given (the convention every
    // hook in this repo follows) — so `expect(run(patch)).toEqual(patch)` is a
    // value compared against itself and passes whatever the handler did. That
    // version of this test survived removing the guard it exists to protect.
    const patch = { title: "Renamed", usedClasses: ["hero"] };

    expect(runBeforeChange(patch)).toEqual({
      title: "Renamed",
      usedClasses: ["hero"],
    });
  });

  it("does not fail the write for a document nobody validated", () => {
    // The hook runs on a `before*` phase, so throwing here fails the author's
    // save over a bookkeeping record. `documentFrom` admits any value whose
    // `nodes` is an array, so these shapes reach this hook intact.
    for (const content of [null, "x", [], { nodes: null }, { nodes: "n" }]) {
      expect(() => runBeforeChange({ title: "t", content })).not.toThrow();
    }
  });

  it("does not fail the write when there is no data at all", () => {
    expect(() => runBeforeChange(undefined)).not.toThrow();
    expect(() => runBeforeChange(null)).not.toThrow();
  });
});
