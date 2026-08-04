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
import { assertPluginFieldDeclarations } from "../../shared/lib/assert-plugin-field-declarations";
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
        "sqlite",
        "codeFirst"
      )?.kind
    ).toBe("integer");
  });

  it("falls back to text for an unregistered unknown type (unchanged legacy default)", () => {
    expect(
      getColumnDescriptor(
        { name: "x", type: "totally-unknown" } as unknown as FieldDefinition,
        "sqlite",
        "codeFirst"
      )?.kind
    ).toBe("text");
  });

  it("config validation defers an unregistered custom type, boot refuses it", () => {
    const cfg = {
      slug: "ratings",
      fields: [
        { name: "title", type: "text" },
        { name: "score", type: "rating" },
      ],
    } as unknown as CollectionConfig;

    // Unregistered → deferred here, because a plugin registers its types after
    // every define* call has run. Refusing now would refuse every contributed
    // type outright.
    const before = validateCollectionConfig(cfg);
    expect(before.errors.some(e => e.code === "FIELD_TYPE_INVALID")).toBe(
      false
    );

    // ...and refused at boot, which is the first point the answer is knowable.
    expect(() =>
      assertPluginFieldDeclarations({ collections: [cfg] })
    ).toThrow();

    // Registered → accepted by both.
    registerFieldType({ ...ratingType });
    const after = validateCollectionConfig(cfg);
    expect(after.errors.some(e => e.code === "FIELD_TYPE_INVALID")).toBe(false);
    expect(() =>
      assertPluginFieldDeclarations({ collections: [cfg] })
    ).not.toThrow();
  });

  it("rejects a registered type that did not opt into the entries surface", () => {
    // Registration is not authorization: a forms-only type must not validate on
    // a collection (entries surface), or the entry editor would try to render a
    // component the plugin never opted in there.
    registerFieldType({ ...ratingType, surfaces: ["forms"] });
    // Refused at boot rather than at define time: registration is what makes
    // the surface knowable, and that happens after the config is built.
    expect(() =>
      assertPluginFieldDeclarations({
        collections: [
          {
            slug: "ratings",
            fields: [{ name: "score", type: "rating" }],
          },
        ],
      })
    ).toThrow();

    // And deferred, not refused, by the define-time validators: they run before
    // the registry is populated, so the surface is not knowable there either.
    const result = validateCollectionConfig({
      slug: "ratings",
      fields: [{ name: "score", type: "rating" }],
    } as unknown as CollectionConfig);
    expect(result.errors.some(e => e.code === "FIELD_TYPE_INVALID")).toBe(
      false
    );
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
