/**
 * Which fields the write path treats as JSON-backed.
 *
 * The answer has to match how the column descriptor actually stores the value:
 * a field classified as plain is handed to the driver as-is, so a value the
 * column holds as JSON reaches it as a live object and the insert fails.
 */
import { describe, expect, it } from "vitest";

import { isJsonFieldType } from "../collection-utils";

describe("isJsonFieldType — relationships", () => {
  it("treats a single relationship to one collection as plain", () => {
    // Stored as the target's id, so there is nothing to serialize.
    expect(isJsonFieldType("relationship", { relationTo: "posts" })).toBe(
      false
    );
  });

  it("treats a hasMany relationship as JSON", () => {
    expect(
      isJsonFieldType("relationship", { hasMany: true, relationTo: "posts" })
    ).toBe(true);
  });

  it("treats a single POLYMORPHIC relationship as JSON", () => {
    // Stored as `{relationTo, value}` rather than a bare id, so it needs the
    // same serialization a hasMany relationship gets.
    expect(
      isJsonFieldType("relationship", { relationTo: ["posts", "pages"] })
    ).toBe(true);
  });

  it("matches how upload already classifies the same shapes", () => {
    // The two field types store polymorphic targets identically, so a rule
    // that applied to one and not the other was an inconsistency.
    for (const field of [
      { relationTo: "media" },
      { hasMany: true, relationTo: "media" },
      { relationTo: ["media", "files"] },
    ]) {
      expect(
        isJsonFieldType("relationship", field),
        JSON.stringify(field)
      ).toBe(isJsonFieldType("upload", field));
    }
  });
});
