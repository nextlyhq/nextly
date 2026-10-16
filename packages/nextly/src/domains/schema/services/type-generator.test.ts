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

describe("TypeGenerator — the augmented module is part of the app's program", () => {
  // TypeScript reports TS2664 ("Invalid module name in augmentation") for a
  // `declare module` whose target no file of the program imports, even when the
  // module resolves. A new app imports only subpaths such as `nextly/config`, so
  // the generated file has to bring the root entry in itself.
  it("imports the augmented module, type-only, before augmenting it", () => {
    const { code } = new TypeGenerator().generateTypesFile([collection([])]);

    const importAt = code.indexOf('import type {} from "nextly";');
    expect(importAt).toBeGreaterThanOrEqual(0);
    expect(importAt).toBeLessThan(code.indexOf('declare module "nextly" {'));
  });

  it("imports whichever module it is told to augment", () => {
    // The import follows `moduleToAugment`; a fixed "nextly" would leave a
    // custom target's augmentation as unresolved as before.
    const { code } = new TypeGenerator({
      moduleToAugment: "@acme/cms",
    }).generateTypesFile([collection([])]);

    expect(code).toContain('import type {} from "@acme/cms";');
    expect(code).not.toContain('import type {} from "nextly";');
  });
});

describe("TypeGenerator — a field pointing at a built-in collection names a type the file has", () => {
  // `users` and `media` are built in: no config declares them, so no interface
  // is generated per slug, and naming one (`Users`, `Media`) left the file
  // referring to types it never declared or imported.
  const posts = (fields: unknown[]) => collection(fields);

  it("types a relationship to users as the generated User", () => {
    const { code } = new TypeGenerator().generateTypesFile([
      posts([{ name: "author", type: "relationship", relationTo: "users" }]),
    ]);

    expect(code).toContain("author?: string | User | null;");
    expect(code).not.toMatch(/\bUsers\b/);
  });

  it("types an upload to media as Nextly's MediaFile, imported from nextly", () => {
    const { code } = new TypeGenerator().generateTypesFile([
      posts([{ name: "featuredImage", type: "upload", relationTo: "media" }]),
    ]);

    expect(code).toContain("featuredImage?: string | MediaFile | null;");
    expect(code).toContain('import type { MediaFile } from "nextly";');
    expect(code).not.toMatch(/\bMedia\b/);
  });

  it("imports MediaFile only when a field points at media", () => {
    const { code } = new TypeGenerator().generateTypesFile([
      posts([{ name: "title", type: "text" }]),
    ]);

    expect(code).not.toContain("MediaFile");
  });

  it("keeps a configured collection's own interface when its slug is media or users", () => {
    // A config may declare its own `media` collection; then the generated
    // interface is the type, and nothing is imported in its place.
    const { code } = new TypeGenerator().generateTypesFile([
      posts([
        { name: "cover", type: "upload", relationTo: "media" },
        { name: "owner", type: "relationship", relationTo: "users" },
      ]),
      collection([{ name: "label", type: "text" }], "media"),
      collection([{ name: "label", type: "text" }], "users"),
    ]);

    expect(code).toContain("cover?: string | Media | null;");
    expect(code).toContain("owner?: string | Users | null;");
    expect(code).toContain("export interface Media {");
    expect(code).not.toContain("MediaFile");
  });

  it("aliases the import when the config declares its own MediaFile", () => {
    // A collection `media-file` generates `export interface MediaFile`; an
    // unaliased import beside it is a duplicate binding (TS2440).
    const { code } = new TypeGenerator().generateTypesFile([
      posts([{ name: "cover", type: "upload", relationTo: "media" }]),
      collection([{ name: "label", type: "text" }], "media-file"),
    ]);

    expect(code).toContain(
      'import type { MediaFile as NextlyMediaFile } from "nextly";'
    );
    expect(code).toContain("cover?: string | NextlyMediaFile | null;");
    expect(code).toContain("export interface MediaFile {");
  });

  it("aliases the import for an interface generated on its own that is itself MediaFile", () => {
    // A `media-file` collection generates `interface MediaFile`; referencing
    // the built-in media row from it needs the alias even without a file.
    const iface = new TypeGenerator().generateInterface(
      collection(
        [{ name: "source", type: "upload", relationTo: "media" }],
        "media-file"
      )
    );

    expect(iface.code).toContain("export interface MediaFile {");
    expect(iface.code).toContain("source?: string | NextlyMediaFile | null;");
    expect(iface.imports).toContain(
      'import type { MediaFile as NextlyMediaFile } from "nextly";'
    );
  });

  it("returns the MediaFile import with an interface generated on its own", () => {
    // `generateInterface` hands back the imports its code relies on, for a
    // caller assembling a file from interfaces.
    const iface = new TypeGenerator().generateInterface(
      posts([{ name: "cover", type: "upload", relationTo: "media" }])
    );

    expect(iface.code).toContain("cover?: string | MediaFile | null;");
    expect(iface.imports).toContain('import type { MediaFile } from "nextly";');
  });

  it("resolves each target of a polymorphic relationship the same way", () => {
    const { code } = new TypeGenerator().generateTypesFile([
      posts([
        {
          name: "subject",
          type: "relationship",
          relationTo: ["users", "media", "posts"],
        },
      ]),
    ]);

    expect(code).toContain(
      "subject?: string | User | string | MediaFile | string | Posts | null;"
    );
  });
});
