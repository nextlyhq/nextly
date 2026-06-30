import { describe, expect, it } from "vitest";

import { definePlugin } from "./plugin-context";

const base = () =>
  definePlugin({
    name: "@t/p",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: { collections: [] },
  });

describe("definePlugin .rename", () => {
  it("returns a new definition carrying the renameMap, original unchanged", () => {
    const p = base();
    const renamed = p.rename!({ forms: "contact-forms" });

    expect(renamed.renameMap).toEqual({ forms: "contact-forms" });
    expect(p.renameMap).toBeUndefined(); // original untouched
    expect(renamed).not.toBe(p);
    expect(renamed.name).toBe("@t/p"); // other fields carried
    expect(typeof renamed.rename).toBe("function"); // chainable
  });

  it("merges chained renames", () => {
    const p = base().rename!({ forms: "contact-forms" }).rename!({
      submissions: "leads",
    });

    expect(p.renameMap).toEqual({
      forms: "contact-forms",
      submissions: "leads",
    });
  });
});
