/**
 * The two reasons a node can be absent from a page, and which way each fails.
 *
 * They fail in OPPOSITE directions, and the asymmetry is the whole point of
 * testing them together. A condition is an author restricting a node, so a shape
 * nothing can read has to count as gated or hidden content leaks. A block
 * answering about its own props is not restricting anything, so a broken answer
 * has to count as drawing or a node that IS on the page loses the stylesheet
 * compiled for it.
 */
import { describe, expect, it, vi } from "vitest";

import type { BlockNode } from "./document";
import { declaresNoMarkup, isConditionGated } from "./visibility";

const node = (extra: Partial<BlockNode> = {}): BlockNode =>
  ({
    id: "n1",
    type: "core/box",
    version: 1,
    props: {},
    ...extra,
  }) as BlockNode;

/** Definitions holding one answer for `core/box`. */
const answering = (rendersNothing: unknown) => () =>
  ({ rendersNothing }) as { rendersNothing?: (props: never) => boolean };

describe("a shape the condition reader cannot parse", () => {
  it("counts as gated", () => {
    // The direction that cannot be taken back: showing everyone what was meant
    // for some of them.
    expect(isConditionGated(node({ visibility: "hidden" } as never))).toBe(
      true
    );
    expect(isConditionGated(node({ visibility: ["tier"] } as never))).toBe(
      true
    );
  });

  it("leaves an ordinary node alone", () => {
    // The control. Without it the assertions above would pass on a reader that
    // gates everything.
    expect(isConditionGated(node())).toBe(false);
    expect(
      isConditionGated(node({ visibility: { conditions: [] } } as never))
    ).toBe(false);
  });
});

describe("a block asked whether its props draw nothing", () => {
  it("is believed only when it answers exactly true", () => {
    expect(
      declaresNoMarkup(
        node(),
        answering(() => true)
      )
    ).toBe(true);
  });

  it("counts as drawing on any other answer", () => {
    // A truthy non-boolean is the one worth naming: a block returning its own
    // props object, or a count of missing fields, means "I could not decide"
    // rather than "I draw nothing", and reading it as the latter removes a node
    // that is on the page.
    for (const answer of [false, undefined, null, 0, 1, "true", {}]) {
      expect(
        declaresNoMarkup(
          node(),
          answering(() => answer)
        )
      ).toBe(false);
    }
  });

  it("counts as drawing when nothing was declared", () => {
    expect(declaresNoMarkup(node(), () => ({}))).toBe(false);
    expect(declaresNoMarkup(node(), () => undefined)).toBe(false);
    expect(declaresNoMarkup(node(), answering("not a function"))).toBe(false);
  });

  it("counts as drawing when the block throws", () => {
    expect(
      declaresNoMarkup(
        node(),
        answering(() => {
          throw new Error("props were not what I expected");
        })
      )
    ).toBe(false);
  });

  it("contains a rejection from a block that declared this async", async () => {
    // `async rendersNothing` returns a pending promise, so the `try` finishes
    // before any rejection happens and its `catch` never sees one. Node reports
    // that as an unhandled rejection and can end the process — the whole page
    // lost because a block was asked about itself.
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      expect(
        declaresNoMarkup(
          node(),
          answering(() => Promise.reject(new Error("late")))
        )
      ).toBe(false);
      // A rejection surfaces on a later turn, so the assertion has to wait for
      // one; checking synchronously would pass whether or not it was contained.
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("contains a definition source that throws when it is asked", () => {
    // The LOOKUP can fail before the predicate is ever reached, and this runs
    // while the page decides its stylesheet — before any block boundary exists —
    // so a throw here loses the whole page rather than one block.
    expect(
      declaresNoMarkup(node(), () => {
        throw new Error("registry is mid-rebuild");
      })
    ).toBe(false);
  });

  it("contains a `rendersNothing` accessor that throws on read", () => {
    // A definition is an object a plugin author wrote, so the property read is
    // as much their code as the call is.
    const definition = {
      get rendersNothing(): (props: never) => boolean {
        throw new Error("from the accessor");
      },
    };
    expect(declaresNoMarkup(node(), () => definition)).toBe(false);
  });

  it("contains a throwing `then` getter", () => {
    // The read of `.then` is what decides whether an answer is deferred, and it
    // happens on a value the block returned — so it has to sit inside the same
    // guard as the call.
    const hostile = {
      get then() {
        throw new Error("from the getter");
      },
    };
    expect(
      declaresNoMarkup(
        node(),
        answering(() => hostile)
      )
    ).toBe(false);
  });
});
