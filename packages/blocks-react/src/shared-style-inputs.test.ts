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
      // Breakpoints are emitted in array order and at one specificity the
      // cascade is source order, so a reorder is a different sheet.
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
    expect(sharedStyleInputsId(inputs())).toMatch(/^v1:[0-9a-f]{16}$/);
  });

  it("omits the label a breakpoint carries", () => {
    // Asserted on the LABEL as well as through the stamp, because the stamp
    // agreeing could also mean the digest collided.
    expect(sharedStyleInputsLabel(inputs())).not.toContain("Medium");
  });
});
