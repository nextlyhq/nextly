import { describe, expect, it } from "vitest";

import type { DynamicCollectionRecord } from "../../../schemas/dynamic-collections/types";
import { TypeGenerator } from "./type-generator";

const collection = (fields: unknown[], slug = "posts") =>
  ({
    slug,
    labels: { singular: "Post", plural: "Posts" },
    fields,
    timestamps: true,
  }) as unknown as DynamicCollectionRecord;

describe("TypeGenerator — a non-required field is a nullable column", () => {
  // `field.required !== true` is what decides column nullability in
  // field-column-descriptor.ts, so an unset optional field is read back as SQL
  // NULL. A type saying only `?` describes a key that may be missing, which is
  // a claim the database never makes.
  it("emits `| null` for a field that is not required", () => {
    const { code } = new TypeGenerator().generateTypesFile([
      collection([{ name: "subtitle", type: "text" }]),
    ]);

    expect(code).toContain("subtitle?: string | null;");
  });

  it("emits neither `?` nor `| null` for a required field", () => {
    // The other half, and the one that fails if the suffix is applied
    // unconditionally: a required column is NOT NULL, so null is not a value
    // it can hold and offering it would send every consumer down a dead branch.
    const { code } = new TypeGenerator().generateTypesFile([
      collection([{ name: "title", type: "text", required: true }]),
    ]);

    expect(code).toContain("title: string;");
    expect(code).not.toContain("title?:");
    expect(code).not.toContain("title: string | null;");
  });

  it("does not widen `unknown`, which already admits null", () => {
    // Emitting `unknown | null` would be redundant in a file a user reads.
    const { code } = new TypeGenerator().generateTypesFile([
      collection([{ name: "payload", type: "json" }]),
    ]);

    expect(code).toContain("payload?: unknown;");
    expect(code).not.toContain("payload?: unknown | null;");
  });

  it("keeps the field omittable on create", () => {
    // The reason `?` is kept ALONGSIDE `| null` rather than replaced by it.
    // The input types are derived from this interface, and these same lines are
    // emitted for field groups that nest inside entity fields, so dropping `?`
    // would demand an explicit `null` for every optional key at every depth.
    const { code } = new TypeGenerator().generateTypesFile([
      collection([{ name: "subtitle", type: "text" }]),
    ]);

    expect(code).toContain("subtitle?: string | null;");
    // Matched on SHAPE rather than on the interface's name: the claim is that
    // the create input is still derived by `Omit` and so still inherits the
    // `?`, which is what keeps the field omittable.
    expect(code).toMatch(
      /export type \w+CreateInput = Omit<\w+, "id" \| "createdAt" \| "updatedAt">;/
    );
  });
});

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
