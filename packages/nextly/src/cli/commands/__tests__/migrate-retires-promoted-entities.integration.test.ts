/**
 * A translated collection and a translated Single, each with a many-to-many field and a field
 * group, removed from code: `nextly migrate` takes their tables, every row they own in a table
 * others share, orphans their permissions with the grants kept, and ends each document with one
 * `deleted` event. A collection that stays keeps every row it had. On every configured dialect,
 * whether the file is as `nextly migrate:create` wrote it or its drops were written again by hand.
 *
 * A many-to-many field's table is the Schema Builder's to make, so the two are made there, deployed,
 * and then declared in the app's code with what the Builder recorded of them, as `db:sync --promote`
 * prints it, before they are removed from it.
 */
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { defineConfig, fieldGroup, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices, shutdownServices } from "../../../di/register";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { clearRegistryRowCache } from "../../../domains/dynamic-collections/services/collection-row-cache";
import { ensureI18nArchive } from "../../../domains/i18n/migration/ensure-archive";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import {
  KILL_AT_VARIABLE,
  KILLED_AT,
  withStopPoints,
} from "../../../domains/schema/migrate/stop-points";
import { introspectLiveSnapshot } from "../../../domains/schema/pipeline/diff/introspect-live";
import { resolveComponentTableName } from "../../../domains/schema/utils/resolve-table-name";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { _resetEnvCache } from "../../../shared/lib/env";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";
import { runMigrateDown } from "../migrate-down";
import { runMigrateResolve } from "../migrate-resolve";

/** The configuration the commands load. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const MIGRATIONS = "./migrations";
const DEFINITION = "./schema/builder.json";
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

const META = "mrp_meta";
const TAGS = "mrp_tags";
const META_TABLE = resolveComponentTableName(META);

/** An entity under test: the two removed, and the collection that stays. */
interface Entity {
  kind: "collection" | "single";
  slug: string;
  table: string;
}
const NOTES: Entity = {
  kind: "collection",
  slug: "mrp_notes",
  table: "dc_mrp_notes",
};
const HOME: Entity = {
  kind: "single",
  slug: "mrp_home",
  table: "single_mrp_home",
};
/** What the three link to, which stays. */
const TAGGED: Entity = { kind: "collection", slug: TAGS, table: `dc_${TAGS}` };
const OTHER: Entity = {
  kind: "collection",
  slug: "mrp_other",
  table: "dc_mrp_other",
};

/** The fields of each of the three. */
const fields = () => [
  text({ name: "body", localized: true } as never),
  fieldGroup({ name: "meta", component: META }),
  {
    name: "tags",
    type: "relationship",
    options: { relationType: "manyToMany", target: TAGS },
  },
];

/** The app's configuration, with what its code declares. */
const config = (declared: { collections?: unknown[]; singles?: unknown[] }) =>
  defineConfig({
    collections: [],
    ...declared,
    localization: LOCALIZATION,
    db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
  } as never);

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-promoted-retire-"));
  mkdirSync(join(dir, "migrations"));
  setNonInteractive(true);
});

afterEach(async () => {
  setNonInteractive(false);
  await shutdownServices().catch(() => {});
  for (const close of closers.splice(0)) await close();
  vi.unstubAllEnvs();
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** A database of this test's own, by name, and the URL the commands reach it by. */
async function openDatabase(
  dialect: TestDialect,
  name: string
): Promise<{ adapter: DrizzleAdapter; url: string }> {
  let url: string;
  if (dialect === "sqlite") {
    url = `file:${join(dir, `${name}.db`)}`;
  } else {
    const scratch = await createScratchDatabase(dialect, `nextly_mrp_${name}`);
    url = scratch.url;
    closers.push(() => scratch.drop());
  }
  const adapter = (await createAdapter({
    type: dialect,
    url,
  } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  closers.unshift(() => adapter.disconnect().catch(() => {}));
  return { adapter, url };
}

/** Start the app over the database at `url`, with the project's migrations and definition. */
async function start(
  dialect: TestDialect,
  database: { adapter: DrizzleAdapter; url: string }
): Promise<TestNextly> {
  vi.stubEnv("DB_DIALECT", dialect);
  vi.stubEnv("DATABASE_URL", database.url);
  _resetEnvCache();
  // Cleared, not shut down: shutting the services down would disconnect the adapter they hold.
  clearServices();
  clearRegistryRowCache();
  return createTestNextly({
    adapter: database.adapter as never,
    basePath: dir,
    db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
    localization: LOCALIZATION,
  });
}

/** A command over `project`: what it said where it failed, undefined where it finished. */
async function command(
  project: unknown,
  run: (context: CommandContext) => Promise<void>
): Promise<string | undefined> {
  loaded.config = project;
  const said: string[] = [];
  const capture = (message: string) => {
    said.push(message);
  };
  const printed = vi.spyOn(console, "error").mockImplementation(message => {
    said.push(String(message));
  });
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await run({
      logger: {
        ...createLogger({ quiet: true }),
        info: capture,
        warn: capture,
        success: capture,
        error: capture,
      },
      options: {},
      cwd: dir,
    } as CommandContext);
    return undefined;
  } catch (error) {
    return [...said, String(error)].join("\n");
  } finally {
    exit.mockRestore();
    printed.mockRestore();
  }
}

const migrate = (project: unknown, consent: string | true = true) =>
  command(project, context =>
    runMigrate(
      { cwd: dir, acceptDataLoss: consent } as Parameters<typeof runMigrate>[0],
      context
    )
  );

const migrateCreate = (project: unknown, name: string) =>
  command(project, context =>
    runMigrateCreate(name, { cwd: dir, acceptDataLoss: true } as never, context)
  );

/** The Builder's own saves, in development, as its dialogs send them. */
async function createInTheBuilder(): Promise<void> {
  vi.stubEnv("NODE_ENV", "development");
  try {
    await dispatchComponents(
      "createComponent",
      {},
      { slug: META, label: META, fields: [text({ name: "note" })] }
    );
    const collection = (slug: string, more: object) =>
      dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: slug, label: slug, ...more }
      );
    await collection(TAGS, { fields: [text({ name: "title" })] });
    await collection(NOTES.slug, { localized: true, fields: fields() });
    await collection(OTHER.slug, { localized: true, fields: fields() });
    await dispatchSingles(
      "createSingle",
      {},
      {
        slug: HOME.slug,
        label: HOME.slug,
        localized: true,
        fields: fields(),
      }
    );
  } finally {
    vi.stubEnv("NODE_ENV", "test");
  }
}

/** Two documents of each entity, translated, tagged and with field-group values; the Single's one. */
async function writeDocuments(site: TestNextly): Promise<void> {
  const tag = (
    await site.nextly.create({
      collection: TAGS as never,
      data: { title: "t" } as never,
    })
  ).item as { id: string };
  for (const { slug } of [NOTES, OTHER]) {
    for (const body of ["one", "two"]) {
      const { item } = await site.nextly.create({
        collection: slug as never,
        data: {
          body,
          title: body,
          meta: { note: body },
          tags: [tag.id],
        } as never,
      });
      await site.nextly.update({
        collection: slug as never,
        id: (item as { id: string }).id as never,
        locale: "es",
        data: { body: `${body} es`, _overwrite: true } as never,
      });
    }
  }
  await site.nextly.updateSingle({
    slug: HOME.slug as never,
    data: {
      body: "home",
      meta: { note: "h" },
      tags: [tag.id],
      _overwrite: true,
    } as never,
  });
  await site.nextly.updateSingle({
    slug: HOME.slug as never,
    locale: "es",
    data: { body: "casa", _overwrite: true } as never,
  } as never);
}

/** The rows an entity's documents keep outside its tables: one of each kind. */
async function seedSharedRows(
  adapter: DrizzleAdapter,
  { kind, slug }: Entity
): Promise<void> {
  const now = new Date();
  const scope = { scopeKind: kind, scopeSlug: slug, entryId: "e1" };
  await adapter.insert("nextly_versions", {
    id: randomUUID(),
    ...scope,
    versionNo: null,
    status: "draft",
    isAutosave: true,
    snapshot: JSON.stringify({}),
    createdAt: now,
    updatedAt: now,
  });
  await adapter.insert("nextly_version_pins", {
    id: randomUUID(),
    ...scope,
    holder: "release",
    slot: "s",
    versionNo: 1,
    pinKey: `${kind}:${slug}:e1`,
    createdAt: now,
    updatedAt: now,
  });
  await adapter.insert("nextly_version_views", {
    id: randomUUID(),
    userId: "u1",
    ...scope,
    part: "",
    viewKey: `${kind}:${slug}:e1:u1`,
    versionNo: 1,
    viewedAt: now,
    visitStartedAt: now,
    createdAt: now,
  });
  await ensureI18nArchive(adapter, adapter.getCapabilities().dialect);
  await adapter.insert("nextly_i18n_archive", {
    collection: slug,
    entityKind: kind,
    entryId: "e1",
    locale: "fr",
    field: "body",
    value: "b",
    archivedAt: now,
  });
  await adapter.insert("nextly_translation_provenance", {
    id: randomUUID(),
    ...scope,
    locale: "fr",
    partState: "live",
    fieldPath: "body",
    valueFingerprint: "f",
    origin: "machine",
    writtenAt: now,
  });
}

/**
 * The entity's tables that are there: its own, its translations' and its many-to-many field's, which
 * is named by both tables it joins, in either order.
 */
const tablesOf = async (adapter: DrizzleAdapter, { table }: Entity) =>
  (await adapter.listTables()).filter(name => name.includes(table)).sort();

/** Every row of `table` the columns in `where` name, as JSON, in a settled order. */
async function rowsWhere(
  adapter: DrizzleAdapter,
  dialect: TestDialect,
  table: string,
  where: Record<string, string> = {}
): Promise<string[]> {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const names = Object.keys(where);
  const rows = await adapter.executeQuery<Record<string, unknown>>(
    `SELECT * FROM ${q(table)}${names.length === 0 ? "" : ` WHERE ${names.map((name, n) => `${q(name)} = ${dialect === "postgresql" ? `$${n + 1}` : "?"}`).join(" AND ")}`}`,
    Object.values(where) as never
  );
  return rows.map(row => JSON.stringify(row)).sort();
}

/** Every row of each kind the entity owns outside its tables. */
async function sharedRowsOf(
  adapter: DrizzleAdapter,
  dialect: TestDialect,
  { kind, slug, table }: Entity
): Promise<Record<string, string[]>> {
  const scope = { scope_kind: kind, scope_slug: slug };
  const read = (from: string, where: Record<string, string>) =>
    rowsWhere(adapter, dialect, from, where);
  return {
    fieldGroupValues: await read(META_TABLE, { _parent_table: table }),
    registryRow: await read(
      kind === "collection" ? "dynamic_collections" : "dynamic_singles",
      { slug }
    ),
    versions: await read("nextly_versions", scope),
    versionPins: await read("nextly_version_pins", scope),
    seenMarkers: await read("nextly_version_views", scope),
    translationArchive: await read("nextly_i18n_archive", {
      collection: slug,
      entity_kind: kind,
    }),
    translationProvenance: await read("nextly_translation_provenance", scope),
  };
}

/** Every row of every table of the entity, by table. */
async function ownRowsOf(
  adapter: DrizzleAdapter,
  dialect: TestDialect,
  entity: Entity
): Promise<Record<string, string[]>> {
  const rows: Record<string, string[]> = {};
  for (const table of await tablesOf(adapter, entity)) {
    rows[table] = await rowsWhere(adapter, dialect, table);
  }
  return rows;
}

/** The entity's permissions: each with whether it is orphaned and how many grants it has. */
async function permissionsOf(
  adapter: DrizzleAdapter,
  { slug }: Entity
): Promise<{ orphaned: boolean; grants: number }[]> {
  const permissions = await adapter.select<{
    id: string;
    resource: string;
    orphanedAt: unknown;
  }>("permissions", {});
  const grants = await adapter.select<{ permissionId: string }>(
    "role_permissions",
    {}
  );
  return permissions
    .filter(each => each.resource === slug)
    .map(each => ({
      orphaned: each.orphanedAt !== null,
      grants: grants.filter(grant => grant.permissionId === each.id).length,
    }));
}

/** A role granted every permission of each entity. */
async function grantAll(
  adapter: DrizzleAdapter,
  entities: readonly Entity[]
): Promise<void> {
  const roleId = randomUUID();
  const now = new Date();
  await adapter.insert("roles", {
    id: roleId,
    name: "Promoted",
    slug: "mrp_role",
    level: 1,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  });
  const slugs = new Set(entities.map(({ slug }) => slug));
  const permissions = await adapter.select<{ id: string; resource: string }>(
    "permissions",
    {}
  );
  for (const { id, resource } of permissions) {
    if (!slugs.has(resource)) continue;
    await adapter.insert("role_permissions", {
      id: randomUUID(),
      roleId,
      permissionId: id,
      createdAt: now,
    });
  }
}

/** The table of the collection that stays and its own many-to-many field. */
const OTHER_LINKS = `dc_mrp_other_dc_${TAGS}_tags`;

/** Everything of an entity: its own rows, those it has elsewhere, its permissions and its events. */
async function pictureOf(
  adapter: DrizzleAdapter,
  dialect: TestDialect,
  entity: Entity
) {
  const events = await adapter.select<{ subjectSlug: string; kind: string }>(
    "nextly_content_events",
    {}
  );
  return {
    own: await rowsWhere(adapter, dialect, entity.table),
    shared: await sharedRowsOf(adapter, dialect, entity),
    permissions: await permissionsOf(adapter, entity),
    events: events
      .filter(event => event.subjectSlug === entity.slug)
      .map(event => event.kind)
      .sort(),
  };
}

/** How many `deleted` events each document of the entity has. */
async function deletionsOf(
  adapter: DrizzleAdapter,
  { kind, slug }: Entity
): Promise<Record<string, number>> {
  const rows = await adapter.select<{ subjectId: string }>(
    "nextly_content_events",
    {
      where: {
        and: [
          { column: "subjectKind", op: "=", value: kind },
          { column: "subjectSlug", op: "=", value: slug },
          { column: "kind", op: "=", value: "deleted" },
        ],
      },
    }
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.subjectId] = (counts[row.subjectId] ?? 0) + 1;
  }
  return counts;
}

/** The entity's recorded definition taken out of the Builder's file, as a promotion does. */
function outOfTheBuildersFile(entities: readonly Entity[]): void {
  const path = join(dir, DEFINITION);
  const definition = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    unknown
  >;
  const slugs = new Set(entities.map(({ slug }) => slug));
  for (const key of ["collections", "singles"]) {
    const held = definition[key];
    if (Array.isArray(held)) {
      definition[key] = held.filter(
        each => !slugs.has((each as { slug: string }).slug)
      );
    } else if (held !== null && typeof held === "object") {
      definition[key] = Object.fromEntries(
        Object.entries(held).filter(([slug]) => !slugs.has(slug))
      );
    }
  }
  writeFileSync(path, JSON.stringify(definition, null, 2));
}

describe.each(getConfiguredTestDialects())(
  "a translated collection and Single removed from code (%s)",
  dialect => {
    /**
     * The three made in the Builder, deployed, with documents and rows of every kind, then the two
     * declared in code and deployed as such.
     */
    async function promoted(): Promise<{
      adapter: DrizzleAdapter;
      url: string;
      ids: Map<string, string[]>;
    }> {
      const own = await openDatabase(dialect, "builder");
      const deployed = await openDatabase(dialect, "deployed");
      await start(dialect, own);
      await createInTheBuilder();

      await start(dialect, deployed);
      expect(await migrate(config({}))).toBeUndefined();
      await writeDocuments(await start(dialect, deployed));
      const { adapter } = deployed;
      for (const entity of [NOTES, HOME, OTHER]) {
        await seedSharedRows(adapter, entity);
      }

      await grantAll(adapter, [NOTES, HOME, OTHER]);

      outOfTheBuildersFile([NOTES, HOME]);
      const inCode = config({
        collections: [
          {
            slug: NOTES.slug,
            labels: { singular: NOTES.slug, plural: NOTES.slug },
            localized: true,
            fields: fields(),
          },
        ],
        singles: [
          {
            slug: HOME.slug,
            label: { singular: HOME.slug },
            localized: true,
            fields: fields(),
          },
        ],
      });
      const written = await migrateCreate(inCode, "promote");
      expect(
        written === undefined || /No changes|up to date/i.test(written),
        written
      ).toBe(true);
      expect(await migrate(inCode)).toBeUndefined();
      expect(await deletionsOf(adapter, NOTES)).toEqual({});

      const ids = new Map<string, string[]>();
      for (const { slug, table } of [NOTES, HOME]) {
        const rows = await rowsWhere(adapter, dialect, table);
        ids.set(
          slug,
          rows.map(row => (JSON.parse(row) as { id: string }).id)
        );
      }
      return { adapter, url: deployed.url, ids };
    }

    /** No table or row of the two is left, and each document has one `deleted` event. */
    async function expectRowsRetired(
      adapter: DrizzleAdapter,
      ids: ReadonlyMap<string, string[]>,
      said = ""
    ): Promise<void> {
      for (const entity of [NOTES, HOME]) {
        expect(await tablesOf(adapter, entity), said).toEqual([]);
        const left = await sharedRowsOf(adapter, dialect, entity);
        for (const [kind, rows] of Object.entries(left)) {
          expect(rows, `${entity.slug} ${kind} ${said}`).toEqual([]);
        }
        expect(await deletionsOf(adapter, entity), said).toEqual(
          Object.fromEntries(ids.get(entity.slug)!.map(id => [id, 1]))
        );
      }
    }

    /** And their permissions are orphaned. */
    async function expectRetired(
      adapter: DrizzleAdapter,
      ids: ReadonlyMap<string, string[]>,
      said = ""
    ): Promise<void> {
      await expectRowsRetired(adapter, ids, said);
      for (const entity of [NOTES, HOME]) {
        const permissions = await permissionsOf(adapter, entity);
        expect(permissions.every(each => each.orphaned)).toBe(true);
      }
    }

    /** The removal written, its drops by hand: its file's name, and the tables it drops, in order. */
    async function removalByHand(
      adapter: DrizzleAdapter
    ): Promise<{ name: string; tables: string[] }> {
      expect(await migrateCreate(config({}), "retire")).toBeUndefined();
      const tables = await dropEveryTableByHand(adapter);
      const name = readdirSync(join(dir, "migrations")).find(file =>
        file.endsWith("_retire.sql")
      );
      return { name: name!, tables };
    }

    const CONSENT = `${NOTES.table},${HOME.table}`;

    /** `nextly migrate`, stopped at `point`. */
    const stoppedAt = (point: string) =>
      withStopPoints(
        each => {
          if (each === point) throw new Error(`stopped at ${point}`);
        },
        () => migrate(config({}), CONSENT)
      );

    it("removes nothing when it stops before the first drop, or after any, where the file rolls back", async () => {
      // MySQL keeps each drop as it runs: resolved below.
      if (dialect === "mysql") return;
      const { adapter, ids } = await promoted();
      const { name, tables } = await removalByHand(adapter);
      const before = await Promise.all(
        [NOTES, HOME].map(entity => ownRowsOf(adapter, dialect, entity))
      );
      expect(tables.length).toBeGreaterThanOrEqual(6);

      for (const at of [
        "before statement 1",
        ...tables.map((_table, n) => `after statement ${n + 1}`),
      ]) {
        expect(await stoppedAt(`${name}: ${at}`), at).toMatch(/stopped/);
        expect(
          await Promise.all(
            [NOTES, HOME].map(entity => ownRowsOf(adapter, dialect, entity))
          ),
          at
        ).toEqual(before);
        expect(await deletionsOf(adapter, NOTES), at).toEqual({});
      }

      expect(await migrate(config({}), CONSENT)).toBeUndefined();
      await expectRetired(adapter, ids);
    }, 300_000);

    it("is rolled back with its link tables and their keys, and goes again", async () => {
      const { adapter } = await promoted();
      const keysOf = async () => {
        const tables = (await adapter.listTables()).filter(table =>
          table.includes("mrp_")
        );
        const live = await introspectLiveSnapshot(
          adapter.getDrizzle(),
          dialect,
          tables
        );
        return live.tables
          .flatMap(table =>
            (table.foreignKeys ?? []).map(key => ({
              table: table.name,
              to: key.referencesTable,
              columns: key.columns,
              onDelete: key.onDelete,
            }))
          )
          .map(key => JSON.stringify(key))
          .sort();
      };
      const tables = async () =>
        (await adapter.listTables())
          .filter(table => table.includes("mrp_"))
          .sort();
      const was = { tables: await tables(), keys: await keysOf() };
      expect(was.keys.length).toBeGreaterThan(4);
      expect(await migrateCreate(config({}), "retire")).toBeUndefined();
      expect(await migrate(config({}), CONSENT)).toBeUndefined();

      clearServices();
      expect(
        await command(config({}), context =>
          runMigrateDown(
            {
              cwd: dir,
              step: 1,
              acceptDataLoss: true,
              yes: true,
            } as Parameters<typeof runMigrateDown>[0],
            context
          )
        )
      ).toBeUndefined();

      expect({ tables: await tables(), keys: await keysOf() }).toEqual(was);
      // Empty: what the UP deleted is not in the file to bring back.
      for (const entity of [NOTES, HOME]) {
        const own = await ownRowsOf(adapter, dialect, entity);
        expect(Object.values(own).flat()).toEqual([]);
      }
      expect(await migrate(config({}), CONSENT)).toBeUndefined();
      expect(await tablesOf(adapter, NOTES)).toEqual([]);
    }, 300_000);

    it("never drops a link table a collection that stays names too", async () => {
      const { adapter } = await promoted();
      // In code, the collection that stays keeps its links in the removed one's table.
      const shared = `${NOTES.table}_dc_${TAGS}_tags`;
      outOfTheBuildersFile([OTHER]);
      const kept = {
        slug: OTHER.slug,
        labels: { singular: OTHER.slug, plural: OTHER.slug },
        localized: true,
        fields: fields().map(field =>
          (field as { name: string }).name === "tags"
            ? {
                ...field,
                options: {
                  relationType: "manyToMany",
                  target: TAGS,
                  junctionTable: shared,
                },
              }
            : field
        ),
      };
      const written = await migrateCreate(
        config({ collections: [kept] }),
        "retire"
      );
      expect(written).toBeUndefined();
      const file = readdirSync(join(dir, "migrations")).find(name =>
        name.endsWith("_retire.sql")
      );
      const sql = readFileSync(join(dir, "migrations", file!), "utf8");

      expect(sql).not.toMatch(
        new RegExp(`DROP TABLE (IF EXISTS )?[\`"]${shared}`)
      );
      // The one no other names still goes.
      expect(sql).toMatch(
        new RegExp(`DROP TABLE IF EXISTS [\`"]dc_${TAGS}_single_mrp_home_tags`)
      );
      const links = await rowsWhere(adapter, dialect, shared);
      await migrate(config({ collections: [kept] }), true);
      expect(await rowsWhere(adapter, dialect, shared)).toEqual(links);
    }, 300_000);

    /** Where a stopped file's drops stay: MySQL's always, others' outside a transaction. */
    const STAYING =
      dialect === "mysql"
        ? ["in a transaction", "outside a transaction"]
        : ["outside a transaction"];

    it.each(
      STAYING.flatMap(how =>
        ["its first drop", "one between", "its last drop"].map(
          which => [how, which] as const
        )
      )
    )(
      "run %s, is finished by hand and recorded where the file stopped after %s",
      async (how, which) => {
        const { adapter, ids } = await promoted();
        const { name, tables } = await removalByHand(adapter);
        if (how === "outside a transaction") {
          const path = join(dir, "migrations", name);
          writeFileSync(
            path,
            `-- nextly:no-transaction\n${readFileSync(path, "utf8")}`
          );
        }
        const ran =
          which === "its first drop"
            ? 1
            : which === "one between"
              ? tables.length - 1
              : tables.length;

        expect(await stoppedAt(`${name}: after statement ${ran}`)).toMatch(
          /stopped/
        );
        const refused = await migrate(config({}), CONSENT);
        expect(refused, "applied").toBeDefined();
        for (const [n, table] of tables.entries()) {
          expect(refused).toContain(
            `statement ${n + 1} (DROP TABLE ${table}) is ${n < ran ? "done" : "not done"}`
          );
        }
        for (const table of tables.slice(ran)) {
          await adapter.executeQuery(`DROP TABLE ${table}`);
        }
        expect(
          await command(config({}), context =>
            runMigrateResolve(
              { cwd: dir, applied: name } as Parameters<
                typeof runMigrateResolve
              >[0],
              context
            )
          )
        ).toBeUndefined();

        expect(await migrate(config({}), CONSENT)).toBeUndefined();
        // Each document once, whether the run dropped its table or the operator did.
        await expectRowsRetired(adapter, ids, which);
      },
      300_000
    );

    it.each([
      "removed registryRow",
      "removed fieldGroupValues",
      "removed translationRows",
      "removed leftovers",
    ])(
      "is finished by the next process where one was killed at: %s",
      async at => {
        const { adapter, url, ids } = await promoted();
        await removalByHand(adapter);
        writeFileSync(
          join(dir, "nextly.config.ts"),
          `export default ${JSON.stringify({
            collections: [],
            localization: LOCALIZATION,
            db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
          })};\n`
        );
        const run = async (killAt?: string) => {
          const ran = await runNextly(
            [
              "migrate",
              `--accept-data-loss=${CONSENT}`,
              "--non-interactive",
              // A killed run leaves its lock until it lapses; nothing else is running here.
              "--force-unlock",
            ],
            dir,
            {
              DATABASE_URL: url,
              DB_DIALECT: dialect,
              NODE_ENV: "test",
              [KILL_AT_VARIABLE]: killAt,
            },
            2.5 * NEXTLY_RUN_TIMEOUT
          );
          return { status: ran.status, said: `${ran.stdout}\n${ran.stderr}` };
        };
        const point = `collection ${NOTES.slug}: ${at}`;

        const killed = await run(point);
        expect(killed.said).toContain(`${KILLED_AT}${point}`);

        const finished = await run();
        expect(finished.status, finished.said).toBe(0);
        await expectRetired(adapter, ids, finished.said);
      },
      7 * NEXTLY_RUN_TIMEOUT
    );

    /** The removal's file, its drops written by hand: every table of the two, what holds a key to another first. */
    async function dropEveryTableByHand(
      adapter: DrizzleAdapter
    ): Promise<string[]> {
      const file = readdirSync(join(dir, "migrations")).find(name =>
        name.endsWith("_retire.sql")
      );
      const path = join(dir, "migrations", file!);
      const sql = readFileSync(path, "utf8");
      const tables = [
        ...(await tablesOf(adapter, NOTES)),
        ...(await tablesOf(adapter, HOME)),
      ];
      const mains = [NOTES.table, HOME.table];
      const ordered = [
        ...tables.filter(table => !mains.includes(table)),
        ...mains,
      ];
      const drops = ordered.map(table => `DROP TABLE ${table};`);
      writeFileSync(
        path,
        `${sql.slice(0, sql.indexOf("-- UP"))}-- UP\n${drops.join("\n")}\n\n${sql.slice(sql.indexOf("-- DOWN"))}`
      );
      return ordered;
    }

    it.each([
      "recorded applied",
      "files recorded",
      "removed registryRow",
      "registry written",
      "recorded deletion events",
      "removed fieldGroupValues",
      "removed translationRows",
      "removed leftovers",
    ])(
      "is finished by the next run where one stopped at: %s",
      async at => {
        const { adapter, ids } = await promoted();
        const other = await sharedRowsOf(adapter, dialect, OTHER);
        expect(await migrateCreate(config({}), "retire")).toBeUndefined();
        await dropEveryTableByHand(adapter);
        const consent = `${NOTES.table},${HOME.table}`;

        let reached = 0;
        const stopped = await withStopPoints(
          point => {
            if (point !== at && !point.endsWith(`: ${at}`)) return;
            reached += 1;
            throw new Error(`stopped at ${at}`);
          },
          () => migrate(config({}), consent)
        );
        expect(reached, at).toBe(1);
        expect(stopped, "finished").toBeDefined();
        for (const entity of [NOTES, HOME]) {
          expect(await tablesOf(adapter, entity)).toEqual([]);
        }

        // Nothing is pending, and no drop runs again.
        expect(await migrate(config({}), consent)).toBeUndefined();

        await expectRetired(adapter, ids);
        expect(await sharedRowsOf(adapter, dialect, OTHER)).toEqual(other);
      },
      300_000
    );

    it.each(["as it was written", "its drops written again by hand"])(
      "goes with everything it owns, and nothing of another's, the file %s",
      async how => {
        const { adapter, ids } = await promoted();
        // Positive control: rows of every kind for each, a translations table and a junction.
        for (const entity of [NOTES, HOME, OTHER]) {
          const held = await sharedRowsOf(adapter, dialect, entity);
          for (const [kind, rows] of Object.entries(held)) {
            expect(rows.length, `${entity.slug} ${kind}`).toBeGreaterThan(0);
          }
          const own = await ownRowsOf(adapter, dialect, entity);
          expect(Object.keys(own).length, entity.slug).toBeGreaterThanOrEqual(
            3
          );
          for (const [table, rows] of Object.entries(own)) {
            expect(rows.length, table).toBeGreaterThan(0);
          }
        }
        // One document of each has no event before the drop, as one from before content history.
        for (const entity of [NOTES, HOME]) {
          await adapter.delete("nextly_content_events", {
            and: [
              { column: "subjectId", op: "=", value: ids.get(entity.slug)![0] },
            ],
          });
        }
        const linkedBefore = await pictureOf(adapter, dialect, TAGGED);
        const before = {
          shared: await sharedRowsOf(adapter, dialect, OTHER),
          own: await ownRowsOf(adapter, dialect, OTHER),
          permissions: await permissionsOf(adapter, OTHER),
          notes: await permissionsOf(adapter, NOTES),
          home: await permissionsOf(adapter, HOME),
        };
        expect(before.notes.length).toBeGreaterThan(0);
        expect(before.notes.every(each => each.grants > 0)).toBe(true);
        expect(before.home.length).toBeGreaterThan(0);
        expect(before.home.every(each => each.grants > 0)).toBe(true);

        expect(await migrateCreate(config({}), "retire")).toBeUndefined();
        const file = readdirSync(join(dir, "migrations")).find(name =>
          name.endsWith("_retire.sql")
        );
        const path = join(dir, "migrations", file!);
        const sql = readFileSync(path, "utf8");
        if (how !== "as it was written") await dropEveryTableByHand(adapter);

        expect(
          await migrate(config({}), `${NOTES.table},${HOME.table}`),
          sql
        ).toBeUndefined();

        for (const entity of [NOTES, HOME]) {
          expect(await tablesOf(adapter, entity), sql).toEqual([]);
          const left = await sharedRowsOf(adapter, dialect, entity);
          for (const [kind, rows] of Object.entries(left)) {
            expect(rows, `${entity.slug} ${kind}`).toEqual([]);
          }
          expect(await deletionsOf(adapter, entity)).toEqual(
            Object.fromEntries(ids.get(entity.slug)!.map(id => [id, 1]))
          );
        }
        for (const [was, now] of [
          [before.notes, await permissionsOf(adapter, NOTES)],
          [before.home, await permissionsOf(adapter, HOME)],
        ]) {
          expect(now.every(each => each.orphaned)).toBe(true);
          expect(now.map(each => each.grants).sort()).toEqual(
            was.map(each => each.grants).sort()
          );
        }
        expect(await sharedRowsOf(adapter, dialect, OTHER)).toEqual(
          before.shared
        );
        expect(await ownRowsOf(adapter, dialect, OTHER)).toEqual(before.own);
        expect(await permissionsOf(adapter, OTHER)).toEqual(before.permissions);
        expect(await deletionsOf(adapter, OTHER)).toEqual({});
        // The entity they linked to, its rows and its other links, as they were.
        expect(await pictureOf(adapter, dialect, TAGGED)).toEqual(linkedBefore);
        expect(
          (await rowsWhere(adapter, dialect, OTHER_LINKS)).length
        ).toBeGreaterThan(0);
      },
      300_000
    );
  }
);
