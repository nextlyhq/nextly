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

import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import type { DocumentLimits } from "@nextlyhq/blocks-engine";

import { pagesCollection } from "./pages";

/**
 * The declared `beforeChange` handlers, as the registry would run them.
 *
 * `rest` carries the parts of the context the handler reads besides `data` —
 * `operation`, and the `originalData` the update paths supply from the row
 * being changed. Omitting them models a context that carries neither, which is
 * the case the handler must refuse to derive from rather than guess at.
 */
function runBeforeChange(
  data: unknown,
  rest: Record<string, unknown> = {},
  limits?: DocumentLimits
): unknown {
  const hooks = (
    pagesCollection(undefined, limits) as unknown as {
      hooks?: { beforeChange?: ((context: unknown) => unknown)[] };
    }
  ).hooks;
  const handlers = hooks?.beforeChange ?? [];
  expect(handlers.length).toBeGreaterThan(0);
  let current = data;
  for (const handler of handlers) current = handler({ ...rest, data: current });
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

  it("derives from the STORED document when the write does not carry one", () => {
    // A patch touching only the title must not derive an empty list from a
    // `content` this write never had — which would silently orphan every class
    // the page really uses. The stored row is what the update paths pass as
    // `originalData`, so it can answer instead of the write being guessed at.
    //
    // The list supplied by the caller disagrees with the stored document on
    // purpose: the derived answer must win, or a caller could set this field to
    // whatever it liked by omitting `content`.
    const patch = { title: "Renamed", usedClasses: ["forged"] };

    expect(
      runBeforeChange(patch, {
        operation: "update",
        originalData: {
          title: "Home",
          content: {
            nodes: [{ id: "n1", classes: ["hero", "card"] }],
          },
        },
      })
    ).toEqual({ title: "Renamed", usedClasses: ["card", "hero"] });
  });

  it("reads a stored document that arrives as a JSON STRING", () => {
    // Which shape comes back is a property of the dialect, not of the data: the
    // runtime schema builds this column as `jsonb`/`json` on Postgres and
    // MySQL, whose drivers parse it, and as plain `text` on SQLite, whose
    // driver does not. A reader that handled only the parsed shape would report
    // every page on SQLite as referencing nothing.
    // Carries a CLAIM about the field — as a rebuild write does — which is what
    // sends the hook to the stored document rather than leaving the write alone.
    const patch: Record<string, unknown> = {
      title: "Renamed",
      usedClasses: ["stale"],
    };

    runBeforeChange(patch, {
      operation: "update",
      originalData: {
        content: JSON.stringify({ nodes: [{ id: "n1", classes: ["hero"] }] }),
      },
    });

    expect(patch.usedClasses).toEqual(["hero"]);
  });

  it("REMOVES the field when nothing in the write can be derived from", () => {
    // Removing the key is what "leave the stored record as it is" means on a
    // partial update: an absent field is not written. Assigning an empty list
    // would RECORD that the page references nothing, and under-counting is the
    // direction that gets a live class deleted.
    //
    // Keeping the caller's value would be worse still — this field is writable
    // by anyone who may update the page, so a value the hook did not derive is
    // unverified whoever sent it.
    const patch: Record<string, unknown> = {
      title: "Renamed",
      usedClasses: ["forged"],
    };

    runBeforeChange(patch, { operation: "update" });

    expect("usedClasses" in patch).toBe(false);
    expect(patch).toEqual({ title: "Renamed" });
  });

  it("leaves a write that claims NOTHING about the field completely alone", () => {
    // Publishing an accumulated draft is this shape: the caller sends `status`
    // by itself. The mutation service runs this hook first and then folds the
    // promoted draft UNDER the post-hook payload, so anything written here
    // replaces the record the draft accumulated — and the draft's record was
    // derived from the very content being published, which this hook cannot
    // see, because `originalData` is the outgoing LIVE row.
    //
    // Deriving from the stored document here would therefore publish the OLD
    // page's class list against the NEW page's content, on the most ordinary
    // path there is. Absence is the only correct answer.
    const publish: Record<string, unknown> = { status: "published" };

    runBeforeChange(publish, {
      operation: "update",
      originalData: {
        content: { nodes: [{ id: "n1", classes: ["from-the-old-live-row"] }] },
      },
    });

    expect("usedClasses" in publish).toBe(false);
    expect(publish).toEqual({ status: "published" });
  });

  it("records an empty list for an ORDINARY content-free create", () => {
    // The payload a REST or Direct API caller actually sends: no document, and
    // no mention of the bookkeeping field. A new empty page references nothing,
    // and that is a derived answer — recording it is what distinguishes the
    // page from one predating the field, which blocks deletion until a rebuild.
    //
    // Distinct from the case below, whose payload carries a forged value and so
    // cannot show that an untouched payload reaches this branch at all.
    const data: Record<string, unknown> = { title: "New" };

    runBeforeChange(data, { operation: "create" });

    expect(data.usedClasses).toEqual([]);
  });

  it("records nothing for a page CREATED without a document", () => {
    // Distinguished from the case above: a create has no stored row to fall
    // back to, and a page with no document genuinely references nothing. That
    // is a derived answer rather than an absent one, so it is written.
    const data: Record<string, unknown> = {
      title: "New",
      usedClasses: ["forged"],
    };

    runBeforeChange(data, { operation: "create" });

    expect(data.usedClasses).toEqual([]);
  });

  it("derives under the LIMITS it was configured with, and records nothing past them", () => {
    // Two properties in one document, because they are the same mechanism seen
    // from either side.
    //
    // The limits ARE threaded: the same page yields a record under the engine
    // defaults and none under a bound that truncates it. And a truncated
    // derivation is not written at all — the list would be a PREFIX of the
    // answer, and a delete check reads a missing id as evidence the class is
    // unused, which is exactly the deletion the record exists to prevent.
    //
    // Note the two cannot be separated: any bound that CHANGES the outcome is
    // by definition one that stopped the walk. A test asserting "the lowered
    // bound found fewer classes" would be asserting a state this hook refuses
    // to record.
    const deepPage = () => {
      let nested: Record<string, unknown> = {
        id: "deep",
        type: "core/text",
        version: 1,
        props: {},
        classes: ["deep-class"],
      };
      for (let i = 0; i < 3; i++) {
        nested = {
          id: `wrap-${i}`,
          type: "core/box",
          version: 1,
          props: {},
          classes: [`wrap-${i}`],
          slots: { main: [nested] },
        };
      }
      return { title: "Home", content: { nodes: [nested] } } as Record<
        string,
        unknown
      >;
    };

    // Truncated by a depth bound the document exceeds: the record is written
    // as UNKNOWN rather than omitted. Omitting only leaves the payload without
    // it, and on an update the row would keep the PREVIOUS content's list —
    // stale, and presented as current.
    const truncated = deepPage();
    runBeforeChange(truncated, {}, { ...DEFAULT_LIMITS, maxDepth: 2 });
    expect(truncated.usedClasses).toBeNull();

    // The control: the SAME document under the engine defaults is read whole,
    // so a record is written and carries the deepest class. Without this, a
    // hook that recorded nothing under any circumstances would pass above.
    const whole = deepPage();
    runBeforeChange(whole, {});
    expect(whole.usedClasses).toContain("deep-class");
    expect(whole.usedClasses).toContain("wrap-0");
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

describe("a document the derivation cannot read", () => {
  it("marks the record UNKNOWN rather than guessing or failing the save", () => {
    // Three mistakes are available and they pull in different directions:
    // failing an author's save over a bookkeeping field, recording a list that
    // is wrong, and storing one the hook did not derive. Writing `null` avoids
    // all three — and avoids a fourth that omitting the field does not, since
    // an omitted field leaves the row holding the PREVIOUS content's list while
    // the content it describes has just changed.
    const unreadable = {
      get nodes(): never {
        throw new Error("cannot read this document");
      },
    };
    const data: Record<string, unknown> = {
      title: "Home",
      content: unreadable,
      usedClasses: ["hero"],
    };

    expect(() => runBeforeChange(data, { operation: "update" })).not.toThrow();
    // Explicitly unknown, not merely omitted: the row must not keep the value
    // the caller sent, nor the one it already held.
    expect(data.usedClasses).toBeNull();
  });

  it("still derives from a document it CAN read, so the guard is not swallowing everything", () => {
    // The control. A hook that caught unconditionally and never wrote would
    // satisfy the case above while recording nothing for any page.
    const data: Record<string, unknown> = {
      title: "Home",
      content: { nodes: [{ id: "n1", classes: ["hero"] }] },
      usedClasses: ["stale"],
    };

    runBeforeChange(data);

    expect(data.usedClasses).toEqual(["hero"]);
  });
});
