/**
 * `created_by` is injected as a system owner column on every collection table,
 * so a code-first collection must not declare a top-level field with that name
 * (or its camelCase alias, which snake-cases to the same column). Nested fields
 * live inside JSON and do not collide, so the reservation is top-level only.
 */
import { describe, expect, it } from "vitest";

import { group, text } from "../fields/helpers";
import type { CollectionConfig } from "./define-collection";
import { validateCollectionConfig } from "./validate-config";

function codesFor(fields: CollectionConfig["fields"]): string[] {
  return validateCollectionConfig({ slug: "posts", fields }).errors.map(
    e => e.code
  );
}

describe("validateCollectionConfig: owner-column reservation", () => {
  it("rejects a top-level created_by field", () => {
    expect(codesFor([text({ name: "created_by" })])).toContain(
      "FIELD_NAME_RESERVED"
    );
  });

  it("rejects the camelCase createdBy alias (snake-cases to created_by)", () => {
    expect(codesFor([text({ name: "createdBy" })])).toContain(
      "FIELD_NAME_RESERVED"
    );
  });

  it("allows created_by nested inside a group (JSON-stored, no column)", () => {
    const codes = codesFor([
      group({ name: "meta", fields: [text({ name: "created_by" })] }),
    ]);
    expect(codes).not.toContain("FIELD_NAME_RESERVED");
  });

  it("leaves an ordinary collection untouched", () => {
    expect(codesFor([text({ name: "title" })])).toEqual([]);
  });
});
