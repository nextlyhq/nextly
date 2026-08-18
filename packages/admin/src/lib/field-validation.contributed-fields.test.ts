/**
 * A contributed field type survives the form's schema.
 *
 * The editors submit the RESOLVER'S OUTPUT, not the form's raw values, and the
 * resolver is built from `generateClientSchema`. That shape is a `z.object`,
 * which strips keys it has no entry for — so a field type the admin cannot name
 * was removed from the payload after the author had edited it, on every save,
 * with no error anywhere. `pluginField()` exists precisely to declare types core
 * does not know, so this reached every contributed field in both editors.
 *
 * These cases are written against an INVENTED type rather than against `blocks`.
 * Naming a real plugin's type would pass again the moment someone added it to a
 * list, which is the repair this is guarding against.
 *
 * @module lib/field-validation.contributed-fields.test
 */
import type { FieldConfig } from "nextly/config";
import { describe, expect, it } from "vitest";

import { generateClientSchema } from "./field-validation";

/** A type the admin has never heard of, as a plugin would contribute one. */
function contributed(name: string, type = "acme/spatial-map"): FieldConfig {
  return { type, name } as unknown as FieldConfig;
}

describe("a contributed field type reaches the server", () => {
  it("keeps an unknown field's value through the parse", () => {
    const schema = generateClientSchema([contributed("layout")]);

    const parsed = schema.safeParse({
      layout: { formatVersion: 1, nodes: [] },
    });

    expect(parsed.success).toBe(true);
    // THE case. `success` alone passes on a schema that stripped the key and
    // then validated the empty object happily, which is exactly the defect.
    expect(parsed.success && parsed.data).toHaveProperty("layout");
  });

  it("preserves the value itself, not merely the key", () => {
    const schema = generateClientSchema([contributed("layout")]);
    const document = { formatVersion: 1, kind: "page", nodes: [{ id: "a" }] };

    const parsed = schema.safeParse({ layout: document });

    expect(parsed.success && parsed.data.layout).toEqual(document);
  });

  it("keeps a contributed field beside built-in ones", () => {
    // The control that separates "unknown types survive" from "this schema
    // passes everything through": `title` is a built-in and must still be
    // validated, so a fix that swapped the object for a passthrough would keep
    // the first two cases green and fail this one.
    const schema = generateClientSchema([
      { type: "text", name: "title", required: true } as unknown as FieldConfig,
      contributed("layout"),
    ]);

    const both = schema.safeParse({ layout: { nodes: [] }, title: "Homepage" });
    expect(both.success).toBe(true);
    expect(both.success && both.data).toHaveProperty("layout");

    const missingTitle = schema.safeParse({ layout: { nodes: [] }, title: "" });
    expect(missingTitle.success).toBe(false);
  });
});

describe("the boundary the fix draws", () => {
  it("keeps SEVERAL contributed types, not one privileged one", () => {
    const schema = generateClientSchema([
      contributed("layout", "acme/spatial-map"),
      contributed("chart", "othervendor/chart"),
    ]);

    const parsed = schema.safeParse({ layout: { a: 1 }, chart: { b: 2 } });

    expect(parsed.success && parsed.data).toHaveProperty("layout");
    expect(parsed.success && parsed.data).toHaveProperty("chart");
  });

  it("still drops a key no field declares", () => {
    // The other half of the boundary: fields are kept because they were
    // DECLARED, not because anything present is welcome. A stray key would
    // otherwise ride along into the request body.
    const schema = generateClientSchema([contributed("layout")]);

    const parsed = schema.safeParse({
      layout: {},
      strayKey: "should not pass",
    });

    expect(parsed.success && parsed.data).not.toHaveProperty("strayKey");
  });
});
