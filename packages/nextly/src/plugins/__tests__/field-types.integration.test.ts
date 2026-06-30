/**
 * C7 / D16 — custom field-type registry, end-to-end.
 *
 * A plugin-registered field type (a) maps to its storage primitive in the DDL
 * classifier, (b) is accepted by collection-config validation once registered,
 * and (c) persists through a real boot. The registry is populated at boot before
 * schema sync; config validation requires the type to be registered before the
 * config is validated (UI/Builder collections validate at runtime, after boot;
 * code-first collections should register the type first or be plugin-contributed
 * raw config).
 */
import { afterEach, describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
import { validateCollectionConfig } from "../../collections/config/validate-config";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../domains/schema/field-types/field-type-registry";
import { getColumnDescriptor } from "../../domains/schema/services/field-column-descriptor";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  clearFieldTypes();
});

const ratingType = {
  type: "rating",
  storage: "number",
  component: "@test/ft/admin#Rating",
} as const;

describe("custom field types", () => {
  it("maps a registered custom type to its storage primitive (DDL classifier)", () => {
    registerFieldType({ ...ratingType });
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

  it("config validation accepts a registered custom type, rejects an unregistered one", () => {
    const cfg = {
      slug: "ratings",
      fields: [
        { name: "title", type: "text" },
        { name: "score", type: "rating" },
      ],
    } as unknown as CollectionConfig;

    // Unregistered → rejected with FIELD_TYPE_INVALID.
    const before = validateCollectionConfig(cfg);
    expect(before.valid).toBe(false);
    expect(before.errors.some(e => e.code === "FIELD_TYPE_INVALID")).toBe(true);

    // Registered → accepted.
    registerFieldType({ ...ratingType });
    const after = validateCollectionConfig(cfg);
    expect(after.errors.some(e => e.code === "FIELD_TYPE_INVALID")).toBe(false);
  });

  it("persists a custom-typed field end-to-end through a real boot", async () => {
    const plugin = definePlugin({
      name: "@test/field-types",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        fieldTypes: [{ ...ratingType }],
        // Raw collection config (not defineCollection) — validated at boot,
        // after the plugin's field type is registered.
        collections: [
          {
            slug: "ratings",
            fields: [
              { name: "title", type: "text" },
              { name: "score", type: "rating" },
            ],
          } as unknown as CollectionConfig,
        ],
      },
    });

    current = await createTestNextly({ plugins: [plugin] });
    const created = await current.nextly.create({
      collection: "ratings",
      data: { title: "x", score: 5 },
    });
    const id = (created.item as { id: string }).id;
    const got = await current.nextly.findByID({ collection: "ratings", id });
    expect((got as { score?: number } | null)?.score).toBe(5);
  });
});
