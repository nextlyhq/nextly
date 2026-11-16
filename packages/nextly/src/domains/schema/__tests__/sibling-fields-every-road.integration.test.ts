/**
 * One sibling-field rule on every road, against a real database.
 *
 * A decision table: each row is a road that creates or changes a collection's, a Single's or a
 * field group's fields (the Builder's dispatcher saves, previews and applies, the schema REST
 * routes, the root-exported `CollectionService`, a plugin's `ctx.services.collections`, the field
 * group Direct API). On each, a change that creates a NEW pair of sibling fields is refused with
 * `FIELD_NAME_DUPLICATE` and a message naming the entity, the container and both fields, and
 * afterwards nothing is written: the registry row is as it was (none, for a create), the table is
 * as it was (absent, for a create) and no migration file appeared. A clean change on the same
 * road then goes through and is seen by the same readers, so "nothing written" is a reading that
 * could have come out otherwise.
 *
 * Two clash shapes per road, one inside group `seo` and one at the top level. Roads that check
 * names against the manifest's `^[a-z][a-z0-9_]*$` refuse `fooBar` and `Body` for their spelling
 * before any pair is judged, so on those roads the pairs that reach the rule are exact repeats.
 *
 * One positive row: a name repeated in places that are not siblings (the top level, a group, two
 * repeaters) is accepted by a Builder create, and an entry keeps each value apart.
 *
 * Every road runs under `NODE_ENV=development`, where a Builder save applies its DDL and records
 * the entity at once, so a road that failed to refuse would leave a table, a row and a migration
 * file behind for the readers to find.
 *
 * Each case owns its database: a throwaway database on PostgreSQL and MySQL, a temporary file on
 * SQLite.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH as patchCollectionRoute } from "../../../api/collections-schema-detail";
import { POST as postCollectionRoute } from "../../../api/collections-schema";
import { PATCH as patchFieldGroupRoute } from "../../../api/field-groups-detail";
import { POST as postFieldGroupRoute } from "../../../api/field-groups";
import { PATCH as patchSingleRoute } from "../../../api/singles-schema-detail";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { createAdapter } from "../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../database/test-database-ddl";
import { clearServices } from "../../../di/register";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import type { CollectionService } from "../../../services/collections/collection-service";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { ServiceContainer } from "../../../services";
import { _resetEnvCache } from "../../../shared/lib/env";

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

interface CaseDatabase {
  adapter: DrizzleAdapter;
  close(): Promise<void>;
}

/**
 * The database one case boots against, dropped by `close`: a throwaway database on PostgreSQL and
 * MySQL, and a temporary file on SQLite.
 */
async function openDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const dir = await mkdtemp(join(tmpdir(), "nextly-sibling-fields-"));
    const adapter = (await createAdapter({
      type: "sqlite",
      url: `file:${join(dir, "test.db")}`,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    return {
      adapter,
      async close() {
        await adapter.disconnect().catch(() => {});
        await rm(dir, { recursive: true, force: true });
      },
    };
  }
  const serverUrl = process.env[SERVER_URL_ENV[dialect]];
  if (!serverUrl) throw new Error(`${SERVER_URL_ENV[dialect]} is not set`);
  const name = `nextly_sf_${randomBytes(8).toString("hex")}`;
  vi.stubEnv("DATABASE_URL", serverUrl);
  vi.stubEnv("DB_DIALECT", dialect);
  _resetEnvCache();
  const server = await createAdapter({ type: dialect, url: serverUrl });
  await server.executeQuery(createDatabaseStatement(dialect, name));
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  vi.stubEnv("DATABASE_URL", url.toString());
  _resetEnvCache();
  const adapter = (await createAdapter({
    type: dialect,
    url: url.toString(),
  })) as unknown as DrizzleAdapter;
  return {
    adapter,
    async close() {
      await adapter.disconnect().catch(() => {});
      await server.executeQuery(dropDatabaseStatement(dialect, name));
      await server.disconnect();
    },
  };
}

type Kind = "collection" | "single" | "fieldGroup";
type Field = Record<string, unknown> & { name: string; type: string };

const ENTITY: Record<
  Kind,
  { slug: string; label: string; registry: string; table: string }
> = {
  collection: {
    slug: "posts",
    label: "Collection",
    registry: "dynamic_collections",
    table: "dc_posts",
  },
  single: {
    slug: "home",
    label: "Single",
    registry: "dynamic_singles",
    table: "single_home",
  },
  fieldGroup: {
    slug: "promo",
    label: "Field group",
    registry: STORAGE_FORMAT.registryTable,
    table: "comp_promo",
  },
};

/** The fields every entity starts with: a top-level `body` and a group `seo`. */
const BASE: Field[] = [
  { name: "body", type: "text" },
  {
    name: "seo",
    type: "group",
    fields: [{ name: "meta_title", type: "text" }],
  },
];

/** A clean change: one more top-level field, with no sibling of a clashing name. */
const withSummary = (fields: Field[]): Field[] => [
  ...fields,
  { name: "summary", type: "text" },
];

/** A clean change that leaves the table as it is: `body` given a label. */
const relabelled = (fields: Field[]): Field[] =>
  fields.map(field =>
    field.name === "body" ? { ...field, label: "Body text" } : field
  );

const intoSeo = (fields: Field[], extra: Field[]): Field[] =>
  fields.map(field =>
    field.name === "seo"
      ? { ...field, fields: [...(field.fields as Field[]), ...extra] }
      : field
  );

interface Shape {
  shape: string;
  apply(fields: Field[]): Field[];
  /** The exact refusal, for the entity of `kind`. */
  message(kind: Kind): string;
}

const said = (kind: Kind, rest: string) =>
  `${ENTITY[kind].label} '${ENTITY[kind].slug}': ${rest} Rename one of them.`;

/** For roads that take any spelling: a column pair in a group, a case pair at the top level. */
const SPELLING_SHAPES: Shape[] = [
  {
    shape: "`fooBar` and `foo_bar` in group `seo`",
    apply: fields =>
      intoSeo(fields, [
        { name: "fooBar", type: "text" },
        { name: "foo_bar", type: "text" },
      ]),
    message: kind =>
      said(
        kind,
        "fields 'fooBar' and 'foo_bar' in group 'seo' would both become the column 'foo_bar'."
      ),
  },
  {
    shape: "`Body` beside `body` at the top level",
    apply: fields => [...fields, { name: "Body", type: "text" }],
    message: kind =>
      said(
        kind,
        "fields 'body' and 'Body' at the top level differ only in letter case."
      ),
  },
];

/**
 * A system name under one exact spelling twice, at the top level: two
 * column-less fields, and a text field beside a column-less one. Neither is the
 * field `define*` adds standing aside, and both pairs share the document key.
 */
const SYSTEM_NAME_SHAPES: Shape[] = [
  {
    shape: "two column-less `slug` fields at the top level",
    apply: fields => [
      ...fields,
      { name: "slug", type: "text", virtual: true },
      { name: "slug", type: "text", virtual: true },
    ],
    message: kind =>
      said(
        kind,
        "fields 'slug' and 'slug' at the top level have the same name."
      ),
  },
  {
    shape: "a text `slug` beside a column-less `slug` at the top level",
    apply: fields => [
      ...fields,
      { name: "slug", type: "text" },
      { name: "slug", type: "text", virtual: true },
    ],
    message: kind =>
      said(
        kind,
        "fields 'slug' and 'slug' at the top level have the same name."
      ),
  },
];

/**
 * For roads that take any spelling: a sent text `title` beside a sent column-less `Title`. Only
 * `define*` adds a system field, so a road that writes what it is sent lets none stand aside.
 */
const SYSTEM_CASE_SHAPE: Shape = {
  shape: "a text `title` beside a column-less `Title` at the top level",
  apply: fields => [
    ...fields,
    { name: "title", type: "text" },
    { name: "Title", type: "text", virtual: true },
  ],
  message: kind =>
    said(
      kind,
      "fields 'title' and 'Title' at the top level differ only in letter case."
    ),
};

/** For roads that hold names to the manifest's lowercase spelling: exact repeats. */
const REPEAT_SHAPES: Shape[] = [
  {
    shape: "`note` twice in group `seo`",
    apply: fields =>
      intoSeo(fields, [
        { name: "note", type: "text" },
        { name: "note", type: "text" },
      ]),
    message: kind =>
      said(kind, "fields 'note' and 'note' in group 'seo' have the same name."),
  },
  {
    shape: "`body` twice at the top level",
    apply: fields => [...fields, { name: "body", type: "text" }],
    message: kind =>
      said(
        kind,
        "fields 'body' and 'body' at the top level have the same name."
      ),
  },
];

/** Where the app under test keeps its files: the Builder writes its migrations below it. */
let projectRoot: string;

/** Every file below the app's root, so a migration written anywhere there is seen. */
async function projectFiles(): Promise<string[]> {
  const entries = await readdir(projectRoot, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath ?? entry.path, entry.name))
    .sort();
}

/** The entity's registry row as stored, or `null`. */
async function registryRow(
  adapter: DrizzleAdapter,
  kind: Kind
): Promise<Record<string, unknown> | null> {
  const { registry, slug } = ENTITY[kind];
  const rows = await adapter.executeQuery<Record<string, unknown>>(
    `SELECT * FROM ${registry} WHERE slug = '${slug}'`
  );
  return rows[0] ?? null;
}

/** The table's columns, or `null` when there is no table. */
async function columnsOf(
  adapter: DrizzleAdapter,
  dialect: TestDialect,
  table: string
): Promise<string[] | null> {
  if (!(await adapter.tableExists(table))) return null;
  const sql =
    dialect === "sqlite"
      ? `SELECT name FROM pragma_table_info('${table}')`
      : dialect === "postgresql"
        ? `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
        : `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`;
  const rows = await adapter.executeQuery<{ name: string }>(sql);
  return rows.map(r => r.name).sort();
}

interface State {
  row: Record<string, unknown> | null;
  columns: string[] | null;
  files: string[];
}

/** What a refusal must leave as it was: the registry row, the table, the app's files. */
async function stateOf(
  adapter: DrizzleAdapter,
  dialect: TestDialect,
  kind: Kind
): Promise<State> {
  return {
    row: await registryRow(adapter, kind),
    columns: await columnsOf(adapter, dialect, ENTITY[kind].table),
    files: await projectFiles(),
  };
}

/** The entity's fields as its registry row stores them. */
function storedFields(row: Record<string, unknown> | null): Field[] {
  const fields = row?.fields;
  return (typeof fields === "string" ? JSON.parse(fields) : fields) as Field[];
}

/** A Builder save as a development server runs it, where a save applies its DDL at once. */
async function inDevelopment<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  vi.stubEnv("NODE_ENV", "development");
  try {
    return await run();
  } finally {
    vi.stubEnv("NODE_ENV", previous);
  }
}

type Outcome = { accepted: true } | { refused: unknown };

/**
 * What a road answered: accepted, or the refusal's per-field errors (its message when it has
 * none). A road answers through a thrown error or, over REST, through a response.
 */
async function outcomeOf(run: () => Promise<unknown>): Promise<Outcome> {
  let result: unknown;
  try {
    result = await run();
  } catch (error) {
    const e = error as {
      publicData?: { errors?: unknown };
      message?: string;
    };
    return { refused: e.publicData?.errors ?? e.message };
  }
  if (result instanceof Response && result.status >= 400) {
    const body = (await result.json()) as {
      error?: { message?: string; data?: { errors?: unknown } };
    };
    return { refused: body.error?.data?.errors ?? body.error?.message };
  }
  return { accepted: true };
}

const refusal = (message: string): Outcome => ({
  refused: [{ path: "fields", code: "FIELD_NAME_DUPLICATE", message }],
});

/** The collection service a plugin is handed, captured as the plugin starts. */
let pluginCollections: {
  createCollection(input: unknown, context: unknown): Promise<unknown>;
  updateCollection(
    name: string,
    input: unknown,
    context: unknown
  ): Promise<unknown>;
};

const PROBE_PLUGIN: PluginDefinition = {
  name: "@test/sibling-fields-probe",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init: async ctx => {
    pluginCollections = ctx.services
      .collections as unknown as typeof pluginCollections;
  },
};

/** A super-admin's session cookie, made once per boot: the first user created is the super-admin. */
const sessions = new WeakMap<TestNextly, Promise<Record<string, string>>>();
function superAdminSession(t: TestNextly): Promise<Record<string, string>> {
  let session = sessions.get(t);
  if (!session) {
    session = (async () => {
      const seeder = t.getService("permissionSeedService") as unknown as {
        seedSystemPermissions: () => Promise<unknown>;
      };
      await seeder.seedSystemPermissions();
      const direct = t.nextly as unknown as {
        users: {
          create(a: {
            email: string;
            password: string;
            data: Record<string, unknown>;
          }): Promise<{ item: { id: string } }>;
        };
      };
      const userId = (
        await direct.users.create({
          email: "owner@example.com",
          password: "Password123!",
          data: { name: "Owner", isActive: true },
        })
      ).item.id;
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: "owner@example.com",
          name: "Owner",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      return {
        cookie: `nextly_session=${token}`,
        "content-type": "application/json",
      };
    })();
    sessions.set(t, session);
  }
  return session;
}

async function rest(
  t: TestNextly,
  method: "POST" | "PATCH",
  path: string,
  body: unknown
): Promise<Request> {
  return new Request(`http://localhost${path}`, {
    method,
    headers: await superAdminSession(t),
    body: JSON.stringify(body),
  });
}

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

/** The stored schema version, which an apply is checked against. */
async function schemaVersionOf(t: TestNextly, kind: Kind): Promise<number> {
  const row = await registryRow(t.adapter as never, kind);
  return Number(row?.schema_version ?? 1);
}

/** The Builder's create of each kind, which also makes the entity an update road starts from. */
const builderCreate: Record<Kind, (fields: Field[]) => Promise<unknown>> = {
  collection: fields =>
    dispatchCollections(
      {} as ServiceContainer,
      "createCollection",
      {},
      { name: ENTITY.collection.slug, label: "Posts", fields }
    ),
  single: fields =>
    dispatchSingles(
      "createSingle",
      {},
      { slug: ENTITY.single.slug, label: "Home", fields }
    ),
  fieldGroup: fields =>
    dispatchComponents(
      "createComponent",
      {},
      { slug: ENTITY.fieldGroup.slug, label: "Promo", fields }
    ),
};

interface Road {
  /** Reaches the collection service's create or update (`userFieldsOf`). */
  viaService?: boolean;
  road: string;
  kind: Kind;
  /** A create road starts from no entity; an update road from one the Builder created. */
  creates: boolean;
  /** Whether the road holds names to the manifest's lowercase spelling. */
  manifestNames: boolean;
  /** A preview writes nothing even when it accepts, so its clean change is only accepted. */
  dryRun?: boolean;
  /**
   * The road changes a field group's definition but not its table: it sends a table change to the
   * preview and apply flow, so its clean change is a label.
   */
  keepsTable?: boolean;
  send(t: TestNextly, fields: Field[]): Promise<unknown>;
}

const collectionService = (t: TestNextly) =>
  t.getService("collectionService") as unknown as CollectionService;

const ROADS: Road[] = [
  // Collections.
  {
    road: "the Builder's collection create",
    viaService: true,
    kind: "collection",
    creates: true,
    manifestNames: false,
    send: (_t, fields) => builderCreate.collection(fields),
  },
  {
    road: "the Builder's collection update",
    viaService: true,
    kind: "collection",
    creates: false,
    manifestNames: false,
    send: (_t, fields) =>
      dispatchCollections(
        {} as ServiceContainer,
        "updateCollection",
        { collectionName: "posts" },
        { fields }
      ),
  },
  {
    road: "the root-exported CollectionService's create",
    viaService: true,
    kind: "collection",
    creates: true,
    manifestNames: false,
    send: (t, fields) =>
      collectionService(t).createCollection(
        { name: "posts", label: "Posts", fields } as never,
        {} as never
      ),
  },
  {
    road: "the root-exported CollectionService's update",
    viaService: true,
    kind: "collection",
    creates: false,
    manifestNames: false,
    send: (t, fields) =>
      collectionService(t).updateCollection(
        "posts",
        { fields } as never,
        {} as never
      ),
  },
  {
    road: "a plugin's ctx.services.collections create",
    viaService: true,
    kind: "collection",
    creates: true,
    manifestNames: false,
    send: (_t, fields) =>
      pluginCollections.createCollection(
        { name: "posts", label: "Posts", fields },
        {}
      ),
  },
  {
    road: "a plugin's ctx.services.collections update",
    viaService: true,
    kind: "collection",
    creates: false,
    manifestNames: false,
    send: (_t, fields) =>
      pluginCollections.updateCollection("posts", { fields }, {}),
  },
  {
    road: "the Builder's collection preview",
    kind: "collection",
    creates: false,
    manifestNames: true,
    dryRun: true,
    send: (_t, fields) =>
      dispatchCollections(
        {} as ServiceContainer,
        "previewSchemaChanges",
        { collectionName: "posts" },
        { fields }
      ),
  },
  {
    road: "the Builder's collection apply",
    kind: "collection",
    creates: false,
    manifestNames: true,
    send: async (t, fields) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields,
          confirmed: true,
          schemaVersion: await schemaVersionOf(t, "collection"),
        }
      ),
  },
  {
    road: "the collection schema route's POST",
    kind: "collection",
    creates: true,
    manifestNames: true,
    send: async (t, fields) =>
      postCollectionRoute(
        await rest(t, "POST", "/api/collections/schema", {
          slug: "posts",
          labels: { singular: "Post", plural: "Posts" },
          fields,
        })
      ),
  },
  {
    road: "the collection schema route's PATCH",
    kind: "collection",
    creates: false,
    manifestNames: true,
    send: async (t, fields) =>
      patchCollectionRoute(
        await rest(t, "PATCH", "/api/collections/schema/posts", { fields }),
        params("posts")
      ),
  },
  // Singles.
  {
    road: "the Builder's Single create",
    kind: "single",
    creates: true,
    manifestNames: false,
    send: (_t, fields) => builderCreate.single(fields),
  },
  {
    road: "the Builder's Single update",
    kind: "single",
    creates: false,
    manifestNames: true,
    send: (_t, fields) =>
      dispatchSingles("updateSingleSchema", { slug: "home" }, { fields }),
  },
  {
    road: "the Builder's Single preview",
    kind: "single",
    creates: false,
    manifestNames: true,
    dryRun: true,
    send: (_t, fields) =>
      dispatchSingles(
        "previewSingleSchemaChanges",
        { slug: "home" },
        { fields }
      ),
  },
  {
    road: "the Builder's Single apply",
    kind: "single",
    creates: false,
    manifestNames: true,
    send: async (t, fields) =>
      dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "home" },
        {
          fields,
          confirmed: true,
          schemaVersion: await schemaVersionOf(t, "single"),
        }
      ),
  },
  {
    road: "the Single schema route's PATCH",
    kind: "single",
    creates: false,
    manifestNames: true,
    send: async (t, fields) =>
      patchSingleRoute(
        await rest(t, "PATCH", "/api/singles/schema/home", { fields }),
        params("home")
      ),
  },
  // Field groups.
  {
    road: "the Builder's field group create",
    kind: "fieldGroup",
    creates: true,
    manifestNames: false,
    send: (_t, fields) => builderCreate.fieldGroup(fields),
  },
  {
    road: "the Builder's field group update",
    kind: "fieldGroup",
    creates: false,
    keepsTable: true,
    manifestNames: false,
    send: (_t, fields) =>
      dispatchComponents("updateComponent", { slug: "promo" }, { fields }),
  },
  {
    road: "the field group route's POST",
    kind: "fieldGroup",
    creates: true,
    manifestNames: true,
    send: async (t, fields) =>
      postFieldGroupRoute(
        await rest(t, "POST", "/api/field-groups", {
          slug: "promo",
          label: "Promo",
          fields,
        })
      ),
  },
  {
    road: "the field group route's PATCH",
    kind: "fieldGroup",
    creates: false,
    keepsTable: true,
    manifestNames: true,
    send: async (t, fields) =>
      patchFieldGroupRoute(
        await rest(t, "PATCH", "/api/field-groups/promo", { fields }),
        params("promo")
      ),
  },
  {
    road: "the Direct API's fieldGroups.create",
    kind: "fieldGroup",
    creates: true,
    manifestNames: false,
    send: (t, fields) =>
      t.nextly.fieldGroups.create({
        slug: "promo",
        label: "Promo",
        fields: fields as never,
      }),
  },
  {
    road: "the Direct API's fieldGroups.update",
    kind: "fieldGroup",
    creates: false,
    keepsTable: true,
    manifestNames: false,
    send: (t, fields) =>
      t.nextly.fieldGroups.update({
        slug: "promo",
        data: { fields: fields as never },
      }),
  },
  {
    road: "the Builder's field group preview",
    kind: "fieldGroup",
    creates: false,
    manifestNames: true,
    dryRun: true,
    send: (_t, fields) =>
      dispatchComponents(
        "previewComponentSchemaChanges",
        { slug: "promo" },
        { fields }
      ),
  },
  {
    road: "the Builder's field group apply",
    kind: "fieldGroup",
    creates: false,
    manifestNames: true,
    send: async (t, fields) =>
      dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "promo" },
        {
          fields,
          confirmed: true,
          schemaVersion: await schemaVersionOf(t, "fieldGroup"),
        }
      ),
  },
];

for (const dialect of getConfiguredTestDialects()) {
  describe(`one sibling-field rule on every road — ${dialect}`, () => {
    let database: CaseDatabase;

    async function boot(): Promise<TestNextly> {
      clearServices();
      return createTestNextly({
        adapter: database.adapter as never,
        plugins: [PROBE_PLUGIN],
        // The app under test's folder, which `projectFiles` reads: absent,
        // the instance would write to a temporary folder of its own.
        basePath: projectRoot,
      });
    }

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), "nextly-sibling-app-"));
      vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
      database = await openDatabase(dialect);
    });

    afterEach(async () => {
      resetSessionStandingForTests();
      clearServices();
      await database.close();
      vi.restoreAllMocks();
      await rm(projectRoot, { recursive: true, force: true });
      vi.unstubAllEnvs();
      _resetEnvCache();
    });

    for (const road of ROADS) {
      // The collection service drops a system name (`title`, `slug`) from what it is sent before
      // judging or storing anything, so on its roads such a pair never reaches the row.
      const dropsSystemNames = road.kind === "collection" && road.viaService;
      const shapes = [
        ...(road.manifestNames ? REPEAT_SHAPES : SPELLING_SHAPES),
        ...(dropsSystemNames ? [] : SYSTEM_NAME_SHAPES),
        ...(dropsSystemNames || road.manifestNames ? [] : [SYSTEM_CASE_SHAPE]),
      ];
      it(`${road.road} refuses a new pair of sibling fields and writes nothing`, async () => {
        const t = await boot();
        const adapter = t.adapter as unknown as DrizzleAdapter;
        await inDevelopment(async () => {
          if (!road.creates) {
            expect(
              await outcomeOf(() => builderCreate[road.kind](BASE))
            ).toEqual({ accepted: true });
          }
          const before = await stateOf(adapter, dialect, road.kind);
          if (road.creates) {
            expect(before.row).toBeNull();
            expect(before.columns).toBeNull();
          }
          // The change is the fields as the entity has them, with one new pair added.
          const current = road.creates ? BASE : storedFields(before.row);

          for (const shape of shapes) {
            expect(
              await outcomeOf(() => road.send(t, shape.apply(current))),
              shape.shape
            ).toEqual(refusal(shape.message(road.kind)));
            expect(
              await stateOf(adapter, dialect, road.kind),
              shape.shape
            ).toEqual(before);
          }

          // The control: a clean change on the same road goes through, and where the road writes,
          // the readers above see it, so their unchanged reading above is not one they always give.
          const clean = road.keepsTable ? relabelled : withSummary;
          expect(await outcomeOf(() => road.send(t, clean(current)))).toEqual({
            accepted: true,
          });
          const after = await stateOf(adapter, dialect, road.kind);
          if (road.dryRun) {
            expect(after).toEqual(before);
          } else {
            expect(after.row).not.toEqual(before.row);
            const stored = storedFields(after.row);
            if (road.keepsTable) {
              expect(stored.find(field => field.name === "body")).toMatchObject(
                { label: "Body text" }
              );
            } else {
              expect(stored.map(field => field.name)).toContain("summary");
            }
          }
        });
      });
    }

    it("accepts one name in places that are not siblings, and an entry keeps each value apart", async () => {
      const t = await boot();
      const titled = (name: string, type: string): Field => ({
        name,
        type,
        fields: [{ name: "title", type: "text" }],
      });
      expect(
        await outcomeOf(() =>
          inDevelopment(() =>
            dispatchCollections(
              {} as ServiceContainer,
              "createCollection",
              {},
              {
                name: "notes",
                label: "Notes",
                fields: [
                  { name: "title", type: "text" },
                  titled("seo", "group"),
                  titled("links", "repeater"),
                  titled("refs", "repeater"),
                ],
              }
            )
          )
        )
      ).toEqual({ accepted: true });

      const written = await t.nextly.create({
        collection: "notes",
        data: {
          title: "At the top",
          seo: { title: "In the group" },
          links: [{ title: "In links" }],
          refs: [{ title: "In refs" }],
        },
      });
      const read = (await t.nextly.findByID({
        collection: "notes",
        id: (written.item as { id: string }).id,
      })) as Record<string, unknown> | null;
      expect(read).toMatchObject({
        title: "At the top",
        seo: { title: "In the group" },
        links: [{ title: "In links" }],
        refs: [{ title: "In refs" }],
      });
    });
  });
}
