import { fluidValue, type NamedClass } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { fluidClassesFollowRange } from "./site-style-fluid-classes";
import { sharedStyleName } from "./site-style-storage";

const OLD = { min: 360, max: 1280 };
const NEW = { min: 400, max: 800 };
const SIZES = { small: 16, large: 32 };

/** A text style whose Desktop size was made fluid across `range`. */
const lead = (range = OLD, extra: Record<string, unknown> = {}): NamedClass =>
  ({
    id: "t-lead",
    slug: "lead",
    label: "Lead",
    orderIndex: 0,
    role: "text",
    styles: { base: { base: { fontSize: fluidValue(SIZES, range) } } },
    fluidSizes: { base: SIZES },
    ...extra,
  }) as NamedClass;

const PLAIN: NamedClass = {
  id: "t-plain",
  slug: "plain",
  label: "Plain",
  orderIndex: 1,
  role: "text",
  styles: { base: { base: { fontSize: "18px" } } },
};

const tokens = (range?: { min: number; max: number }) => ({
  tokens: [],
  ...(range === undefined ? {} : { fluidRange: range }),
});

const USER = { id: "u-1" };

/** The first class's Desktop size in what the hook answered. */
const firstSize = (out: Record<string, unknown> | undefined): unknown =>
  (out?.classes as NamedClass[] | undefined)?.[0]?.styles.base?.base?.fontSize;

/** The hook as the Single runs it, with no code tier. */
const follow = fluidClassesFollowRange(undefined, sharedStyleName);

describe("text styles following a change of the site's fluid range", () => {
  it("remakes a fluid text style in the same write, and leaves a plain one byte for byte", () => {
    const plainBefore = JSON.stringify(PLAIN);
    const data = { tokens: tokens(NEW) };
    const out = follow({
      data,
      originalData: { tokens: tokens(OLD), classes: [lead(), PLAIN] },
      user: USER,
    });
    expect(out).toBeDefined();
    // The incoming write itself, with the classes added: no second write.
    expect(out?.tokens).toBe(data.tokens);
    const classes = out?.classes as NamedClass[];
    expect(classes[0]?.styles.base?.base?.fontSize).toBe(
      fluidValue(SIZES, NEW)
    );
    expect(classes[0]?.fluidSizes).toEqual({ base: SIZES });
    expect(JSON.stringify(classes[1])).toBe(plainBefore);
  });

  it("reads the stored range as the site's default where none is stored", () => {
    const out = follow({
      data: { tokens: tokens(NEW) },
      originalData: { tokens: tokens(), classes: [lead()] },
      user: USER,
    });
    expect(firstSize(out)).toBe(fluidValue(SIZES, NEW));
  });

  it("reads a stored copy SQLite hands back as text", () => {
    const out = follow({
      data: { tokens: tokens(NEW) },
      originalData: {
        tokens: JSON.stringify(tokens(OLD)),
        classes: JSON.stringify([lead()]),
      },
      user: USER,
    });
    expect(firstSize(out)).toBe(fluidValue(SIZES, NEW));
  });

  it("does nothing on a save that leaves the range as it is", () => {
    const stored = { tokens: tokens(OLD), classes: [lead(), PLAIN] };
    // Another site-style field saved: tokens not in the write at all.
    expect(
      follow({ data: { fonts: [] }, originalData: stored, user: USER })
    ).toBeUndefined();
    // The tokens saved with the same range: a colour changed, say.
    expect(
      follow({
        data: { tokens: tokens(OLD) },
        originalData: stored,
        user: USER,
      })
    ).toBeUndefined();
  });

  it("is deterministic: saving the new range again remakes nothing", () => {
    const first = follow({
      data: { tokens: tokens(NEW) },
      originalData: { tokens: tokens(OLD), classes: [lead()] },
      user: USER,
    });
    const second = follow({
      data: { tokens: tokens(NEW) },
      originalData: { tokens: tokens(NEW), classes: first?.classes },
      user: USER,
    });
    expect(second).toBeUndefined();
  });

  it("adds no classes to a write when no class carries fluid sizes", () => {
    expect(
      follow({
        data: { tokens: tokens(NEW) },
        originalData: { tokens: tokens(OLD), classes: [PLAIN] },
        user: USER,
      })
    ).toBeUndefined();
  });

  it("leaves a range the validator will refuse to the validator", () => {
    expect(
      follow({
        data: { tokens: tokens({ min: 800, max: 400 }) },
        originalData: { tokens: tokens(OLD), classes: [lead()] },
        user: USER,
      })
    ).toBeUndefined();
  });

  it("remakes the classes the write carries, where it carries them", () => {
    const out = follow({
      data: { tokens: tokens(NEW), classes: [lead(), PLAIN] },
      originalData: { tokens: tokens(OLD), classes: [] },
      user: USER,
    });
    expect(firstSize(out)).toBe(fluidValue(SIZES, NEW));
  });

  it("refuses a range change a locked fluid text style follows, naming it and saying nothing changed", () => {
    const locked = lead(OLD, { locked: true });
    const second = {
      ...lead(OLD, { locked: true }),
      id: "t-big",
      slug: "big",
      label: "Big",
    };
    const run = () =>
      follow({
        data: { tokens: tokens(NEW) },
        originalData: { tokens: tokens(OLD), classes: [locked, PLAIN, second] },
        user: USER,
      });
    expect(run).toThrow(
      "The fluid range wasn't changed, and nothing was saved: the text styles Lead and Big are locked, and their sizes follow the range. Unlock them first (Design → Type → Text styles, each style's menu → Unlock), then change the range again."
    );
  });

  it("does not refuse over a locked text style whose size no longer follows the range", () => {
    const typed = {
      ...lead(OLD, { locked: true }),
      styles: { base: { base: { fontSize: "20px" } } },
    } as NamedClass;
    expect(
      follow({
        data: { tokens: tokens(NEW) },
        originalData: { tokens: tokens(OLD), classes: [typed] },
        user: USER,
      })
    ).toBeUndefined();
  });

  it("remakes a locked one for server code acting as nobody, which the lock trusts", () => {
    const out = follow({
      data: { tokens: tokens(NEW) },
      originalData: {
        tokens: tokens(OLD),
        classes: [lead(OLD, { locked: true })],
      },
    });
    expect(firstSize(out)).toBe(fluidValue(SIZES, NEW));
  });
});

describe("a class save made under a range the site no longer uses", () => {
  const MADE = { small: 14, large: 28 };
  /** PLAIN made fluid on Desktop from `MADE`, across `range`. */
  const madeFluid = (range: { min: number; max: number }): NamedClass => ({
    ...PLAIN,
    styles: { base: { base: { fontSize: fluidValue(MADE, range) } } },
    fluidSizes: { base: MADE },
  });

  it("makes a newly fluid size again across the range stored now", () => {
    const out = follow({
      data: { classes: [madeFluid(OLD)] },
      originalData: { tokens: tokens(NEW), classes: [PLAIN] },
      user: USER,
    });
    const classes = out?.classes as NamedClass[] | undefined;
    expect(classes?.[0]?.styles.base?.base?.fontSize).toBe(
      fluidValue(MADE, NEW)
    );
    expect(classes?.[0]?.fluidSizes).toEqual({ base: MADE });
  });

  it("leaves a size made across the range stored now as it is", () => {
    expect(
      follow({
        data: { classes: [madeFluid(NEW)] },
        originalData: { tokens: tokens(NEW), classes: [PLAIN] },
        user: USER,
      })
    ).toBeUndefined();
  });

  it("leaves a size whose sizes it did not change, a typed one among them", () => {
    const typed = {
      ...madeFluid(OLD),
      styles: { base: { base: { fontSize: "20px" } } },
    } as NamedClass;
    const stored = madeFluid(OLD);
    expect(
      follow({
        data: { classes: [typed, lead(OLD)] },
        originalData: { tokens: tokens(NEW), classes: [stored, lead(OLD)] },
        user: USER,
      })
    ).toBeUndefined();
  });
});
