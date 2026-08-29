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
  EMITTABLE_STRING_BOUNDS,
  MAX_NAMED_CLASSES,
  MAX_NAMED_CLASS_NAME_LENGTH,
  MAX_SCANNED_KEYS,
  MAX_VALUE_LENGTH,
  PREVIEW_VIEWPORT_CONTAINER,
} from "@nextlyhq/blocks-engine";

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
  it("keeps every emittable string shorter than the length it truncates at", () => {
    // The walk keeps at most `MAX_VALUE_LENGTH` characters of any string it
    // reads, and carries no notion of WHERE it is — which is the property that
    // stops it becoming a second reading of the envelope. Soundness therefore
    // rests on one relationship rather than on the walk: no string the compiler
    // can emit may be longer than the walk keeps, or two inputs agreeing to the
    // cut and differing after it stamp alike and compile apart.
    //
    // Read from the ENGINE'S own list rather than named here, because a list
    // restated at the consumer is a copy of the producer's set with nothing
    // keeping the two in step — and it would assert over the members it names
    // while the member it omits is the one whose bound nobody has written.
    // Reading the array means a bound added to the compiler is covered without
    // this file being edited.
    //
    // The length check is the population assertion: an empty set satisfies the
    // loop below perfectly, so without it this passes by reading nothing.
    expect(EMITTABLE_STRING_BOUNDS.length).toBeGreaterThan(0);
    for (const bound of EMITTABLE_STRING_BOUNDS) {
      expect(bound.max, bound.what).toBeLessThanOrEqual(MAX_VALUE_LENGTH);
    }
  });

  it("is stable for the same inputs", () => {
    // Nothing else here means anything if this does not hold: a stamp that
    // varied run to run would recompile every page on every render.
    expect(sharedStyleInputsId(inputs())).toBe(sharedStyleInputsId(inputs()));
  });

  it("separates a PREVIEW compile from a published one", () => {
    /*
     * The artifact identity is what decides whether a stored sheet is reused
     * instead of recompiled, and `resolvePageStyles` is exported and returns a
     * storable `PageStyles`. So a preview compile stamped as published can be
     * persisted and then served to a live page — which has no preview
     * container, so every one of its responsive rules stops matching and the
     * page silently loses its breakpoints.
     *
     * Both halves are asserted. Equal stamps would be the defect; a published
     * stamp that MOVED would be a different one, invalidating every artifact on
     * the site for CSS that did not change by a byte.
     */
    const published = sharedStyleInputsId(inputs());
    const previewed = sharedStyleInputsId({
      ...inputs(),
      previewContainer: PREVIEW_VIEWPORT_CONTAINER,
    });

    // The population first: two `undefined`s compare equal and prove nothing.
    expect(published).toBeDefined();
    expect(previewed).toBeDefined();
    expect(previewed).not.toBe(published);
    // And the published side is untouched by the option existing.
    expect(published).toBe(sharedStyleInputsId({ ...inputs() }));
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

    it("the token prefix", () => {
      // Renders into every `var(--<prefix><name>)` the sheet references.
      expect(sharedStyleInputsId(inputs({ tokenPrefix: "--acme-" }))).not.toBe(
        sharedStyleInputsId(inputs())
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
    it("an UNSET prefix against an empty one", () => {
      // Corrects what this file asserted first. `""` looks like "a site that
      // declared no prefix", but `safeTokenPrefix` accepts only `--` followed by
      // lowercase letters, digits and dashes, so an empty string is refused and
      // the tokens are written under the engine's default — the same place unset
      // writes them. Nothing about the sheet differs, so nothing may be
      // invalidated over it.
      expect(sharedStyleInputsId(inputs({ tokenPrefix: undefined }))).toBe(
        sharedStyleInputsId(inputs({ tokenPrefix: "" }))
      );
    });

    it("two prefixes the compiler refuses for different reasons", () => {
      // A malformed one and a reserved one. Both resolve to the default, so both
      // emit the identical `var(--site-*)` references, and swapping one rejected
      // spelling for another must not recompile every page on the site.
      expect(sharedStyleInputsId(inputs({ tokenPrefix: "acme" }))).toBe(
        sharedStyleInputsId(inputs({ tokenPrefix: "--nx-brand" }))
      );
    });

    it("a breakpoint ORDER, with distinct bounds", () => {
      // The compiler sorts each axis by descending `maxWidth` before it emits,
      // so two storage orders of the same distinct widths produce the same CSS.
      // Read through the engine's own normalisation, which is what makes this
      // hold; a stamp taken over the stored axes moves here and recompiles every
      // page on the site for a settings rewrite that changed nothing.
      //
      // Distinct is the whole condition. Equal bounds tie, a stable sort keeps
      // them as stored, and the assertion below for that case is the one this
      // must not be widened into.
      const moved = inputs({
        breakpoints: {
          viewport: [
            { id: "md", label: "Medium", maxWidth: 768 },
            { id: "base", label: "Base" },
          ],
          container: [],
        },
      });

      expect(sharedStyleInputsId(moved)).toBe(sharedStyleInputsId(inputs()));
    });

    it("a breakpoint the compiler DISCARDS", () => {
      // A viewport definition with no bound emits no at-rule at all, so
      // `breakpointContexts` drops it rather than letting it override the real
      // base at every width. Nothing about the sheet changes, and an artifact
      // must not be thrown away over it.
      const withJunk = inputs({
        breakpoints: {
          viewport: [
            { id: "base", label: "Base" },
            { id: "md", label: "Medium", maxWidth: 768 },
            { id: "junk", label: "Junk" },
          ],
          container: [],
        },
      });

      expect(sharedStyleInputsId(withJunk)).toBe(sharedStyleInputsId(inputs()));
    });

    it("a bound the compiler refuses as unusable", () => {
      // Zero and below are dropped for being unmatchable rather than kept as a
      // query that can never fire, so this too reaches no stylesheet.
      const unusable = inputs({
        breakpoints: {
          viewport: [
            { id: "base", label: "Base" },
            { id: "md", label: "Medium", maxWidth: 768 },
            { id: "neg", label: "Negative", maxWidth: -1 },
          ],
          container: [],
        },
      });

      expect(sharedStyleInputsId(unusable)).toBe(sharedStyleInputsId(inputs()));
    });

    it("every definition past the per-axis cap", () => {
      // The cap exists because every style envelope in the document scans the
      // whole context list, so a corrupt settings row costs the render once per
      // node. Definitions past it reach no stylesheet — and reading them here
      // would restore, in the stamp, the unbounded scan the cap prevents.
      const axis = (count: number) => [
        { id: "base", label: "Base" },
        ...Array.from({ length: count }, (_, i) => ({
          id: `b${i}`,
          label: `B${i}`,
          // DESCENDING, so every extra definition is narrower than the ones
          // before it and sorts to the end of the widest-first order the cap
          // slices. Appending WIDER ones would displace the survivors instead,
          // which is a real change of output and not what this asserts.
          maxWidth: 1000 - i,
        })),
      ];

      expect(
        sharedStyleInputsId(
          inputs({ breakpoints: { viewport: axis(20), container: [] } })
        )
      ).toBe(
        sharedStyleInputsId(
          inputs({ breakpoints: { viewport: axis(30), container: [] } })
        )
      );
    });

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

  it("keeps two UNREADABLE envelopes apart when their CSS differs", () => {
    // The half that a `try`/`catch` returning one constant cannot do, and the
    // reason the reading is total instead. `compilePageCss` iterates the states
    // it knows and never descends into one it does not, so a cycle parked under
    // an unrecognised key costs a warning and nothing else — both of these
    // compile, and they emit DIFFERENT colours. Collapsing them to one identity
    // reuses the red sheet after the site turned blue, forever and silently.
    const envelope = (color: string) => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      return {
        id: "c1",
        slug: "hero",
        orderIndex: 0,
        styles: { junk: circular, base: { base: { color } } },
      };
    };

    expect(
      sharedStyleInputsId(inputs({ namedClasses: [envelope("red")] as never }))
    ).not.toBe(
      sharedStyleInputsId(inputs({ namedClasses: [envelope("blue")] as never }))
    );
  });

  it("does not throw on a circular BLOCK BASE", () => {
    // Block defaults are style envelopes of the same shape, arriving from a
    // block package's declaration or a stored site record, and the compiler
    // forgives one exactly as it forgives a class's. A stamp that threw here
    // would take the page down before compilation ever ran.
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() =>
      sharedStyleInputsId(
        inputs({ blockBases: { "core/text": circular } as never })
      )
    ).not.toThrow();
  });

  it("still notices a change beside a circular BLOCK BASE", () => {
    // Surviving the value is not enough: the readable part of the same base has
    // to keep reaching the stamp, or every block default behind one corrupt key
    // becomes invisible to it.
    const base = (color: string) => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      return { junk: circular, base: { base: { color } } };
    };

    expect(
      sharedStyleInputsId(
        inputs({ blockBases: { "core/text": base("red") } as never })
      )
    ).not.toBe(
      sharedStyleInputsId(
        inputs({ blockBases: { "core/text": base("blue") } as never })
      )
    );
  });

  it("keeps a value it cannot descend into apart from one it can", () => {
    // A Map is not a structure the compiler writes from — `isPlainRecord`
    // refuses it and the state is reported rather than emitted — so two Maps
    // produce identical CSS and reading their contents here would invalidate
    // artifacts over a difference no stylesheet can show. What must NOT collapse
    // is a Map against a plain record, which does emit.
    const mapped = (entries: [string, string][]) => ({
      id: "c1",
      slug: "hero",
      orderIndex: 0,
      styles: { base: new Map(entries) },
    });

    expect(
      sharedStyleInputsId(
        inputs({ namedClasses: [mapped([["a", "1"]])] as never })
      )
    ).toBe(
      sharedStyleInputsId(
        inputs({ namedClasses: [mapped([["b", "2"]])] as never })
      )
    );
    expect(
      sharedStyleInputsId(inputs({ namedClasses: [mapped([])] as never }))
    ).not.toBe(sharedStyleInputsId(inputs()));
  });

  it("holds still for a change under a state the compiler cannot emit", () => {
    // `compilePageCss` iterates STYLE_STATES and never reaches a key outside it,
    // so an unrecognised state costs a warning naming the key and nothing more.
    // Two envelopes differing only there compile to the same CSS, and rejecting
    // every stored artifact over it is a recompile bought with nothing.
    const withJunk = (junk: unknown) =>
      inputs({
        namedClasses: [
          {
            id: "c1",
            slug: "hero",
            orderIndex: 0,
            styles: { junk, base: { base: { color: "#111111" } } },
          },
        ] as never,
      });

    expect(sharedStyleInputsId(withJunk("one"))).toBe(
      sharedStyleInputsId(withJunk({ deeply: { nested: "two" } }))
    );
  });

  it("CONTROL: still moves for a change under a state it CAN emit", () => {
    // The half a blanket projection would fail. `hover` is a real state and its
    // declarations are written into the sheet, so a change there must move.
    const hovered = (colour: string) =>
      inputs({
        namedClasses: [
          {
            id: "c1",
            slug: "hero",
            orderIndex: 0,
            styles: { hover: { base: { color: colour } } },
          },
        ] as never,
      });

    expect(sharedStyleInputsId(hovered("#111111"))).not.toBe(
      sharedStyleInputsId(hovered("#222222"))
    );
  });

  it("reads a class NAME no further than the compiler does", () => {
    // `isUsableNamedClass` tests length before pattern, so a name past the limit
    // takes its whole class out of the stylesheet without ever being scanned —
    // and `orderedNamedClassPositions` compares only the first limit+1
    // characters for the same reason. Copying the raw string here would put it
    // in this label and then in the outer one, on every render, for a class that
    // emits nothing.
    //
    // Sound because nothing past that character can reach CSS: both of these are
    // rejected by length, so both compile to the same nothing.
    const named = (name: string) =>
      inputs({
        namedClasses: [
          {
            id: "c1",
            slug: name,
            orderIndex: 0,
            styles: { base: { base: { color: "#111111" } } },
          },
        ],
      });
    const over = "x".repeat(MAX_NAMED_CLASS_NAME_LENGTH + 1);

    expect(sharedStyleInputsId(named(`${over}aaa`))).toBe(
      sharedStyleInputsId(named(`${over}bbb`))
    );
  });

  it("CONTROL: still separates two names the compiler would ACCEPT", () => {
    // The half a blanket truncation would fail. A name at the limit is usable,
    // its slug becomes the selector, and a change to its last character changes
    // the sheet — so the bound must not reach it.
    const atLimit = (last: string) =>
      inputs({
        namedClasses: [
          {
            id: "c1",
            slug: "x".repeat(MAX_NAMED_CLASS_NAME_LENGTH - 1) + last,
            orderIndex: 0,
            styles: { base: { base: { color: "#111111" } } },
          },
        ],
      });

    expect(sharedStyleInputsId(atLimit("a"))).not.toBe(
      sharedStyleInputsId(atLimit("b"))
    );
  });

  it("refuses to IDENTIFY inputs holding a record wider than the compiler reads", () => {
    // `compilePageCss` stops enumerating one stored record at MAX_SCANNED_KEYS,
    // so a settings row wider than that costs it a bounded scan while costing an
    // unbounded walk to anything that reads the same record on every render.
    //
    // Truncating instead would be unsound in the silent direction: the compiler
    // reaches a state or a breakpoint BY NAME, so a key sorted past any cut is
    // still emitted. Declining to identify the inputs recompiles every render,
    // which is expensive and correct, on a row nothing legitimate produces.
    // UNDER a known state, which is where the bound has anything to guard: the
    // envelope's own keys are projected to the four states the compiler emits
    // from, so an oversized record can only arrive below that — as a breakpoint
    // map or a declaration record, both of which the compiler reaches by name.
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < MAX_SCANNED_KEYS + 1; i += 1) wide[`k${i}`] = i;

    expect(
      sharedStyleInputsId(
        inputs({
          namedClasses: [
            { id: "c1", slug: "hero", orderIndex: 0, styles: { base: wide } },
          ] as never,
        })
      )
    ).toBe(UNIDENTIFIED_SHARED_INPUTS);
  });

  it("CONTROL: reads a record exactly at that width, and still separates it", () => {
    // The bound must not fire on anything the compiler would have read. Asserted
    // as a pair: identified rather than refused, AND still sensitive to a change
    // inside it — a bound that returned a constant at this width would satisfy
    // the first half alone.
    const atWidth = (last: number) => {
      const record: Record<string, unknown> = {};
      for (let i = 0; i < MAX_SCANNED_KEYS - 1; i += 1) record[`k${i}`] = i;
      record.color = last;
      return {
        id: "c1",
        slug: "hero",
        orderIndex: 0,
        styles: { base: record },
      };
    };
    const one = sharedStyleInputsId(
      inputs({ namedClasses: [atWidth(1)] as never })
    );

    expect(one).not.toBe(UNIDENTIFIED_SHARED_INPUTS);
    expect(one).not.toBe(
      sharedStyleInputsId(inputs({ namedClasses: [atWidth(2)] as never }))
    );
  });

  it("notices a change DEEP inside a large envelope the compiler still reads", () => {
    // The case a truncating bound could not see: these differ only far past any
    // prefix a cut would keep, and the compiler emits different CSS for them.
    //
    // Sized UNDER `MAX_VALUE_LENGTH`, which is what makes the case real: the
    // engine refuses a longer value outright before parsing, so two variants of
    // one would both emit nothing and agree for a reason that has nothing to do
    // with the walk. A value the compiler will not read cannot demonstrate
    // sensitivity to a change inside it.
    const big = (tail: string) => ({
      id: "c1",
      slug: "hero",
      orderIndex: 0,
      styles: {
        base: {
          base: { content: "x".repeat(MAX_VALUE_LENGTH - 100) + tail },
        },
      },
    });

    expect(
      sharedStyleInputsId(inputs({ namedClasses: [big("aaa")] }))
    ).not.toBe(sharedStyleInputsId(inputs({ namedClasses: [big("bbb")] })));
  });

  it("holds still for two values the compiler refuses as too long", () => {
    // The other side of the same bound. Past `MAX_VALUE_LENGTH` the engine
    // rejects the value before parsing and emits no declaration, so two of them
    // produce identical CSS — and carrying both in full invalidated a
    // byte-identical sheet over a suffix nothing reads, with an arbitrarily
    // large allocation on every cache check.
    const rejected = (tail: string) => ({
      id: "c1",
      slug: "hero",
      orderIndex: 0,
      styles: {
        base: { base: { content: "x".repeat(MAX_VALUE_LENGTH + 1) + tail } },
      },
    });

    expect(
      sharedStyleInputsId(inputs({ namedClasses: [rejected("aaa")] }))
    ).toBe(sharedStyleInputsId(inputs({ namedClasses: [rejected("bbb")] })));
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

describe("the reading a style envelope is reduced by", () => {
  /** The same class, differing only in the one value under test. */
  const withValue = (value: unknown) =>
    inputs({
      namedClasses: [
        {
          id: "c1",
          slug: "hero",
          orderIndex: 0,
          styles: { base: { base: { width: value } } },
        },
      ] as never,
    });
  const stampFor = (value: unknown) => sharedStyleInputsId(withValue(value));

  it("keeps an ABSENT value apart from a stored null", () => {
    // The compiler keeps them apart, so this must: `undefined` at a breakpoint
    // is a node saying nothing about it and stays silent, while a stored `null`
    // is a malformed value it reports and writes nothing for. Collapsing them
    // reuses a sheet across the edit that introduced the corruption.
    expect(stampFor(undefined)).not.toBe(stampFor(null));
  });

  it("keeps the three numbers a JSON writer flattens apart", () => {
    // `JSON.stringify` writes `null` for NaN and for both infinities, so a
    // reading built on it stamps four distinct stored values identically.
    const seen = new Set([
      stampFor(Number.NaN),
      stampFor(Number.POSITIVE_INFINITY),
      stampFor(Number.NEGATIVE_INFINITY),
      stampFor(null),
    ]);

    expect(seen.size).toBe(4);
  });

  it("keeps a bigint apart from the number that prints the same", () => {
    // And does not throw on it, which `JSON.stringify` does — taking the render
    // down over a value the compiler would merely refuse to write.
    expect(stampFor(BigInt(1))).not.toBe(stampFor(1));
  });

  it("survives a value that is neither data nor a structure", () => {
    // A function or a symbol reaches no stylesheet, but it must not throw on the
    // way past and must not read as the absence of a value either.
    expect(stampFor(() => "x")).not.toBe(stampFor(undefined));
    expect(stampFor(Symbol("x"))).not.toBe(stampFor(undefined));
  });

  it("survives a property whose getter throws", () => {
    // Confined to the member: everything beside it still reaches the stamp, so
    // one hostile accessor costs its own precision rather than the page.
    const hostile = {
      base: { base: { color: "red" } },
      get boom(): unknown {
        throw new Error("no");
      },
    };
    const other = {
      base: { base: { color: "blue" } },
      get boom(): unknown {
        throw new Error("no");
      },
    };

    expect(() => stampFor(hostile)).not.toThrow();
    expect(stampFor(hostile)).not.toBe(stampFor(other));
  });

  it("bottoms out rather than overflowing on a deeply nested value", () => {
    // A settings record nesting itself thousands deep would exhaust the stack
    // during the walk and take down every page on the site. It is read to a
    // fixed depth instead — far past the four levels the compiler itself reads,
    // so nothing it can emit is lost to the bound.
    const deep = (levels: number): unknown => {
      let value: unknown = "leaf";
      for (let i = 0; i < levels; i += 1) value = { next: value };
      return value;
    };

    expect(() => stampFor(deep(50_000))).not.toThrow();
    // Same shape, different depth, both far past the bound: what distinguishes
    // them lies below it, and neither can reach CSS.
    expect(stampFor(deep(50_000))).toBe(stampFor(deep(60_000)));
  });

  it("still reads a difference that sits ABOVE the depth bound", () => {
    // The half the bound must not cost. A truncation that started too shallow
    // would be the truncation defect again, one level down.
    const nest = (leaf: string): unknown => ({
      base: { base: { color: leaf } },
    });

    expect(stampFor(nest("red"))).not.toBe(stampFor(nest("blue")));
  });

  it("does not read one shared object as a cycle", () => {
    // The reason the walk tracks the ANCESTOR path rather than everything seen.
    // A library that reuses one style object across two positions is ordinary,
    // and marking the second reference would blind the stamp to changes in it.
    const shared = { color: "red" };
    const twice: Record<string, unknown> = { a: shared, b: shared };
    const changed = { color: "blue" };

    expect(stampFor(twice)).not.toBe(
      stampFor({ a: changed, b: changed } as Record<string, unknown>)
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
    // Pinned to a LITERAL rather than compared against the constant, which is
    // the point of the test: reading the constant would agree with whatever it
    // says and assert only that a string was copied. Written out, a bump cannot
    // happen without someone editing this line and deciding it should.
    //
    // Both surfaces, because they can disagree — the label is what the stamp is
    // taken over, so a version reaching one and not the other would key
    // artifacts on a value the label never carried.
    expect(JSON.parse(sharedStyleInputsLabel(inputs()))[0]).toBe("v3");
    expect(sharedStyleInputsId(inputs())).toMatch(/^v3:[0-9a-z]+$/);
  });

  it("omits the label a breakpoint carries", () => {
    // Asserted on the LABEL as well as through the stamp, because the stamp
    // agreeing could also mean the digest collided.
    expect(sharedStyleInputsLabel(inputs())).not.toContain("Medium");
  });
});
