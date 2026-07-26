import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { DynamicCollectionRecord } from "../../../schemas/dynamic-collections/types";

import { ZodGenerator } from "./zod-generator";

/**
 * The generated create-input schema is what a client validates against before
 * sending a write. If it admits documents the server then rejects, the client
 * cannot tell a good request from a bad one — so the envelope it accepts has
 * to match the field's actual policy, not a loose stand-in for it.
 */
function schemaFor(blocks?: { kinds?: string[] }): string {
  const collection = {
    slug: "pages",
    labels: { singular: "Page", plural: "Pages" },
    fields: [
      { name: "content", type: "blocks", ...(blocks ? { blocks } : {}) },
    ],
  } as unknown as DynamicCollectionRecord;
  return new ZodGenerator().generateSchema(collection).code;
}

describe("generated zod schema for a blocks field", () => {
  it("pins the format version rather than accepting any number", () => {
    expect(schemaFor()).toContain(`z.literal(${DOCUMENT_FORMAT_VERSION})`);
  });

  it("accepts only page when the field declares no kinds", () => {
    const code = schemaFor();
    expect(code).toContain('z.enum(["page"])');
  });

  it("keeps an explicitly empty kinds policy as accepting nothing", () => {
    // The write validator reads `kinds: []` as permitting no document at all;
    // collapsing it to page here would generate a schema that admits what the
    // server refuses.
    const code = schemaFor({ kinds: [] });
    expect(code).toContain("z.never()");
    expect(code).not.toContain('z.enum(["page"])');
  });

  it("derives the kind enum from the field's own policy", () => {
    const code = schemaFor({ kinds: ["template", "pattern"] });
    expect(code).toContain('z.enum(["template", "pattern"])');
    // A page document would be rejected by the server for this field, so the
    // generated schema must not admit one either.
    expect(code).not.toContain('z.enum(["page"])');
  });
});
