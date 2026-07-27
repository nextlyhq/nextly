import { emptyBlockDocument } from "nextly/config";
import { describe, expect, it } from "vitest";

/**
 * A blocks field's form control is read-only: editing happens in the builder.
 * So whatever the form seeds is what gets submitted, and a required field
 * seeded with `null` can never be satisfied — the entry or single cannot be
 * saved, and saving it is how the user reaches the builder in the first place.
 *
 * Both form builders (entries and singles) must therefore seed a real document
 * for a required field. This pins the shape they seed and the reason for it.
 */
describe("empty document seeded for a required blocks field", () => {
  it("is a document the server would accept", () => {
    const doc = emptyBlockDocument();
    expect(typeof doc.formatVersion).toBe("number");
    expect(doc.kind).toBe("page");
    expect(doc.nodes).toEqual([]);
  });

  it("uses a kind the field accepts", () => {
    // Seeding `page` into a template-only field would fail the field's own
    // policy on submit, which is the failure this seeding exists to avoid.
    expect(emptyBlockDocument(["template"]).kind).toBe("template");
    expect(emptyBlockDocument(["pattern", "page"]).kind).toBe("page");
  });
});
