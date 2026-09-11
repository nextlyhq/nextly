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
  stripHtmlTags,
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

  it("tolerates a null componentSchemas map on the stored definition", () => {
    // A JSON round trip can deliver the map as null, and `typeof null` is
    // "object" — this descent runs on the entry-write path, so an index into
    // null here would throw on every save of such an entry.
    const data = { seo: { title: "<i>x</i>" } };
    sanitizeEntryData(data, [
      field({
        name: "seo",
        type: "fieldGroup",
        fieldGroup: "seo",
        componentSchemas: null,
      }),
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

  it("reaches a field group nested deeper than the budget inside inline containers", async () => {
    // The editor's nesting limit counts field-group-to-field-group edges, not
    // inline group/repeater wrappers: a deep wrapper hierarchy is valid schema
    // and its reference must still resolve.
    let inner: FieldDefinition = field({
      name: "seo",
      type: "fieldGroup",
      fieldGroup: "seo",
    });
    for (let i = 0; i < 6; i++) {
      inner = field({ name: `wrap${i}`, type: "group", fields: [inner] });
    }
    const fields = await attachFieldGroupChildren([inner], resolver);
    let deepest = fields[0];
    while (deepest.fields && deepest.fields.length > 0) {
      deepest = deepest.fields[0] as FieldDefinition;
    }
    expect(childrenOf(deepest)).toHaveLength(1);
  });

  it("leaves a field untouched when its reference resolves to nothing", async () => {
    const raw = field({ name: "seo", type: "component", component: "gone" });
    const fields = await attachFieldGroupChildren([raw], resolver);
    expect(childrenOf(fields[0])).toBeUndefined();
  });
});

describe("stripHtmlTags", () => {
  it("keeps a less-than sign that does not open a tag", () => {
    // This runs on every text, string, textarea and email field of every
    // collection, and on media alt text, captions and tags. Treating every `<`
    // as the start of a tag deleted the rest of an author's sentence on save:
    // `price < 100` was stored as `price`.
    expect(stripHtmlTags("price < 100")).toBe("price < 100");
    expect(stripHtmlTags("2 < 3 and 5 > 4")).toBe("2 < 3 and 5 > 4");
    expect(stripHtmlTags("x <= y")).toBe("x <= y");
    expect(stripHtmlTags("<3 heart")).toBe("<3 heart");
  });

  it("still removes what a browser would read as a tag", () => {
    // The control for the test above: narrowing the rule must not stop it
    // removing markup. Each of these is tag-open syntax, including the one left
    // unclosed at the end, which a browser completes rather than shows.
    expect(stripHtmlTags("Hello <b>world</b>")).toBe("Hello world");
    expect(stripHtmlTags("</p>closing")).toBe("closing");
    expect(stripHtmlTags("hello <script")).toBe("hello");
    expect(stripHtmlTags("<!-- comment -->text")).toBe("text");
    expect(stripHtmlTags("<?php echo 1; ?>x")).toBe("x");
    expect(stripHtmlTags("<IMG SRC=x onerror=alert(1)>done")).toBe("done");
  });

  it("does not build a tag out of what it removed", () => {
    // Removing a tag puts its neighbours together. One pass of a rule that
    // matched only real tag syntax turned `<<b>img src=x onerror=alert(1)>`
    // into live markup the sanitizer had assembled itself.
    for (const input of [
      "<<b>img src=x onerror=alert(1)>",
      "<<script>script>alert(1)</script>",
      "<<<b>div onmouseover=alert(1)>hover",
    ]) {
      expect(stripHtmlTags(input)).not.toMatch(/<[a-zA-Z/!?]/);
    }
  });

  it("strips a hostile value in time proportional to its length", () => {
    // `<`*n + `b>` + `x>`*n exposes one tag per pass, so a rule that rescanned
    // until the text stopped changing did n passes over the whole string. Every
    // create and update reaches this, so the difference is whose CPU a caller
    // gets to spend.
    const n = 120_000;
    const hostile = "<".repeat(n) + "b>" + "x>".repeat(n);
    const started = Date.now();
    expect(stripHtmlTags(hostile)).not.toMatch(/<[a-zA-Z/!?]/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("keeps an author's less-than through the write path", () => {
    // Reached the way a write reaches it, so the unit above is not the only
    // thing that has to agree.
    const data: Record<string, unknown> = { title: "price < 100" };
    sanitizeEntryData(data, [field({ name: "title", type: "text" })]);
    expect(data.title).toBe("price < 100");
  });
});
