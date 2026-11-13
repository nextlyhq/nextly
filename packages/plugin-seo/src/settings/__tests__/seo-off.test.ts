import { describe, expect, it, vi } from "vitest";

import { namedSeoTypes } from "../../seo-types";
import { seoSettingsSingle } from "../single";
import { seoOffTypes } from "../seo-off";
import { typesWithSeoOffProblem } from "../stored-values";

describe("the stored list of types with SEO off", () => {
  it("is a field of its own on the settings Single", () => {
    const names = seoSettingsSingle().fields.map(field =>
      "name" in field ? field.name : undefined
    );
    expect(names).toContain("typesWithSeoOff");
  });

  it("accepts a list of type keys, and nothing at all", () => {
    expect(typesWithSeoOffProblem(["posts", "single:home"])).toBeNull();
    expect(typesWithSeoOffProblem(undefined)).toBeNull();
    expect(typesWithSeoOffProblem(null)).toBeNull();
  });

  it("refuses anything else", () => {
    expect(typesWithSeoOffProblem("posts")).not.toBeNull();
    expect(typesWithSeoOffProblem([1])).not.toBeNull();
  });
});

describe("seoOffTypes", () => {
  const types = namedSeoTypes(["posts", "authors"], ["home"]);

  it("is each stored key the plugin adds SEO to, as a type", () => {
    expect(
      seoOffTypes({ typesWithSeoOff: ["authors", "single:home"] }, types)
    ).toEqual([
      { kind: "collection", slug: "authors" },
      { kind: "single", slug: "home" },
    ]);
  });

  it("is none where nothing is stored, as on a site whose column is not there yet", () => {
    expect(seoOffTypes({}, types)).toEqual([]);
  });

  it("ignores a key for a type without SEO, warning once for it", () => {
    const warn = vi.fn();
    const stored = { typesWithSeoOff: ["gone", "posts"] };
    expect(seoOffTypes(stored, types, warn)).toEqual([
      { kind: "collection", slug: "posts" },
    ]);
    seoOffTypes(stored, types, warn);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("gone");
  });
});
