/**
 * The sanitization descent follows the fields whose values are nested
 * documents, under the shapes those values really take.
 *
 * A stored field-group definition is a LEAF reference by slug — `component` /
 * `components`, or the migrated `fieldGroup` / `fieldGroups` — so its child
 * definitions are never inline: they reach the descent through the enrichment
 * `attachFieldGroupChildren` attaches (`componentFields` for a single
 * reference, `componentSchemas` for a zone). Fixtures here are shaped that
 * way, plus the inline shape a hand-written nested definition may carry.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  attachFieldGroupChildren,
  sanitizeEntryData,
} from "../sanitization-service";

const field = (f: Record<string, unknown>): FieldDefinition =>
  f as unknown as FieldDefinition;

describe("sanitizeEntryData — nested-document descent", () => {
  it("strips tags from a plain text field", () => {
    const data = { title: "<b>Hello</b>" };
    sanitizeEntryData(data, [field({ name: "title", type: "text" })]);
    expect(data.title).toBe("Hello");
  });

  it("leaves rich text and json alone", () => {
    const data = {
      body: "<p>kept</p>",
      meta: "<script>kept</script>",
    };
    sanitizeEntryData(data, [
      field({ name: "body", type: "richText" }),
      field({ name: "meta", type: "json" }),
    ]);
    expect(data.body).toBe("<p>kept</p>");
    expect(data.meta).toBe("<script>kept</script>");
  });

  it.each(["component", "fieldGroup"] as const)(
    "descends into an enriched %s single reference, under either reference key",
    fieldType => {
      const children = [
        field({ name: "title", type: "text" }),
        field({ name: "note", type: "text" }),
      ];
      const data = {
        seo: { title: "<i>x</i>", note: "clean" },
        alt: { title: "<i>y</i>" },
      };
      sanitizeEntryData(data, [
        field({
          name: "seo",
          type: fieldType,
          component: "seo",
          componentFields: children,
        }),
        field({
          name: "alt",
          type: fieldType,
          fieldGroup: "seo",
          componentFields: children,
        }),
      ]);
      expect(data.seo).toEqual({ title: "x", note: "clean" });
      expect(data.alt).toEqual({ title: "y" });
    }
  );

  it.each(["component", "fieldGroup"] as const)(
    "resolves every row of an enriched %s zone by its own instance type",
    fieldType => {
      // A zone's instances differ in schema, so the descent must pick each
      // row's children by the row's own type — not by the field's reference.
      const data = {
        slots: [
          { _componentType: "hero", title: "<i>a</i>" },
          { _componentType: "cta", label: "<i>b</i>" },
        ],
      };
      sanitizeEntryData(data, [
        field({
          name: "slots",
          type: fieldType,
          components: ["hero", "cta"],
          componentSchemas: {
            hero: { fields: [field({ name: "title", type: "text" })] },
            cta: { fields: [field({ name: "label", type: "text" })] },
          },
        }),
      ]);
      expect(data.slots).toEqual([
        { _componentType: "hero", title: "a" },
        { _componentType: "cta", label: "b" },
      ]);
    }
  );

  it("reads a zone row typed under the migrated wire key", () => {
    // The storage migration renames the key INSIDE stored rows, so a document
    // rewritten under it must still resolve its schema.
    const data = {
      slots: [{ _fieldGroupType: "hero", title: "<i>a</i>" }],
    };
    sanitizeEntryData(data, [
      field({
        name: "slots",
        type: "fieldGroup",
        fieldGroups: ["hero"],
        componentSchemas: {
          hero: { fields: [field({ name: "title", type: "text" })] },
        },
      }),
    ]);
    expect(data.slots).toEqual([{ _fieldGroupType: "hero", title: "a" }]);
  });

  it.each(["component", "fieldGroup"] as const)(
    "descends into a %s field carrying inline child definitions",
    fieldType => {
      const data = {
        seo: { title: "<i>x</i>", note: "clean" },
      };
      sanitizeEntryData(data, [
        field({
          name: "seo",
          type: fieldType,
          fields: [
            field({ name: "title", type: "text" }),
            field({ name: "note", type: "text" }),
          ],
        }),
      ]);
      expect(data.seo).toEqual({ title: "x", note: "clean" });
    }
  );

  it("leaves a leaf reference with no resolvable children as stored", () => {
    // The registry lookup failed or the type is gone: the reference carries no
    // children, and there is nothing to descend into.
    const data = { seo: { title: "<i>x</i>" } };
    sanitizeEntryData(data, [
      field({ name: "seo", type: "component", component: "seo" }),
    ]);
    expect(data.seo).toEqual({ title: "<i>x</i>" });
  });
});

describe("attachFieldGroupChildren", () => {
  // The enrichment reads attached children structurally, so this stub reads
  // them back the same way rather than through a field-type that has no arm
  // for them.
  const childrenOf = (f: FieldDefinition): FieldDefinition[] | undefined =>
    (f as { componentFields?: FieldDefinition[] }).componentFields;

  const resolver = async (
    slug: string
  ): Promise<FieldDefinition[] | undefined> =>
    slug === "seo" ? [field({ name: "title", type: "text" })] : undefined;

  it.each(["component", "fieldGroup"] as const)(
    "attaches the referenced children of a %s single reference",
    async fieldType => {
      const fields = await attachFieldGroupChildren(
        [field({ name: "seo", type: fieldType, component: "seo" })],
        resolver
      );
      expect(childrenOf(fields[0])).toHaveLength(1);
    }
  );

  it.each(["component", "fieldGroup"] as const)(
    "attaches a per-slug schema map for a %s zone",
    async fieldType => {
      const fields = await attachFieldGroupChildren(
        [
          field({
            name: "layout",
            type: fieldType,
            fieldGroups: ["hero", "seo"],
          }),
        ],
        resolver
      );
      const schemas = (
        fields[0] as { componentSchemas?: Record<string, unknown> }
      ).componentSchemas;
      expect(Object.keys(schemas ?? {})).toEqual(["seo"]);
    }
  );

  it("walks container fields to reach their nested field-group references", async () => {
    const fields = await attachFieldGroupChildren(
      [
        field({
          name: "page",
          type: "repeater",
          fields: [
            field({ name: "seo", type: "fieldGroup", fieldGroup: "seo" }),
          ],
        }),
      ],
      resolver
    );
    const nested = fields[0].fields as FieldDefinition[];
    expect(childrenOf(nested[0])).toHaveLength(1);
  });

  it("leaves a field untouched when its reference resolves to nothing", async () => {
    const raw = field({ name: "seo", type: "component", component: "gone" });
    const fields = await attachFieldGroupChildren([raw], resolver);
    expect(childrenOf(fields[0])).toBeUndefined();
  });
});
