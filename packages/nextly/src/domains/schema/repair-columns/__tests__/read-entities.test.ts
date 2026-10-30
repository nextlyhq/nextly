/**
 * `readRepairEntities` reads each registry only where that registry's own table exists. A site can
 * have one registry and not another (a database from before Singles, or a field-group registry
 * under its newer name), and a missing registry must contribute no rows rather than fail the run.
 *
 * The registry services are replaced by ones that answer from fixtures, and the Singles service
 * throws if it is asked at all, so reading a registry whose table is missing fails this suite.
 *
 * It also holds the configured side to everything the next migration would apply: the code user
 * fields beside the admin's, the Builder manifest with the plugins' extensions of it, and the
 * plugin that owns each kind of entity.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readRepairEntities } from "../read-entities";

const registry = vi.hoisted(() => ({
  collections: [] as unknown[],
  singles: [] as unknown[],
  fieldGroups: [] as unknown[],
}));

vi.mock("../../../collections/services/collection-registry-service", () => ({
  CollectionRegistryService: class {
    getAllCollections() {
      return Promise.resolve(registry.collections);
    }
  },
}));

vi.mock("../../../singles/services/single-registry-service", () => ({
  SingleRegistryService: class {
    getAllSingles() {
      if (registry.singles.length === 0) {
        return Promise.reject(
          new Error("read a Singles registry with no table")
        );
      }
      return Promise.resolve(registry.singles);
    }
  },
}));

/** The stored user field definitions, as the definitions service returns them. */
const userDefinitions = vi.hoisted(() => ({ records: [] as unknown[] }));

vi.mock("../../../users/services/user-field-definition-service", () => ({
  UserFieldDefinitionService: class {
    getMergedFields() {
      return Promise.resolve(userDefinitions.records);
    }
  },
}));

vi.mock("../../../field-groups/services/field-group-registry-service", () => ({
  FieldGroupRegistryService: class {
    getAllComponents() {
      return Promise.resolve(registry.fieldGroups);
    }
  },
}));

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** An adapter whose database has exactly `tables`, and no ledger or user field definitions. */
function adapterWith(tables: readonly string[]): DrizzleAdapter {
  const present = new Set(tables);
  return {
    tableExists: (name: string) => Promise.resolve(present.has(name)),
  } as unknown as DrizzleAdapter;
}

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "nextly-repair-columns-config-"));
  registry.collections = [];
  registry.singles = [];
  registry.fieldGroups = [];
  userDefinitions.records = [];
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

type ReadArgs = Parameters<typeof readRepairEntities>[0];

const read = (
  tables: readonly string[],
  over: Partial<ReadArgs["config"]> = {},
  deferredExtends?: ReadArgs["deferredExtends"],
  migrationsDir = "/nonexistent"
) =>
  readRepairEntities({
    adapter: adapterWith(tables),
    dialect: "sqlite",
    config: {
      collections: [],
      db: { uiSchemaFile: "ui-schema.json" },
      ...over,
    },
    projectRoot,
    ...(deferredExtends !== undefined ? { deferredExtends } : {}),
    migrationsDir,
    logger: silent,
  });

const names = (fields: readonly { name: string }[] | undefined) =>
  fields?.map(f => f.name);

const kindsAndSlugs = (entities: Awaited<ReturnType<typeof read>>) =>
  entities.map(e => `${e.kind}:${e.slug}`);

describe("readRepairEntities: which registries are read", () => {
  it("skips the Singles registry where its table is missing and reads the others", async () => {
    registry.collections = [
      { slug: "rcposts", tableName: "dc_rcposts", fields: [], source: "ui" },
    ];
    registry.singles = [];
    registry.fieldGroups = [
      { slug: "card", tableName: "comp_card", fields: [], source: "ui" },
    ];
    expect(
      kindsAndSlugs(await read(["dynamic_collections", "dynamic_field_groups"]))
    ).toEqual(["collection:rcposts", "fieldGroup:card"]);
  });

  it("reads the Singles registry where only the collections registry is missing", async () => {
    registry.collections = [
      { slug: "rcposts", tableName: "dc_rcposts", fields: [], source: "ui" },
    ];
    registry.singles = [
      { slug: "home", tableName: "single_home", fields: [], source: "ui" },
    ];
    registry.fieldGroups = [];
    expect(kindsAndSlugs(await read(["dynamic_singles"]))).toEqual([
      "single:home",
    ]);
  });
});

describe("readRepairEntities: user fields as configured", () => {
  const record = (over: Record<string, unknown>) => ({
    label: String(over.name),
    required: false,
    isActive: true,
    ...over,
  });

  it("configures the code fields from the configuration and keeps the admin's own", async () => {
    // `score` changed type in code and `badge` was added there; neither has been synced into the
    // definitions, which still hold the old `score`. `nickname` is the admin's own field.
    userDefinitions.records = [
      record({ name: "score", type: "number", source: "code" }),
      record({ name: "nickname", type: "text", source: "ui" }),
    ];
    const users = (
      await read(["user_field_definitions"], {
        users: {
          fields: [
            { name: "score", type: "text" },
            { name: "badge", type: "text" },
          ],
        },
      })
    ).find(e => e.kind === "userFields");

    expect(names(users?.applied?.fields)).toEqual(["score", "nickname"]);
    expect(users?.applied?.fields[0]?.type).toBe("number");
    expect(names(users?.configured?.fields)).toEqual([
      "score",
      "badge",
      "nickname",
    ]);
    expect(users?.configured?.fields[0]?.type).toBe("text");
  });

  it("drops a code field the configuration no longer declares from the configured side", async () => {
    userDefinitions.records = [
      record({ name: "score", type: "number", source: "code" }),
    ];
    const users = (await read(["user_field_definitions"])).find(
      e => e.kind === "userFields"
    );
    expect(names(users?.applied?.fields)).toEqual(["score"]);
    expect(users?.configured?.fields).toEqual([]);
  });
});

describe("readRepairEntities: Builder entities as configured", () => {
  const manifest = (body: unknown) =>
    writeFileSync(join(projectRoot, "ui-schema.json"), JSON.stringify(body));

  beforeEach(() => {
    registry.collections = [
      {
        slug: "rcposts",
        tableName: "dc_rcposts",
        fields: [{ name: "title", type: "text" }],
        source: "ui",
        locked: false,
        migrationStatus: "applied",
      },
    ];
  });

  it("takes a Builder collection's configured definition from a newer manifest, with a plugin's extension", async () => {
    manifest({
      collections: [
        {
          slug: "rcposts",
          localized: true,
          fields: [
            { name: "title", type: "text" },
            { name: "summary", type: "text" },
          ],
        },
      ],
      singles: [],
      components: [],
    });
    const posts = (
      await read(["dynamic_collections"], {}, [
        {
          target: "rcposts",
          owner: "seo-kit",
          fields: [{ name: "metaTitle", type: "text" }],
        },
      ])
    ).find(e => e.slug === "rcposts");

    expect(names(posts?.applied?.fields)).toEqual(["title"]);
    expect(names(posts?.configured?.fields)).toEqual([
      "title",
      "summary",
      "metaTitle",
    ]);
    expect(posts?.configured?.origin).toBe("collection");
    expect(posts?.configured?.localized).toBe(true);
  });

  it("falls back to the registry row where there is no manifest", async () => {
    const posts = (await read(["dynamic_collections"])).find(
      e => e.slug === "rcposts"
    );
    expect(names(posts?.configured?.fields)).toEqual(["title"]);
    expect(posts?.configured?.origin).toBe("collection");
  });

  it("refuses to run on a manifest it cannot read rather than drop the Builder's declarations", async () => {
    writeFileSync(join(projectRoot, "ui-schema.json"), "{");
    await expect(read(["dynamic_collections"])).rejects.toMatchObject({
      code: "NEXTLY_UI_SCHEMA_INVALID",
    });
  });
});

describe("readRepairEntities: which plugin owns an entity", () => {
  it("names the plugin that contributed a collection, a Single or a field group", async () => {
    const entities = await read([], {
      collections: [
        { slug: "redirects", fields: [] },
        { slug: "legacy-links", fields: [] },
      ],
      singles: [{ slug: "seo-settings", fields: [] }],
      fieldGroups: [{ slug: "seo-meta", fields: [] }],
      plugins: [
        // A plugin with no contributions owns nothing, and is no reason to stop.
        { name: "bare" },
        {
          name: "seo-kit",
          contributes: {
            collections: [{ slug: "redirects" }],
            singles: [{ slug: "seo-settings" }],
            fieldGroups: [{ slug: "seo-meta" }],
          },
        },
        // A plugin still declaring collections at its top level, as older plugins do.
        { name: "link-kit", collections: [{ slug: "legacy-links" }] },
      ],
    });
    expect(
      Object.fromEntries(entities.map(e => [`${e.kind}:${e.slug}`, e.plugin]))
    ).toEqual({
      "collection:redirects": "seo-kit",
      "collection:legacy-links": "link-kit",
      "single:seo-settings": "seo-kit",
      "fieldGroup:seo-meta": "seo-kit",
    });
  });

  it("does not take a collection's plugin for a Single of the same slug", async () => {
    const entities = await read([], {
      collections: [],
      singles: [{ slug: "redirects", fields: [] }],
      plugins: [
        {
          name: "seo-kit",
          contributes: { collections: [{ slug: "redirects" }] },
        },
      ],
    });
    expect(entities.map(e => e.plugin)).toEqual([undefined]);
  });
});

describe("readRepairEntities: snapshots with no ledger", () => {
  it("reads no snapshot, an unreadable one included, where the database has no ledger", async () => {
    // With no ledger nothing has been applied, so no snapshot speaks for the database and one that
    // cannot be read is no reason to stop.
    mkdirSync(join(projectRoot, "meta"));
    writeFileSync(join(projectRoot, "meta", "0001_first.snapshot.json"), "{");
    const entities = await read(
      [],
      { collections: [{ slug: "posts", fields: [] }] },
      undefined,
      projectRoot
    );
    expect(entities.map(e => [e.slug, e.applied])).toEqual([["posts", null]]);
  });
});
