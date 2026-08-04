/**
 * Both schema commands gate on this, and each used to spell it out from
 * whatever counts it had in scope. Gating on collections alone is what left a
 * project made of singles or user fields with no generated types and a watcher
 * that never re-synced, so every entity kind is pinned here individually.
 */
import { describe, expect, it } from "vitest";

import { hasSchemaToSync } from "../has-schema";

describe("hasSchemaToSync", () => {
  it.each([
    ["collections", { collections: [{}] }],
    ["singles", { singles: [{}] }],
    ["field groups", { fieldGroups: [{}] }],
    ["user fields", { users: { fields: [{}] } }],
  ])("counts a project made only of %s", (_label, config) => {
    expect(hasSchemaToSync(config)).toBe(true);
  });

  it("is false for a config declaring none of them", () => {
    expect(hasSchemaToSync({})).toBe(false);
    expect(
      hasSchemaToSync({
        collections: [],
        singles: [],
        fieldGroups: [],
        users: { fields: [] },
      })
    ).toBe(false);
  });

  it("is false when users carries no fields at all", () => {
    // `users` is present for auth settings on projects with no custom fields,
    // so its mere presence must not read as schema.
    expect(hasSchemaToSync({ users: {} })).toBe(false);
  });
});
