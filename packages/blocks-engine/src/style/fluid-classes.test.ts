import { describe, expect, it } from "vitest";

import { classesAcrossFluidRange } from "./fluid-classes";
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
