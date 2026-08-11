/**
 * The contrast harness and the published colour engine share one colour type,
 * and agree on what its numbers mean.
 *
 * `contrast/color.ts` used to declare its own structurally identical `Rgb`.
 * Two definitions of one concept in one package drift, and this drift would be
 * silent in the worst way: both put channels in [0, 1] today, so moving either
 * to 0-255 would typecheck, produce wrong ratios in every pairing, and leave
 * the contrast suite green -- because both sides of every comparison shift
 * together. A shape match is not a semantics match.
 *
 * `contrast/Rgb` is now an alias of `lib/color`'s `Rgba`, which removes the
 * second definition. What an alias cannot state is that the two modules read
 * the numbers the same way, so that is what this pins.
 */
import { describe, expect, it } from "vitest";

import { toHex as publishedToHex, type Rgba } from "../../../lib/color/hex";
import { compositeOver, toHex, toClampedRgb, type Rgb } from "../color";

/** A value both modules must agree about, opaque and translucent. */
const SAMPLES: ReadonlyArray<{ label: string; value: Rgba }> = [
  { label: "black", value: { r: 0, g: 0, b: 0, alpha: 1 } },
  { label: "white", value: { r: 1, g: 1, b: 1, alpha: 1 } },
  { label: "mid grey", value: { r: 0.5, g: 0.5, b: 0.5, alpha: 1 } },
  {
    label: "a channel that rounds",
    value: { r: 0.2, g: 0.4, b: 0.6, alpha: 1 },
  },
  // Alpha differs between the two signatures: the harness ignores the
  // object's, the published one reads its own parameter. This is the sample
  // that would expose the difference if either changed.
  { label: "half transparent", value: { r: 0.2, g: 0.4, b: 0.6, alpha: 0.5 } },
];

describe("one colour type across the harness and the engine", () => {
  it("carries an alpha on every value the harness produces", () => {
    // What a RUNTIME test can prove about the type, which is not identity.
    //
    // Type identity is compile-time only, and this package typechecks zero
    // test files -- `tsconfig.json` excludes every test glob -- so a
    // type-level assertion here would be transpiled away and pass no matter
    // what. That was tried: widening `Rgb` to `alpha?: number` left an
    // assignment assertion green, because nothing ever typechecked it.
    //
    // So the property is asserted where it bites instead. `compositeOver`
    // reads `.alpha` unconditionally; if the type ever went optional and a
    // producer stopped setting it, the arithmetic yields NaN rather than a
    // compile error. Every entry point is checked for a real number.
    const produced = [
      toClampedRgb("#ff0000"),
      toClampedRgb("oklch(0.5 0 0 / 0.25)"),
      compositeOver(
        { r: 1, g: 0, b: 0, alpha: 0.5 },
        { r: 0, g: 0, b: 1, alpha: 1 }
      ),
    ];

    const missing = produced.filter(
      value => typeof value.alpha !== "number" || Number.isNaN(value.alpha)
    );

    expect(
      missing,
      `A colour left the harness without a usable alpha. compositeOver ` +
        `multiplies by it, so an undefined one produces NaN channels and ` +
        `every ratio computed from them silently becomes NaN.`
    ).toEqual([]);
  });

  it("propagates a missing alpha as NaN, which is why the type must require it", () => {
    // The positive control for the test above: proof that the failure it
    // guards against is real rather than theoretical. A value with no alpha
    // does not throw and does not default -- it poisons the arithmetic.
    const noAlpha = { r: 1, g: 0, b: 0 } as unknown as Rgb;
    const composited = compositeOver(noAlpha, { r: 0, g: 0, b: 1, alpha: 1 });

    expect(Number.isNaN(composited.r)).toBe(true);
  });

  it("reads channels in the same units", () => {
    // The check that a shape match cannot make. If one module moved to 0-255,
    // 1.0 would render as #010101 there and #ffffff here, and nothing else in
    // either suite would notice.
    expect(toHex({ r: 1, g: 1, b: 1, alpha: 1 })).toBe("#ffffff");
    expect(publishedToHex({ r: 1, g: 1, b: 1 })).toBe("#ffffff");
    expect(toHex({ r: 0, g: 0, b: 0, alpha: 1 })).toBe("#000000");
    expect(publishedToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
  });

  it("formats the same colour identically, ignoring alpha on both sides", () => {
    // The harness's `toHex` takes alpha from nowhere; the published one takes
    // it from a parameter defaulting to 1. They agree only because the
    // harness never passes one -- compatible by accident, which is a fine
    // thing to rely on and a bad thing to assume.
    const disagreeing = SAMPLES.filter(
      ({ value }) => toHex(value) !== publishedToHex(value)
    ).map(({ label }) => label);

    expect(
      disagreeing,
      `The two hex formatters disagree about a colour. They are relied on ` +
        `interchangeably in failure messages, so a divergence would make two ` +
        `reports of the same pairing name different colours.`
    ).toEqual([]);
  });

  it("parses to the shared type with alpha carried, not defaulted", () => {
    // `toClampedRgb` is the harness's entry point and the reason the type
    // needs alpha at all: a translucent token composited over its surface is
    // the whole point of the contrast maths.
    const opaque = toClampedRgb("#ff0000");
    expect(opaque.alpha).toBe(1);

    const translucent = toClampedRgb("oklch(0.5 0 0 / 0.5)");
    expect(translucent.alpha).toBeCloseTo(0.5, 5);
  });
});
