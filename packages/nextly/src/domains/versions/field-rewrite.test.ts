/**
 * What a field rewrite decides on its own: the request it takes, the fields it
 * may name, the drafts it reaches and each copy's new value.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors";

import {
  assertRewritableField,
  copyLabel,
  draftSlotsHolding,
  parseFieldRewrite,
  rewriteCallerOf,
  rewritesSingle,
  rewrittenValue,
  type DraftSlot,
  type RewritableFieldShape,
} from "./field-rewrite";

const REQUEST = {
  collection: "pages",
  id: "p1",
  field: "layout",
  expectedVersion: "7",
  set: { value: null },
  reason: "Layout 'Wide' was deleted",
};

/** The same rewrite, of a Single, which names no id. */
const SINGLE_REQUEST = {
  single: "site",
  field: "layout",
  expectedVersion: "7",
  set: { value: null },
  reason: "Layout 'Wide' was deleted",
};

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof NextlyError ? error.code : "not-a-nextly-error";
  }
  return undefined;
}

describe("parseFieldRewrite", () => {
  it("takes a whole request, a cleared value included", () => {
    expect(parseFieldRewrite(REQUEST)).toMatchObject({
      field: "layout",
      set: { value: null },
    });
  });

  it("takes a function of each copy's value", () => {
    const from = (current: unknown) => current;
    expect(parseFieldRewrite({ ...REQUEST, set: { from } }).set).toHaveProperty(
      "from",
      from
    );
  });

  it.each([
    ["no version", { expectedVersion: undefined }],
    ["no reason", { reason: undefined }],
    ["a blank reason", { reason: "   " }],
    ["a reason past the note's length", { reason: "x".repeat(4001) }],
    ["no value", { set: {} }],
    ["a value and a function", { set: { value: 1, from: () => 1 } }],
    ["a `from` that is no function", { set: { from: "upper" } }],
    ["an extra key", { overwrite: true }],
    ["no id", { id: "" }],
  ])("refuses %s with INVALID_INPUT", (_name, change) => {
    expect(codeOf(() => parseFieldRewrite({ ...REQUEST, ...change }))).toBe(
      "INVALID_INPUT"
    );
  });

  it("takes a Single by its slug, through the same shape", () => {
    const request = parseFieldRewrite(SINGLE_REQUEST);
    expect(request).toMatchObject({ single: "site", field: "layout" });
    expect(rewritesSingle(request)).toBe(true);
    expect(rewritesSingle(parseFieldRewrite(REQUEST))).toBe(false);
  });

  it.each([
    ["a Single named beside an entry", { ...REQUEST, single: "site" }],
    ["a Single given an id", { ...SINGLE_REQUEST, id: "p1" }],
    ["a blank Single", { ...SINGLE_REQUEST, single: " " }],
    ["a Single with no reason", { ...SINGLE_REQUEST, reason: " " }],
  ])("refuses %s with INVALID_INPUT", (_name, request) => {
    expect(codeOf(() => parseFieldRewrite(request))).toBe("INVALID_INPUT");
  });

  it("refuses a field inside a group, which rewrites only part of a value", () => {
    expect(
      codeOf(() => parseFieldRewrite({ ...REQUEST, field: "hero.title" }))
    ).toBe("INVALID_INPUT");
  });
});

describe("assertRewritableField", () => {
  const fields: RewritableFieldShape[] = [
    { name: "layout", type: "relationship" },
    { name: "blocks", type: "json" },
    { name: "code", type: "text", unique: true },
    { name: "computed", type: "text", virtual: true },
    { name: "derived", type: "group", options: { virtual: true } },
    { name: "secret", type: "password" },
    { name: "seo", type: "component" },
    {
      name: "tags",
      type: "relationship",
      options: { relationType: "manyToMany" },
    },
  ];
  const separately = (f: RewritableFieldShape) =>
    f.type === "component" || f.options?.relationType === "manyToMany";

  it("takes a field stored on the document's own row", () => {
    expect(assertRewritableField(fields, "layout", separately).name).toBe(
      "layout"
    );
    expect(assertRewritableField(fields, "blocks", separately).name).toBe(
      "blocks"
    );
  });

  it.each([
    ["the id", "id"],
    ["the status", "status"],
    ["the slug", "slug"],
    ["a timestamp", "updatedAt"],
    ["an unknown field", "nope"],
    ["a unique field", "code"],
    ["a virtual field", "computed"],
    ["a field virtual by its options", "derived"],
    ["a password", "secret"],
    ["a field group", "seo"],
    ["a many-to-many relationship", "tags"],
  ])("refuses %s, naming it", (_name, field) => {
    let message = "";
    const code = codeOf(() => {
      try {
        assertRewritableField(fields, field, separately);
      } catch (error) {
        message = error instanceof NextlyError ? error.publicMessage : "";
        throw error;
      }
    });
    expect(code).toBe("INVALID_INPUT");
    expect(message).toContain(`"${field}"`);
  });
});

describe("draftSlotsHolding", () => {
  const slot = (
    locale: string | null,
    snapshot: Record<string, unknown>
  ): DraftSlot => ({ locale, snapshot, createdBy: null });
  const slots = [
    slot("en", { layout: "a", title: "Hello" }),
    slot("de", { layout: "a", title: "Hallo" }),
    slot(null, { other: 1 }),
  ];

  it("reaches every draft holding a shared field", () => {
    expect(draftSlotsHolding(slots, "layout", null).map(s => s.locale)).toEqual(
      ["en", "de"]
    );
  });

  it("reaches only the named language's draft for a translated field", () => {
    expect(
      draftSlotsHolding(slots, "title", { locale: "de" }).map(s => s.locale)
    ).toEqual(["de"]);
  });

  it("reaches no draft that does not hold the field", () => {
    expect(draftSlotsHolding(slots, "missing", null)).toEqual([]);
  });
});

describe("rewrittenValue", () => {
  const live = { form: "live", locale: null } as const;
  const draft = { form: "draft", locale: "de" } as const;

  it("gives every copy a given value", async () => {
    expect(await rewrittenValue({ value: "x" }, "old", live)).toBe("x");
    expect(await rewrittenValue({ value: "x" }, "older", draft)).toBe("x");
  });

  it("computes each copy's value from its own, handed a copy of it", async () => {
    const stored = { blocks: [1] };
    const seen: unknown[] = [];
    const next = await rewrittenValue(
      {
        from: (current, copy) => {
          seen.push(copy);
          (current as { blocks: number[] }).blocks.push(2);
          return current;
        },
      },
      stored,
      draft
    );
    expect(next).toEqual({ blocks: [1, 2] });
    // The stored value itself is untouched.
    expect(stored).toEqual({ blocks: [1] });
    expect(seen).toEqual([draft]);
  });

  it("refuses a function that answers nothing", async () => {
    await expect(
      rewrittenValue({ from: () => undefined }, "old", live)
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("copyLabel", () => {
  it("names each copy as history records it", () => {
    expect(copyLabel({ form: "live", locale: null })).toBe("live");
    expect(copyLabel({ form: "draft", locale: null })).toBe("draft");
    expect(copyLabel({ form: "draft", locale: "es" })).toBe("draft:es");
  });
});

describe("rewriteCallerOf", () => {
  it("names who the rewrite is made as, and the plugin making it", () => {
    expect(
      rewriteCallerOf(
        { user: { id: "u1" }, overrideAccess: false, actor: undefined },
        "seo"
      )
    ).toEqual({
      user: { id: "u1" },
      overrideAccess: false,
      authenticatedScope: undefined,
      plugin: "seo",
    });
  });

  it("refuses a language named in the call's options, not the request", () => {
    expect(
      codeOf(() =>
        rewriteCallerOf({ locale: "de", overrideAccess: true }, undefined)
      )
    ).toBe("INVALID_INPUT");
  });
});
