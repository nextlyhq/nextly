import { describe, expect, it } from "vitest";

import { TypeGenerator } from "./type-generator";

describe("TypeGenerator — permissions and events maps (D47)", () => {
  it("emits a permissions map and an events map into the Config interface", () => {
    const gen = new TypeGenerator();
    const { code } = gen.generateTypesFile(
      [],
      [],
      [],
      [],
      ["export-submissions", "manage-seo"],
      ["form-builder.submitted", "collection.posts.created"]
    );

    // Permissions union keys present.
    expect(code).toContain('"export-submissions": true;');
    expect(code).toContain('"manage-seo": true;');
    // Events union keys present.
    expect(code).toContain('"form-builder.submitted": true;');
    expect(code).toContain('"collection.posts.created": true;');
    // The Config interface declares both new sections.
    expect(code).toMatch(/permissions: \{/);
    expect(code).toMatch(/events: \{/);
    // Module augmentation still extends Config.
    expect(code).toContain("export interface GeneratedTypes extends Config {}");
  });

  it("dedupes and lexically sorts the union keys", () => {
    const gen = new TypeGenerator();
    const { code } = gen.generateTypesFile(
      [],
      [],
      [],
      [],
      ["read-posts", "read-posts", "create-posts"],
      []
    );
    const createIdx = code.indexOf('"create-posts": true;');
    const readIdx = code.indexOf('"read-posts": true;');
    expect(createIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(-1);
    // sorted: "create-posts" before "read-posts"
    expect(createIdx).toBeLessThan(readIdx);
    // deduped: "read-posts" appears exactly once
    expect(code.split('"read-posts": true;').length - 1).toBe(1);
  });

  it("omits the permissions/events keys entirely when none are passed (back-compat → string fallback)", () => {
    const gen = new TypeGenerator();
    const { code } = gen.generateTypesFile([], [], []);
    // Keys are ABSENT (not empty) so `GeneratedTypes extends { permissions: ... }`
    // is false and PermissionSlug/EventName fall back to `string` (not `never`).
    expect(code).not.toMatch(/permissions: \{/);
    expect(code).not.toMatch(/events: \{/);
    // The rest of the Config interface is still emitted.
    expect(code).toContain("export interface Config {");
    expect(code).toContain("user: User;");
  });
});
