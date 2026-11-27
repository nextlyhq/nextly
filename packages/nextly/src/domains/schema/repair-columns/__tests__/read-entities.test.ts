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

import { toCliError } from "../../../../cli/errors";
import { NextlyError } from "../../../../errors";
import { readRepairEntities } from "../read-entities";

/** Every read and existence check of a file, by path, as the modules under test make them. */
const files = vi.hoisted(() => ({
  reads: [] as string[],
  stats: [] as string[],
}));

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      files.reads.push(String(args[0]));
      return actual.readFile(...args);
    },
    stat: (...args: Parameters<typeof actual.stat>) => {
      files.stats.push(String(args[0]));
      return actual.stat(...args);
    },
  };
});

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

/** The error `run` stops on, as the command ends with it. */
async function stopOf(run: Promise<unknown>) {
  const error: unknown = await run.then(
    () => {
      throw new Error("expected the run to stop");
    },
    (reason: unknown) => reason
  );
  const { code, what, why, next } = toCliError(error);
  return { code, what, why, next };
}

const row = (slug: string, over: Record<string, unknown> = {}) => ({
  slug,
  tableName: `dc_${slug}`,
  fields: [],
  source: "ui",
  ...over,
});

describe("readRepairEntities: a registry row that names no table", () => {
  it.each([undefined, "", 7])(
    "stops the run, naming the row (table name %s)",
    async tableName => {
      registry.collections = [row("rcposts"), row("rcbroken", { tableName })];
      expect(await stopOf(read(["dynamic_collections"]))).toEqual({
        code: "REGISTRY_ROW_WITHOUT_TABLE",
        what: 'The registry row of the collection "rcbroken" names no table.',
        why: "Its `table_name` in `dynamic_collections` is empty, so where the collection's columns are cannot be known.",
        next: "Set the row's `table_name` to the collection's table, then run `nextly repair-columns` again.",
      });
    }
  );

  it.each(["dynamic_components", "dynamic_field_groups"])(
    "names the registry the database has (%s)",
    async table => {
      registry.fieldGroups = [row("card", { tableName: "" })];
      expect((await stopOf(read([table]))).why).toContain(`\`${table}\``);
    }
  );

  it("names every such row, collections first, then Singles, then field groups", async () => {
    registry.collections = [
      row("posts", { tableName: "" }),
      row("pages", { tableName: "" }),
    ];
    registry.singles = [row("home", { tableName: "" })];
    registry.fieldGroups = [row("card", { tableName: "" })];
    expect(
      await stopOf(
        read(["dynamic_collections", "dynamic_singles", "dynamic_components"])
      )
    ).toEqual({
      code: "REGISTRY_ROW_WITHOUT_TABLE",
      what: 'The registry rows of the collections "posts" and "pages", the Single "home" and the field group "card" name no table.',
      why: "Their `table_name` in `dynamic_collections`, `dynamic_singles` and `dynamic_components` is empty, so where their columns are cannot be known.",
      next: "Set each row's `table_name` to its table, then run `nextly repair-columns` again.",
    });
  });

  it("comes before a diverged row, whichever registry holds each", async () => {
    registry.collections = [];
    registry.singles = [row("home", { tableName: "" })];
    registry.fieldGroups = [row("card", { migrationStatus: "diverged" })];
    expect(
      await stopOf(read(["dynamic_singles", "dynamic_components"]))
    ).toMatchObject({
      code: "REGISTRY_ROW_WITHOUT_TABLE",
      what: 'The registry row of the Single "home" names no table.',
    });
  });
});

describe("readRepairEntities: a registry row marked as diverged", () => {
  // Its tables were changed and its stored definition was not: reporting its columns as pending a
  // migration would send the owner to repeat the change the state forbids.
  const diverged = (slug: string, over: Record<string, unknown> = {}) =>
    row(slug, { migrationStatus: "diverged", locked: false, ...over });

  it("stops the run at a field group the admin may repair, and says how", async () => {
    registry.fieldGroups = [diverged("card")];
    expect(await stopOf(read(["dynamic_field_groups"]))).toEqual({
      code: "REGISTRY_ROW_DIVERGED",
      what: 'The registry row of the field group "card" is marked as diverged.',
      why: "Its tables were changed and its stored definition still describes the previous shape, so what the database last had applied cannot be known.",
      next: 'In development, open Field Groups in the admin and choose "Repair definition" on "card". Then run `nextly repair-columns` again.',
    });
  });

  it("sends a field group locked to code to the sync, which the admin's repair refuses", async () => {
    registry.fieldGroups = [diverged("card", { source: "code", locked: true })];
    const { next } = await stopOf(read(["dynamic_components"]));
    expect(next).toBe(
      'In development, run `nextly db:sync` or start the app, which repairs "card" where the configuration declares it. Then run `nextly repair-columns` again.'
    );
  });

  it.each([
    [
      "code, its row written before the flag",
      { source: "code", locked: false },
    ],
    ["a plugin", { source: "plugin:forms", locked: false }],
  ])("sends a field group owned by %s to the sync", async (_owner, owned) => {
    registry.fieldGroups = [diverged("card", owned)];
    expect((await stopOf(read(["dynamic_components"]))).next).toContain(
      "`nextly db:sync`"
    );
  });

  it("offers neither for a collection or a Single, which have no repair", async () => {
    registry.collections = [diverged("posts")];
    expect((await stopOf(read(["dynamic_collections"]))).next).toBe(
      'Make the stored definition of the collection "posts" match its tables and set its `migration_status` to `synced`. Then run `nextly repair-columns` again.'
    );
  });

  it("tells a collection and a Single of one slug apart", async () => {
    registry.collections = [diverged("home")];
    registry.singles = [diverged("home", { tableName: "single_home" })];
    expect(
      (await stopOf(read(["dynamic_collections", "dynamic_singles"]))).next
    ).toBe(
      'Make the stored definitions of the collection "home" and the Single "home" match their tables and set their `migration_status` to `synced`. Then run `nextly repair-columns` again.'
    );
  });

  it("names every such row, each with its own next step", async () => {
    registry.fieldGroups = [
      diverged("card"),
      diverged("hero"),
      diverged("promo", { source: "code", locked: true }),
    ];
    expect(await stopOf(read(["dynamic_components"]))).toEqual({
      code: "REGISTRY_ROW_DIVERGED",
      what: 'The registry rows of the field groups "card", "hero" and "promo" are marked as diverged.',
      why: "Their tables were changed and their stored definitions still describe the previous shape, so what the database last had applied cannot be known.",
      next: 'In development, open Field Groups in the admin and choose "Repair definition" on "card" and "hero". In development, run `nextly db:sync` or start the app, which repairs "promo" where the configuration declares it. Then run `nextly repair-columns` again.',
    });
  });
});

describe("a configuration error this command does not raise", () => {
  it("is not read as one of its stops", () => {
    const error = NextlyError.configuration({ logMessage: "No config." });
    expect(toCliError(error).code).toBe("UNEXPECTED_ERROR");
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

  it("leaves a Builder collection a checked-out manifest omits with no configured definition", async () => {
    // The manifest is there and does not declare it: the next migration removes it, so the
    // registry row must not stand in for a declaration.
    manifest({ collections: [], singles: [], components: [] });
    const posts = (await read(["dynamic_collections"])).find(
      e => e.slug === "rcposts"
    );
    expect(posts?.applied?.source).toBe("registry");
    expect(posts?.configured).toBeNull();
  });

  it("reads the manifest once, and takes its presence from that read", async () => {
    // Two reads, or a separate existence check, can see the file in two states while it is
    // being written, and then disagree about which Builder entities are declared.
    manifest({ collections: [], singles: [], components: [] });
    const path = join(projectRoot, "ui-schema.json");
    files.reads.length = 0;
    files.stats.length = 0;
    const posts = (await read(["dynamic_collections"])).find(
      e => e.slug === "rcposts"
    );
    expect(posts?.configured).toBeNull();
    expect(files.reads.filter(read => read === path)).toHaveLength(1);
    expect(files.stats.filter(checked => checked === path)).toEqual([]);
  });

  it("refuses to run on a manifest it cannot read rather than drop the Builder's declarations", async () => {
    writeFileSync(join(projectRoot, "ui-schema.json"), "{");
    await expect(read(["dynamic_collections"])).rejects.toMatchObject({
      code: "NEXTLY_UI_SCHEMA_INVALID",
    });
  });
});

describe("readRepairEntities: a field group's table", () => {
  // A configuration names no field group's table: the registry does, under the names the site is on.
  it("is the one the registry stores it in, on a site on the current names", async () => {
    registry.fieldGroups = [
      {
        slug: "card",
        tableName: "fg_card",
        fields: [{ name: "heading", type: "text" }],
        source: "code",
        migrationStatus: "synced",
      },
    ];
    const [card] = await read(["dynamic_field_groups"], {
      fieldGroups: [
        { slug: "card", fields: [{ name: "heading", type: "text" }] },
      ],
    });
    expect(card).toMatchObject({ slug: "card", table: "fg_card" });
    // Not as an entity the next migration moves to another table.
    expect(JSON.stringify(card)).not.toContain("comp_card");
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
