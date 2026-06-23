/**
 * C7 / D16 (M9a) — custom field-type registry, storage-classifier seam.
 *
 * Scope shipped here: a plugin-registered field type maps to its storage
 * primitive so the DDL classifier (`classifyFieldKind`) produces the right
 * column kind. Wiring custom types through eager collection-config validation
 * (`validate-config.ts` rejects unknown `field.type` at `defineCollection()`
 * time, before boot registers them) and the admin field renderer is the M9
 * remainder — see the spec.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../domains/schema/field-types/field-type-registry";
import { getColumnDescriptor } from "../../domains/schema/services/field-column-descriptor";
import type { FieldDefinition } from "../../schemas/dynamic-collections";

afterEach(() => clearFieldTypes());

describe("custom field types — storage seam (C7/D16, M9a)", () => {
  it("maps a registered custom type to its storage primitive (DDL classifier)", () => {
    registerFieldType({
      type: "rating",
      storage: "number",
      component: "@p/admin#Rating",
    });
    expect(
      getColumnDescriptor(
        { name: "score", type: "rating" } as unknown as FieldDefinition,
        "sqlite"
      )?.kind
    ).toBe("integer");
  });

  it("falls back to text for an unregistered unknown type (unchanged legacy default)", () => {
    expect(
      getColumnDescriptor(
        { name: "x", type: "totally-unknown" } as unknown as FieldDefinition,
        "sqlite"
      )?.kind
    ).toBe("text");
  });
});
