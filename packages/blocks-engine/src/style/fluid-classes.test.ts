import { describe, expect, it } from "vitest";

import {
  classesAcrossFluidRange,
  withFluidSizesBack,
  withoutStaleFluidSizes,
} from "./fluid-classes";
import { fluidValue } from "./fluid-value";
import type { NamedClass } from "./named-class";

const FROM = { min: 360, max: 1280 };
const TO = { min: 400, max: 800 };
const SIZES = { small: 16, large: 32 };

/** A text style whose Desktop size was made fluid from `SIZES`. */
const fluidStyle = (fontSize: string): NamedClass => ({
  id: "t-lead",
  slug: "lead",
  orderIndex: 0,
  role: "text",
  styles: { base: { base: { fontSize, lineHeight: 1.4 } } },
  fluidSizes: { base: SIZES },
});

const PLAIN: NamedClass = {
  id: "t-plain",
  slug: "plain",
  orderIndex: 1,
  role: "text",
  styles: { base: { base: { fontSize: "18px" } } },
};

describe("text styles across a new fluid range", () => {
  it("makes a fluid size again from its two sizes", () => {
    const [lead] = classesAcrossFluidRange(
      [fluidStyle(fluidValue(SIZES, FROM))],
      FROM,
      TO
    );
    expect(lead?.styles.base?.base?.fontSize).toBe(fluidValue(SIZES, TO));
    expect(lead?.styles.base?.base?.lineHeight).toBe(1.4);
    expect(lead?.fluidSizes).toEqual({ base: SIZES });
  });

  it("leaves a class without fluid sizes as the same object", () => {
    const classes = [PLAIN, fluidStyle(fluidValue(SIZES, FROM))];
    const across = classesAcrossFluidRange(classes, FROM, TO);
    expect(across[0]).toBe(PLAIN);
  });

  it("leaves a size typed since it was made fluid, which no longer matches", () => {
    const typed = fluidStyle("20px");
    const across = classesAcrossFluidRange([typed], FROM, TO);
    expect(across[0]).toBe(typed);
  });

  it("returns the same list when nothing is made again", () => {
    const classes = [PLAIN];
    expect(classesAcrossFluidRange(classes, FROM, TO)).toBe(classes);
    const fluid = [fluidStyle(fluidValue(SIZES, FROM))];
    expect(classesAcrossFluidRange(fluid, FROM, FROM)).toBe(fluid);
  });

  it("skips sizes it cannot use rather than making a value from them", () => {
    const odd = {
      ...fluidStyle(fluidValue(SIZES, FROM)),
      fluidSizes: { base: { small: -1, large: 32 } },
    } as NamedClass;
    expect(classesAcrossFluidRange([odd], FROM, TO)[0]).toBe(odd);
  });
});

describe("fluid sizes an edit leaves beside a size they no longer make", () => {
  const MADE = fluidValue(SIZES, FROM);
  /** Lead with each device's size, each made fluid from `SIZES`. */
  const both = (desktop: unknown, mobile: unknown): NamedClass =>
    ({
      ...fluidStyle(MADE),
      styles: {
        base: { base: { fontSize: desktop }, mobile: { fontSize: mobile } },
      },
      fluidSizes: { base: SIZES, mobile: SIZES },
    }) as NamedClass;

  it("drops the sizes of each device whose size the edit changed", () => {
    const before = both(MADE, MADE);
    const typed = withoutStaleFluidSizes(both("20px", MADE), before);
    expect(typed.fluidSizes).toEqual({ mobile: SIZES });
    expect(typed.styles.base?.base?.fontSize).toBe("20px");
    // Pointed at a variable, or reset: the same.
    const variable = { $token: "font-size.lg" };
    expect(
      withoutStaleFluidSizes(both(MADE, variable), before).fluidSizes
    ).toEqual({ base: SIZES });
    expect(
      withoutStaleFluidSizes(both(undefined, undefined), before)
    ).not.toHaveProperty("fluidSizes");
  });

  it("is the class itself where no size changed, or the sizes are set anew", () => {
    const before = both(MADE, MADE);
    const same = both(MADE, MADE);
    expect(withoutStaleFluidSizes(same, before)).toBe(same);
    const remade = {
      ...both(fluidValue({ small: 14, large: 28 }, FROM), MADE),
      fluidSizes: { base: { small: 14, large: 28 }, mobile: SIZES },
    } as NamedClass;
    expect(withoutStaleFluidSizes(remade, before)).toBe(remade);
    // A class it has nothing to compare with, such as a new one.
    expect(withoutStaleFluidSizes(remade, undefined)).toBe(remade);
  });

  it("keeps sizes whose size is the value they make across the range given", () => {
    const before = both(MADE, MADE);
    const across = both(fluidValue(SIZES, TO), "20px");
    expect(withoutStaleFluidSizes(across, before, TO).fluidSizes).toEqual({
      base: SIZES,
    });
    // Across the old range, the new value is not theirs.
    expect(withoutStaleFluidSizes(across, before, FROM)).not.toHaveProperty(
      "fluidSizes"
    );
  });

  it("puts dropped sizes back where Undo puts their size back", () => {
    const before = both(MADE, MADE);
    const dropped = withoutStaleFluidSizes(both("20px", MADE), before);
    const undone = { ...dropped, styles: before.styles };
    expect(withFluidSizesBack(undone, before).fluidSizes).toEqual({
      base: SIZES,
      mobile: SIZES,
    });
    // Still another size there: nothing is put back.
    expect(withFluidSizesBack(dropped, before)).toBe(dropped);
  });
});
