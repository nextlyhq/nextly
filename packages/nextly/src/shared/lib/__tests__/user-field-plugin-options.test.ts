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
