/**
 * The merged view every migrate command reads: which tables the schema
 * declares, and which exist only because a relationship or a locale created
 * them.
 *
 * The cases here are the ones where "declared" and "derived" are easy to
 * confuse, because each mistake shows up as a table wrongly kept out of a
 * snapshot — which reads as drift no migration can resolve, or as a table
 * preserved forever that should have been dropped.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveDeclaredSchema } from "../resolved-schema";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "nextly-resolved-schema-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const UI_SCHEMA_FILE = "ui-schema.json";

async function writeManifest(manifest: unknown): Promise<void> {
  await writeFile(
    join(projectRoot, UI_SCHEMA_FILE),
    JSON.stringify(manifest),
    "utf-8"
  );
}

function config(overrides: {
  collections?: readonly unknown[];
  singles?: readonly unknown[];
  fieldGroups?: readonly unknown[];
}): Parameters<typeof resolveDeclaredSchema>[0]["config"] {
  return {
    collections: overrides.collections ?? [],
    singles: overrides.singles,
    fieldGroups: overrides.fieldGroups,
    db: { uiSchemaFile: UI_SCHEMA_FILE },
  };
}

/** A many-to-many relationship, the only shape that gets a junction table. */
function manyToMany(name: string, junctionTable?: string) {
  return {
    name,
    type: "relationship",
    options: {
      target: "tags",
      relationType: "manyToMany",
      ...(junctionTable ? { junctionTable } : {}),
    },
  };
}

describe("resolveDeclaredSchema — custom junction names", () => {
  it("records the junction name of a many-to-many field", async () => {
    const resolved = await resolveDeclaredSchema({
      projectRoot,
      config: config({
        collections: [
          { slug: "posts", fields: [manyToMany("tags", "posts_to_tags")] },
        ],
      }),
    });

    expect([...resolved.knownJunctions]).toEqual(["posts_to_tags"]);
  });

  it("ignores junctionTable on a field that is not many-to-many", async () => {
    // The option is inert on a single-valued relationship: the DDL generator
    // asks `usesJunctionTable` before emitting one, so nothing by this name
    // was ever created. Treating it as a junction would exclude a table that
    // does not exist, which is harmless — until the name is a real one.
    const resolved = await resolveDeclaredSchema({
      projectRoot,
      config: config({
        collections: [
          {
            slug: "posts",
            fields: [
              {
                name: "author",
                type: "relationship",
                options: {
                  target: "authors",
                  relationType: "manyToOne",
                  junctionTable: "stale_from_before",
                },
              },
            ],
          },
        ],
      }),
    });

    expect([...resolved.knownJunctions]).toEqual([]);
  });

  it("does not let a stale junctionTable hide a declared table", async () => {
    // The consequence that makes the gate matter. `knownJunctions` is consulted
    // when deciding which live tables belong in a snapshot, so a stale option
    // naming a real collection's table would take that table out of the
    // recorded schema entirely.
    const resolved = await resolveDeclaredSchema({
      projectRoot,
      config: config({
        collections: [
          {
            slug: "posts",
            fields: [
              {
                name: "author",
                type: "relationship",
                options: {
                  target: "authors",
                  relationType: "manyToOne",
                  junctionTable: "dc_authors",
                },
              },
            ],
          },
          { slug: "authors", fields: [] },
        ],
      }),
    });

    expect(resolved.declaredTables.has("dc_authors")).toBe(true);
    expect(resolved.knownJunctions.has("dc_authors")).toBe(false);
  });
});

describe("resolveDeclaredSchema — code-first shadowing", () => {
  it("keeps a Builder single whose slug a code-first COLLECTION shadows", async () => {
    // The manifest allows one slug across the three kinds, and the merge
    // resolves each kind separately. Shadowing from a single combined set
    // would drop this single, and its live `_locales` companion with it.
    await writeManifest({
      collections: [{ slug: "home", fields: [] }],
      singles: [{ slug: "home", fields: [] }],
      components: [],
    });

    const resolved = await resolveDeclaredSchema({
      projectRoot,
      config: config({ collections: [{ slug: "home", fields: [] }] }),
    });

    const slugs = resolved.entities.map(e => e.tableName).sort();
    expect(slugs).toContain("single_home");
    // The Builder COLLECTION is shadowed, so `dc_home` is contributed by the
    // code-first entity and appears exactly once.
    expect(slugs.filter(t => t === "dc_home")).toHaveLength(1);
  });

  it("drops a Builder collection the code-first config shadows", async () => {
    await writeManifest({
      collections: [{ slug: "posts", fields: [] }],
      singles: [],
      components: [],
    });

    const resolved = await resolveDeclaredSchema({
      projectRoot,
      config: config({ collections: [{ slug: "posts", fields: [] }] }),
    });

    expect(resolved.entities.filter(e => e.slug === "posts")).toHaveLength(1);
    expect(resolved.entities.find(e => e.slug === "posts")?.builtBy).toBe(
      "codeFirst"
    );
  });

  it("ignores the junction name of a shadowed Builder collection", async () => {
    // The winning schema no longer declares that relationship, so nothing
    // creates the table. Treating it as derived would keep it out of the
    // snapshot and preserve it forever, when the first migration after
    // adoption should drop it.
    //
    // The junction reaches a Builder entity through a PLUGIN: the manifest
    // schema has no `options` of this shape and strips it, while a deferred
    // extend contributes code-first fields that are merged in unvalidated.
    await writeManifest({
      collections: [{ slug: "posts", fields: [] }],
      singles: [],
      components: [],
    });

    const resolved = await resolveDeclaredSchema({
      projectRoot,
      config: config({ collections: [{ slug: "posts", fields: [] }] }),
      deferredExtends: [
        {
          target: "posts",
          owner: "plugin-tagging",
          fields: [manyToMany("tags", "legacy_posts_tags")],
        },
      ],
    });

    expect(resolved.knownJunctions.has("legacy_posts_tags")).toBe(false);
  });

  it("keeps the junction name of an UNshadowed Builder collection", async () => {
    // The other half of the same rule: a Builder collection the config does
    // not shadow still owns its junction, and forgetting it reports drift on
    // the first migration after adoption.
    await writeManifest({
      collections: [{ slug: "articles", fields: [] }],
      singles: [],
      components: [],
    });

    const resolved = await resolveDeclaredSchema({
      projectRoot,
      config: config({ collections: [] }),
      deferredExtends: [
        {
          target: "articles",
          owner: "plugin-tagging",
          fields: [manyToMany("tags", "articles_tags")],
        },
      ],
    });

    expect(resolved.knownJunctions.has("articles_tags")).toBe(true);
  });
});
