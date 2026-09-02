/**
 * The sanitization descent follows the fields whose values are nested
 * documents. A field group stores its values one level down, so the descent
 * must recognise it under either type spelling its stored definition may use —
 * skipping the migrated one would publish the group's text values unsanitized.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { sanitizeEntryData } from "../sanitization-service";

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
    "descends into a %s field's nested document",
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

  it.each(["component", "fieldGroup"] as const)(
    "descends into every row of a repeatable %s field",
    fieldType => {
      const data = {
        slots: [{ title: "<i>a</i>" }, { title: "<i>b</i>" }],
      };
      sanitizeEntryData(data, [
        field({
          name: "slots",
          type: fieldType,
          repeatable: true,
          fields: [field({ name: "title", type: "text" })],
        }),
      ]);
      expect(data.slots).toEqual([{ title: "a" }, { title: "b" }]);
    }
  );
});
