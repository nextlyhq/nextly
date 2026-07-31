/**
 * Codegen and the startup sync both fold a declared user field into the flat
 * record shape. They read the same function so they cannot disagree about what
 * a field declared — a disagreement would hand a plugin's editor options the
 * generated types promised it would not have, or drop ones it needs.
 */
import { describe, expect, it } from "vitest";

import type { UserFieldConfig } from "../../../users";
import { carriedUserFieldOptions } from "../user-field-plugin-options";

/** A declaration as an app author writes it, cast at the boundary only. */
function field(declared: Record<string, unknown>): UserFieldConfig {
  return declared as unknown as UserFieldConfig;
}

describe("carriedUserFieldOptions", () => {
  it("carries nothing for a field that declares only modelled keys", () => {
    expect(
      carriedUserFieldOptions(
        field({ name: "phone", type: "text", required: true, label: "Phone" })
      )
    ).toBeNull();
  });

  it("carries an option a contributed type declared for itself", () => {
    expect(
      carriedUserFieldOptions(
        field({ name: "score", type: "rating", scale: 5 })
      )
    ).toMatchObject({ scale: 5 });
  });

  it("flattens the pluginOptions container onto the record", () => {
    // Declared either way, a type reads its options off one flat record.
    expect(
      carriedUserFieldOptions(
        field({ name: "score", type: "rating", pluginOptions: { scale: 10 } })
      )
    ).toMatchObject({ scale: 10 });
  });

  it("carries the originals of keys the record renames", () => {
    // `min`/`max` reach the record as `minValue`/`maxValue`, so a type reading
    // them by their declared names would otherwise find nothing.
    const carried = carriedUserFieldOptions(
      field({ name: "score", type: "rating", min: 1, max: 5 })
    );

    expect(carried).toMatchObject({ min: 1, max: 5 });
  });

  it("refuses an option the JSON column would reshape", () => {
    // A Set becomes `{}` and a Date becomes a string once persisted, so the
    // component is handed something other than what was declared. Refused at
    // the declaration rather than discovered in the editor.
    for (const value of [new Set([1]), new Map(), new Date()]) {
      expect(() =>
        carriedUserFieldOptions(
          field({ name: "score", type: "rating", pluginOptions: { value } })
        )
      ).toThrow();
    }
  });

  it("accepts one object referenced twice without a cycle", () => {
    // Two properties pointing at the same object is not a cycle: JSON encodes
    // it at both locations. Treating every visited object as cyclic refused a
    // declaration that persists perfectly well.
    const shared = { scale: 5 };

    expect(
      carriedUserFieldOptions(
        field({
          name: "score",
          type: "rating",
          // Nested under ONE option, because each top-level option is walked
          // with its own path — two sibling options referencing the same object
          // never share the state this guards.
          pluginOptions: { scales: { left: shared, right: shared } },
        })
      )
    ).toMatchObject({ scales: { left: { scale: 5 }, right: { scale: 5 } } });
  });

  it("accepts the same object twice inside an array", () => {
    const shared = { a: 1 };

    expect(() =>
      carriedUserFieldOptions(
        field({
          name: "score",
          type: "rating",
          pluginOptions: { list: [shared, shared] },
        })
      )
    ).not.toThrow();
  });

  it("refuses a sparse array, whose holes become null", () => {
    // `Array.prototype.every` skips holes, so these passed while JSON turned
    // each hole into `null` — the component then receives different data.
    const withHole = [1, undefined, 3];
    delete withHole[1];

    for (const list of [new Array(2), withHole]) {
      expect(() =>
        carriedUserFieldOptions(
          field({ name: "score", type: "rating", pluginOptions: { list } })
        )
      ).toThrow();
    }
  });

  it("refuses an option that cannot be serialized at all", () => {
    // These throw during serialization, which would take the whole code-field
    // sync down rather than failing this one declaration.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    for (const value of [1n, cyclic]) {
      expect(() =>
        carriedUserFieldOptions(
          field({ name: "score", type: "rating", pluginOptions: { value } })
        )
      ).toThrow();
    }
  });

  it("accepts the JSON shapes an option is actually written in", () => {
    expect(
      carriedUserFieldOptions(
        field({
          name: "score",
          type: "rating",
          pluginOptions: {
            scale: 5,
            labels: ["low", "high"],
            nested: { allow: true, note: null },
          },
        })
      )
    ).toMatchObject({ scale: 5 });
  });

  it("refuses an option that would restate the field's identity", () => {
    // The folded record restates `type` and `name` as the identity a type is
    // handed, so an option under either would be replaced before the type that
    // declared it could read it.
    expect(() =>
      carriedUserFieldOptions(
        field({ name: "score", type: "rating", pluginOptions: { type: "x" } })
      )
    ).toThrow();
  });

  it("collects an option named after a prototype accessor", () => {
    // Parsed rather than written as a literal, where `__proto__` would set the
    // prototype instead of becoming a key. Collected by defining rather than
    // assigning, which would repoint the carrier instead of recording it.
    const pluginOptions = JSON.parse('{"__proto__": 1}') as Record<
      string,
      unknown
    >;

    const carried = carriedUserFieldOptions(
      field({ name: "score", type: "rating", pluginOptions })
    );

    expect(Object.keys(carried ?? {})).toContain("__proto__");
  });
});
