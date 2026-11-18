import { describe, expect, it } from "vitest";

import { variantPrunes } from "./variant-prune";

describe("taking fields' values out of a component's variants", () => {
  const variants = {
    compact: { label: "Compact", overrides: { passage: "a", title: "T" } },
    bare: { label: "Bare", overrides: { passage: "b" } },
    plain: { label: "Plain", overrides: { title: "In short" } },
  };

  it("names each variant that loses a value, with what it keeps", () => {
    expect(variantPrunes(variants, new Set(["passage"]))).toEqual([
      {
        variant: "compact",
        label: "Compact",
        emptied: false,
        overrides: { title: "T" },
      },
      { variant: "bare", label: "Bare", emptied: true, overrides: {} },
    ]);
  });

  it("leaves the variants it reads as they were", () => {
    variantPrunes(variants, new Set(["passage", "title"]));
    expect(variants.compact.overrides).toEqual({ passage: "a", title: "T" });
  });

  it("names a variant with no label by its key", () => {
    expect(
      variantPrunes({ v1: { overrides: { x: 1 } } }, new Set(["x"]))
    ).toEqual([{ variant: "v1", label: "v1", emptied: true, overrides: {} }]);
  });

  it("finds nothing to take from what is not a set of variants", () => {
    expect(variantPrunes(undefined, new Set(["x"]))).toEqual([]);
    expect(variantPrunes({ v: "not a variant" }, new Set(["x"]))).toEqual([]);
    expect(variantPrunes(variants, new Set())).toEqual([]);
  });

  it("keeps a stored `__proto__` value as the variant's own", () => {
    // Parsed, as a stored document is: a literal would set the prototype.
    const overrides: Record<string, unknown> = JSON.parse(
      '{"__proto__": "p", "x": 1}'
    );
    const [prune] = variantPrunes(
      { v: { label: "V", overrides } },
      new Set(["x"])
    );
    expect(Object.hasOwn(prune?.overrides ?? {}, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(prune?.overrides)).toBe(Object.prototype);
  });
});
