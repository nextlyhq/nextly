/**
 * Whether a stamp changes exactly when the compiled sheet would.
 *
 * Both directions are defects and they are not symmetric. A stamp that fails to
 * move when an input did serves a stale sheet forever, silently — that is the
 * defect this module exists to close. A stamp that moves when nothing did costs
 * a recompile per page and is merely slow. So the tests below assert movement
 * for every input that reaches CSS, and stability only where the field
 * provably does not.
 *
 * @module shared-style-inputs.test
 */
import { describe, expect, it } from "vitest";

import { MAX_NAMED_CLASSES } from "@nextlyhq/blocks-engine";

import {
  UNIDENTIFIED_SHARED_INPUTS,
  sharedStyleInputsId,
  sharedStyleInputsLabel,
  type SharedStyleInputs,
} from "./shared-style-inputs";

/** A minimal set of shared inputs, as a compile would carry them. */
function inputs(over: Partial<SharedStyleInputs> = {}): SharedStyleInputs {
  return {
    breakpoints: {
      viewport: [
        { id: "base", label: "Base" },
        { id: "md", label: "Medium", maxWidth: 768 },
      ],
      container: [],
    },
    tokenPrefix: "--site-",
    namedClasses: [
      {
        id: "c1",
        slug: "hero",
        orderIndex: 0,
        styles: { base: { base: { color: "#111111" } } },
      },
    ],
    ...over,
  };
}

describe("the stamp", () => {
  it("is stable for the same inputs", () => {
    // Nothing else here means anything if this does not hold: a stamp that
    // varied run to run would recompile every page on every render.
    expect(sharedStyleInputsId(inputs())).toBe(sharedStyleInputsId(inputs()));
  });

  it("is absent when the caller states no shared inputs", () => {
    // A real answer — "this compile used none" — and distinct from a caller
    // that has inputs it cannot name.
    expect(sharedStyleInputsId(undefined)).toBeUndefined();
  });

  it("cannot be equalled by the unidentified sentinel", () => {
    // The sentinel means recompile every time, which only holds if no genuine
    // stamp can ever match it.
    const real = sharedStyleInputsId(inputs());

    expect(real).not.toBe(UNIDENTIFIED_SHARED_INPUTS);
    expect(UNIDENTIFIED_SHARED_INPUTS).not.toContain(":");
  });

  describe("moves when an input that reaches CSS moves", () => {
    it("a breakpoint bound", () => {
      // `maxWidth` IS the at-rule condition.
      const moved = inputs({
        breakpoints: {
          viewport: [
            { id: "base", label: "Base" },
            { id: "md", label: "Medium", maxWidth: 900 },
          ],
          container: [],
        },
      });

      expect(sharedStyleInputsId(moved)).not.toBe(
        sharedStyleInputsId(inputs())
      );
    });

    it("a breakpoint ORDER, with the same breakpoints in it", () => {
      // OVER-invalidation, asserted deliberately rather than as a property of
      // the output. The compiler sorts each axis by descending `maxWidth`, so
      // reordering distinct widths emits the same CSS — this stamp moves anyway
      // because it preserves stored order, and it preserves stored order
      // because equal widths tie and a stable sort keeps them as stored. Losing
      // the tie case is silent; paying a recompile here is not.
      const moved = inputs({
        breakpoints: {
          viewport: [
            { id: "md", label: "Medium", maxWidth: 768 },
            { id: "base", label: "Base" },
          ],
          container: [],
        },
      });

      expect(sharedStyleInputsId(moved)).not.toBe(
        sharedStyleInputsId(inputs())
      );
    });

    it("the token prefix", () => {
      // Renders into every `var(--<prefix><name>)` the sheet references.
      expect(sharedStyleInputsId(inputs({ tokenPrefix: "--acme-" }))).not.toBe(
        sharedStyleInputsId(inputs())
      );
    });

    it("an UNSET prefix against an empty one", () => {
      // Unset means the engine's default; `""` means a site that declared no
      // prefix. They compile to different property names, so they must not
      // stamp alike — this is what `JSON.stringify` is preserving.
      expect(sharedStyleInputsId(inputs({ tokenPrefix: undefined }))).not.toBe(
        sharedStyleInputsId(inputs({ tokenPrefix: "" }))
      );
    });

    it("a class slug — the rename case this exists for", () => {
      // The selector is `nx-c-<slug>`, so a rename moves it in the new sheet
      // while every stored artifact keeps the old one.
      const renamed = inputs({
        namedClasses: [
          {
            id: "c1",
            slug: "banner",
            orderIndex: 0,
            styles: { base: { base: { color: "#111111" } } },
          },
        ],
      });

      expect(sharedStyleInputsId(renamed)).not.toBe(
        sharedStyleInputsId(inputs())
      );
    });

    it("a class's styles, with its name unchanged", () => {
      // The rules themselves live in the page artifact, so editing a class
      // without renaming it still staleness every stored sheet.
      const restyled = inputs({
        namedClasses: [
          {
            id: "c1",
            slug: "hero",
            orderIndex: 0,
            styles: { base: { base: { color: "#222222" } } },
          },
        ],
      });

      expect(sharedStyleInputsId(restyled)).not.toBe(
        sharedStyleInputsId(inputs())
      );
    });

    it("a class's order, with its name and styles unchanged", () => {
      // `orderIndex` decides which class wins where two apply.
      const reordered = inputs({
        namedClasses: [
          {
            id: "c1",
            slug: "hero",
            orderIndex: 5,
            styles: { base: { base: { color: "#111111" } } },
          },
        ],
      });

      expect(sharedStyleInputsId(reordered)).not.toBe(
        sharedStyleInputsId(inputs())
      );
    });

    it("a block type's defaults", () => {
      // The compiler emits these into the PAGE sheet, and emits it after the
      // site sheet — so a stale base rule here does not merely disagree with an
      // updated one, it overrides it.
      const moved = inputs({
        blockBases: { "core/text": { base: { base: { color: "#222222" } } } },
      });

      expect(sharedStyleInputsId(moved)).not.toBe(
        sharedStyleInputsId(inputs({ blockBases: {} }))
      );
    });

    it("a container breakpoint losing its bound, which is not the same as null", () => {
      // On a container axis an ABSENT `maxWidth` compiles to
      // `@container (min-width: 0)` — the widest query — while a stored `null`
      // is a different value entirely. Collapsing them would reuse a sheet
      // whose container rules no longer match.
      const absent = inputs({
        breakpoints: {
          viewport: [],
          container: [{ id: "c", label: "C" }],
        },
      });
      const nulled = inputs({
        breakpoints: {
          viewport: [],
          container: [
            { id: "c", label: "C", maxWidth: null } as never as {
              id: string;
              label: string;
            },
          ],
        },
      });

      expect(sharedStyleInputsId(absent)).not.toBe(sharedStyleInputsId(nulled));
    });

    it("two breakpoints sharing a bound, swapped", () => {
      // The case that forbids canonicalising breakpoint order. The comparator
      // returns 0 for equal widths and the sort is stable, so these two emit in
      // whichever order they were stored — a real difference in output that an
      // order-independent stamp would miss.
      const one = { id: "a", label: "A", maxWidth: 768 };
      const two = { id: "b", label: "B", maxWidth: 768 };

      expect(
        sharedStyleInputsId(
          inputs({ breakpoints: { viewport: [one, two], container: [] } })
        )
      ).not.toBe(
        sharedStyleInputsId(
          inputs({ breakpoints: { viewport: [two, one], container: [] } })
        )
      );
    });

    it("a class being ADDED, even one the page never references", () => {
      // The whole library is emitted into every page, so a new class is a
      // change to every stored sheet.
      const grown = inputs({
        namedClasses: [
          ...(inputs().namedClasses ?? []),
          {
            id: "c2",
            slug: "card",
            orderIndex: 1,
            styles: { base: { base: { color: "#333333" } } },
          },
        ],
      });

      expect(sharedStyleInputsId(grown)).not.toBe(
        sharedStyleInputsId(inputs())
      );
    });
  });

  describe("holds still for what does not reach CSS", () => {
    it("a class library stored in a DIFFERENT order", () => {
      // The compiler sorts the library by `orderIndex` then id before emitting
      // it, so two storage orders of the same classes produce identical CSS. A
      // stamp that moved here would invalidate every page artifact on the site
      // after a settings rewrite that changed nothing.
      const a = {
        id: "c1",
        slug: "hero",
        orderIndex: 0,
        styles: { base: { base: { color: "#111111" } } },
      };
      const b = {
        id: "c2",
        slug: "card",
        orderIndex: 1,
        styles: { base: { base: { color: "#333333" } } },
      };

      expect(sharedStyleInputsId(inputs({ namedClasses: [a, b] }))).toBe(
        sharedStyleInputsId(inputs({ namedClasses: [b, a] }))
      );
    });

    it("a breakpoint's LABEL", () => {
      // The author's word for the breakpoint. The at-rule is built from
      // `maxWidth` alone, so moving this would recompile every page on the site
      // for no change in output. Stability here is the one place this module
      // deliberately chooses precision over caution, and it is safe because the
      // field provably never reaches the stylesheet.
      const relabelled = inputs({
        breakpoints: {
          viewport: [
            { id: "base", label: "Base" },
            { id: "md", label: "Tablet", maxWidth: 768 },
          ],
          container: [],
        },
      });

      expect(sharedStyleInputsId(relabelled)).toBe(
        sharedStyleInputsId(inputs())
      );
    });
  });
});

describe("what a corrupt or hostile settings row costs", () => {
  it("reduces a malformed class entry rather than dereferencing it", () => {
    // This library is one site-settings record read on every page render, and
    // it arrives whether or not anything validated it. `compilePageCss` skips a
    // corrupt entry with a warning; a stamp that threw on the same row would
    // take down every page on the site instead of costing one class its rules.
    const corrupt = inputs({
      namedClasses: [null, undefined, "nope"] as never,
    });

    expect(() => sharedStyleInputsId(corrupt)).not.toThrow();
  });

  it("still notices a corrupt entry being ADDED", () => {
    // Tolerating it must not mean ignoring it: an entry the compiler skips
    // still changes the library, and reducing it to a hole keeps its position
    // rather than dropping it.
    const one = inputs({ namedClasses: [null] as never });
    const two = inputs({ namedClasses: [null, null] as never });

    expect(sharedStyleInputsId(one)).not.toBe(sharedStyleInputsId(two));
  });

  it("does not throw on an envelope that cannot be serialized", () => {
    // A circular value in persisted settings. The compiler tolerates a corrupt
    // entry and warns; throwing from the stamp would take down every page on
    // the site BEFORE the forgiving compiler ever ran.
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() =>
      sharedStyleInputsId(
        inputs({
          namedClasses: [
            { id: "c1", slug: "hero", orderIndex: 0, styles: circular },
          ] as never,
        })
      )
    ).not.toThrow();
  });

  it("notices a change DEEP inside an oversized envelope", () => {
    // The case a truncating bound could not see. These two serialize to the
    // same length and differ only far past any prefix a cut would keep, while
    // the compiler emits different CSS for them.
    const big = (tail: string) => ({
      id: "c1",
      slug: "hero",
      orderIndex: 0,
      styles: { base: { base: { content: "x".repeat(9000) + tail } } },
    });

    expect(
      sharedStyleInputsId(inputs({ namedClasses: [big("aaa")] }))
    ).not.toBe(sharedStyleInputsId(inputs({ namedClasses: [big("bbb")] })));
  });

  it("reads no further than the compiler does", () => {
    // `compilePageCss` slices to MAX_NAMED_CLASSES before it copies, sorts or
    // scans. Entries past that cap reach no stylesheet, so they must not move a
    // stamp — and an oversized settings row must not restore here the unbounded
    // work the compiler's cap exists to prevent.
    const entry = (i: number) => ({
      id: `c${i}`,
      slug: `s${i}`,
      orderIndex: i,
      styles: {},
    });
    const atCap = Array.from({ length: MAX_NAMED_CLASSES }, (_, i) => entry(i));

    expect(sharedStyleInputsId(inputs({ namedClasses: atCap }))).toBe(
      sharedStyleInputsId(
        inputs({ namedClasses: [...atCap, entry(MAX_NAMED_CLASSES)] })
      )
    );
  });
});

describe("the label the stamp is taken over", () => {
  it("is reachable, so an unexplained recompile can be explained", () => {
    // A digest that changed with no way to say why is the standing failure mode
    // of a cache key. This is not stored; it is what answers which input moved.
    const label = sharedStyleInputsLabel(inputs());

    expect(label).toContain("hero");
    expect(label).toContain("--site-");
  });

  it("carries its encoding version, so a later change invalidates rather than matches", () => {
    expect(JSON.parse(sharedStyleInputsLabel(inputs()))[0]).toBe("v1");
    expect(sharedStyleInputsId(inputs())).toMatch(/^v1:[0-9a-z]+$/);
  });

  it("omits the label a breakpoint carries", () => {
    // Asserted on the LABEL as well as through the stamp, because the stamp
    // agreeing could also mean the digest collided.
    expect(sharedStyleInputsLabel(inputs())).not.toContain("Medium");
  });
});
