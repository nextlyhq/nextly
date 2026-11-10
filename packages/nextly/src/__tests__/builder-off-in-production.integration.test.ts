/**
 * The schema builder is off in production, whatever `admin.branding.showBuilder` says, on every
 * road that changes schema while a server runs; entry writes go on.
 *
 * A decision table, against a real database on each dialect. Each row is a road that creates,
 * changes, previews, repairs or deletes a collection's, a Single's or a field group's definition:
 * every builder route through the REST handler an app mounts, the schema routes an app can mount
 * on their own (`nextly/api/*`), the field-group Direct API, and a plugin's
 * `ctx.services.collections`. Under `NODE_ENV=production`, with `showBuilder: true` in the
 * configuration, each is refused with `BUILDER_DISABLED` and the production refusal, and
 * afterwards nothing is written: every registry row, every entity's table and the app's files
 * (where a save writes its definition and migration) are as they were.
 *
 * Each request carries a super-admin's session, and each body is a change the road would make,
 * so a road that failed to refuse would write; the development controls show that it would: the
 * same requests, under `NODE_ENV=development`, change what the readers read.
 *
 * Also here:
 * - in production, a Direct API entry write and a REST entry write apply;
 * - in production, the admin is told the builder is off (`showBuilder: false` in the workspace
 *   answer), whatever the configuration says;
 * - in development with `showBuilder: false`, every builder route is refused as today, while the
 *   schema saves made in code (Direct API, plugin) go ahead: that setting is the admin's.
 *
 * Each case owns its database: a throwaway database on PostgreSQL and MySQL, in-memory SQLite.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE as deleteCollectionRoute } from "../api/collections-schema-detail";
import { PATCH as patchCollectionRoute } from "../api/collections-schema-detail";
import { POST as postCollectionRoute } from "../api/collections-schema";
import { DELETE as deleteFieldGroupRoute } from "../api/field-groups-detail";
import { PATCH as patchFieldGroupRoute } from "../api/field-groups-detail";
import { POST as postFieldGroupRoute } from "../api/field-groups";
import { DELETE as deleteSingleRoute } from "../api/singles-schema-detail";
import { PATCH as patchSingleRoute } from "../api/singles-schema-detail";
import { buildClaims } from "../auth/jwt/claims";
import { signAccessToken } from "../auth/jwt/sign";
import { defineCollection, text } from "../config";
import { dispatchCollections } from "../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../dispatcher/handlers/single-dispatcher";
import type { PluginDefinition } from "../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../plugins/test-nextly";
import { _recordRegisteredLocalizationForTest } from "../route-handler/auth-handler";
import { createDynamicHandlers } from "../routeHandler";
import { STORAGE_FORMAT } from "../schemas/storage-format";
import type { ServiceContainer } from "../services";
import { sanitizeConfig } from "../shared/types/config";

/** The code-first collection whose entries the Direct API writes. */
const NOTES = defineCollection({
  slug: "notes",
  fields: [text({ name: "title" })],
});

type Field = Record<string, unknown> & { name: string; type: string };

/** The fields every builder entity starts with. */
const BASE: Field[] = [{ name: "body", type: "text" }];

/** A change the roads send: one more field. */
const WITH_SUMMARY: Field[] = [...BASE, { name: "summary", type: "text" }];

/** The registry tables, by kind. */
const REGISTRIES = [
  "dynamic_collections",
  "dynamic_singles",
  STORAGE_FORMAT.registryTable,
] as const;

/**
 * Every table a road could make, change or drop: the three the builder made before each case,
 * and the three a create road would make.
 */
const TABLES = [
  "dc_posts",
  "single_home",
  "comp_promo",
  "dc_drafts",
  "single_about",
  "comp_cta",
] as const;

/** The production refusal's message, which names migrations and no switch. */
const PRODUCTION_REFUSAL = expect.stringContaining(
  "off in production"
) as unknown as string;
/** The refusal where `showBuilder: false` turned the builder off. */
const TURNED_OFF_REFUSAL = expect.stringContaining(
  "turned off by admin.branding.showBuilder"
) as unknown as string;

let projectRoot: string;
let t: TestNextly;

/** The collection service a plugin is handed, captured as the plugin starts. */
let pluginCollections: {
  createCollection(input: unknown, opts: unknown): Promise<unknown>;
  updateCollection(
    name: string,
    input: unknown,
    opts: unknown
  ): Promise<unknown>;
  deleteCollection(name: string, opts: unknown): Promise<unknown>;
};

const PROBE_PLUGIN: PluginDefinition = {
  name: "@test/builder-production-probe",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init: async ctx => {
    pluginCollections = ctx.services
      .collections as unknown as typeof pluginCollections;
  },
};

/** Run `work` under the given `NODE_ENV`, restoring the one before it. */
async function underEnv<T>(
  nodeEnv: "production" | "development",
  work: () => Promise<T>
): Promise<T> {
  const previous = process.env.NODE_ENV;
  vi.stubEnv("NODE_ENV", nodeEnv);
  try {
    return await work();
  } finally {
    vi.stubEnv("NODE_ENV", previous);
  }
}

/** Every file below the app's root, where a save writes its definition and migration. */
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

/** A table's columns, or `null` when there is no table. */
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

/** What a refused road must leave as it was. */
async function schemaState(dialect: TestDialect) {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  const registries: Record<string, unknown[]> = {};
  for (const registry of REGISTRIES) {
    registries[registry] = await adapter.executeQuery(
      `SELECT * FROM ${registry} ORDER BY slug`
    );
  }
  const tables: Record<string, string[] | null> = {};
  for (const table of TABLES) {
    tables[table] = await columnsOf(adapter, dialect, table);
  }
  return { registries, tables, files: await projectFiles() };
}

/** A super-admin's session headers, made once per instance. */
let session: Promise<Record<string, string>> | undefined;
function superAdminSession(): Promise<Record<string, string>> {
  session ??= (async () => {
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
  return session;
}

/**
 * The REST handlers an app mounts, wired to a configuration with the builder flag as given.
 * Wiring them also stores that configuration, which the stand-alone schema routes read.
 */
function handlersWith(showBuilder: boolean) {
  const config = sanitizeConfig({
    collections: [],
    admin: { branding: { showBuilder } },
  });
  const handlers = createDynamicHandlers({ config });
  // A development request re-registers the services when the localization the boot recorded
  // differs from the stored configuration's, and the harness's boot records none: without this,
  // the first development request would rebuild every service on a fresh database.
  _recordRegisteredLocalizationForTest(config);
  return handlers;
}

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

async function request(
  method: HttpMethod,
  path: string,
  body?: unknown
): Promise<Request> {
  return new Request(`http://localhost/api/${path}`, {
    method,
    headers: await superAdminSession(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The stored schema version of an entity, which an apply is checked against. */
async function schemaVersionOf(
  registry: (typeof REGISTRIES)[number],
  slug: string
): Promise<number> {
  const rows = await (t.adapter as unknown as DrizzleAdapter).executeQuery<{
    schema_version?: number | string;
  }>(`SELECT schema_version FROM ${registry} WHERE slug = '${slug}'`);
  return Number(rows[0]?.schema_version ?? 1);
}

/** A REST builder route through the mounted handler, as `path` and `body` say. */
function viaRest(
  method: HttpMethod,
  path: string,
  body?: () => Promise<unknown> | unknown
) {
  return async (showBuilder: boolean): Promise<Response> => {
    const handlers = handlersWith(showBuilder);
    const segments = path.split("/");
    return handlers[method](
      await request(
        method,
        path,
        body === undefined ? undefined : await body()
      ),
      { params: Promise.resolve({ params: segments }) }
    );
  };
}

/** A stand-alone schema route, with the configuration it reads stored first. */
function viaRoute(
  route: (
    req: Request,
    ctx: { params: Promise<{ slug: string }> }
  ) => Promise<Response>,
  method: HttpMethod,
  path: string,
  slug: string,
  body?: unknown
) {
  return async (showBuilder: boolean): Promise<Response> => {
    handlersWith(showBuilder);
    return route(await request(method, path, body), {
      params: Promise.resolve({ slug }),
    });
  };
}

interface Road {
  road: string;
  /** Answers with a response (REST) or settles (code). */
  send(showBuilder: boolean): Promise<unknown>;
  /** Whether `showBuilder: false` refuses it in development: the admin's roads only. */
  adminRoad: boolean;
}

const ROADS: Road[] = [
  // Every builder route the mounted REST handler serves.
  ...(
    [
      [
        "POST",
        "collections",
        () => ({ name: "drafts", label: "Drafts", fields: BASE }),
      ],
      ["PATCH", "collections/posts", () => ({ fields: WITH_SUMMARY })],
      ["DELETE", "collections/posts", undefined],
      ["GET", "collections/schema/posts/delete-impact", undefined],
      [
        "POST",
        "collections/schema/posts/preview",
        () => ({ fields: WITH_SUMMARY }),
      ],
      [
        "POST",
        "collections/schema/posts/apply",
        async () => ({
          fields: WITH_SUMMARY,
          confirmed: true,
          schemaVersion: await schemaVersionOf("dynamic_collections", "posts"),
        }),
      ],
      [
        "POST",
        "singles",
        () => ({ slug: "about", label: "About", fields: BASE }),
      ],
      ["PATCH", "singles/home/schema", () => ({ fields: WITH_SUMMARY })],
      ["DELETE", "singles/home", undefined],
      ["POST", "singles/schema/home/preview", () => ({ fields: WITH_SUMMARY })],
      [
        "POST",
        "singles/schema/home/apply",
        async () => ({
          fields: WITH_SUMMARY,
          confirmed: true,
          schemaVersion: await schemaVersionOf("dynamic_singles", "home"),
        }),
      ],
      [
        "POST",
        "field-groups",
        () => ({ slug: "cta", label: "CTA", fields: BASE }),
      ],
      ["PATCH", "field-groups/promo", () => ({ fields: WITH_SUMMARY })],
      ["DELETE", "field-groups/promo", undefined],
      [
        "POST",
        "field-groups/schema/promo/preview",
        () => ({ fields: WITH_SUMMARY }),
      ],
      [
        "POST",
        "field-groups/schema/promo/apply",
        async () => ({
          fields: WITH_SUMMARY,
          confirmed: true,
          schemaVersion: await schemaVersionOf(
            STORAGE_FORMAT.registryTable,
            "promo"
          ),
        }),
      ],
      ["GET", "field-groups/schema/promo/reconcile", undefined],
      ["POST", "field-groups/schema/promo/reconcile", () => ({})],
    ] as const
  ).map(
    ([method, path, body]): Road => ({
      road: `${method} /api/${path}`,
      send: viaRest(method, path, body),
      adminRoad: true,
    })
  ),
  // The schema routes an app can mount on their own.
  {
    road: "nextly/api/collections-schema POST",
    send: viaRoute(
      req => postCollectionRoute(req),
      "POST",
      "collections/schema",
      "",
      {
        slug: "drafts",
        labels: { singular: "Draft", plural: "Drafts" },
        fields: BASE,
      }
    ),
    adminRoad: true,
  },
  {
    road: "nextly/api/collections-schema-detail PATCH",
    send: viaRoute(
      patchCollectionRoute,
      "PATCH",
      "collections/schema/posts",
      "posts",
      {
        fields: WITH_SUMMARY,
      }
    ),
    adminRoad: true,
  },
  {
    road: "nextly/api/collections-schema-detail DELETE",
    send: viaRoute(
      deleteCollectionRoute,
      "DELETE",
      "collections/schema/posts",
      "posts"
    ),
    adminRoad: true,
  },
  {
    road: "nextly/api/singles-schema-detail PATCH",
    send: viaRoute(patchSingleRoute, "PATCH", "singles/schema/home", "home", {
      fields: WITH_SUMMARY,
    }),
    adminRoad: true,
  },
  {
    road: "nextly/api/singles-schema-detail DELETE",
    send: viaRoute(deleteSingleRoute, "DELETE", "singles/schema/home", "home"),
    adminRoad: true,
  },
  {
    road: "nextly/api/field-groups POST",
    send: viaRoute(
      req => postFieldGroupRoute(req),
      "POST",
      "field-groups",
      "",
      {
        slug: "cta",
        label: "CTA",
        fields: BASE,
      }
    ),
    adminRoad: true,
  },
  {
    road: "nextly/api/field-groups-detail PATCH",
    send: viaRoute(
      patchFieldGroupRoute,
      "PATCH",
      "field-groups/promo",
      "promo",
      {
        fields: WITH_SUMMARY,
      }
    ),
    adminRoad: true,
  },
  {
    road: "nextly/api/field-groups-detail DELETE",
    send: viaRoute(
      deleteFieldGroupRoute,
      "DELETE",
      "field-groups/promo",
      "promo"
    ),
    adminRoad: true,
  },
  // Schema saves made in code.
  {
    road: "the Direct API's fieldGroups.create",
    send: () =>
      t.nextly.fieldGroups.create({ slug: "cta", label: "CTA", fields: BASE }),
    adminRoad: false,
  },
  {
    road: "the Direct API's fieldGroups.update",
    // A label: the Direct API sends a change to a field group's table to the preview and apply
    // flow instead, so a label is the change this road would write.
    send: () =>
      t.nextly.fieldGroups.update({
        slug: "promo",
        data: { label: "Promo block" },
      }),
    adminRoad: false,
  },
  {
    road: "the Direct API's fieldGroups.delete",
    send: () => t.nextly.fieldGroups.delete({ slug: "promo" }),
    adminRoad: false,
  },
  {
    road: "a plugin's ctx.services.collections.createCollection",
    send: () =>
      pluginCollections.createCollection(
        { name: "drafts", label: "Drafts", fields: BASE },
        {}
      ),
    adminRoad: false,
  },
  {
    road: "a plugin's ctx.services.collections.updateCollection",
    send: () =>
      pluginCollections.updateCollection("posts", { fields: WITH_SUMMARY }, {}),
    adminRoad: false,
  },
  {
    road: "a plugin's ctx.services.collections.deleteCollection",
    send: () => pluginCollections.deleteCollection("posts", {}),
    adminRoad: false,
  },
];

/** What a road answered: its refusal's code and message, or that it was accepted. */
async function answerOf(
  run: () => Promise<unknown>
): Promise<{ code: string; message: string } | "accepted"> {
  let result: unknown;
  try {
    result = await run();
  } catch (error) {
    const e = error as {
      code?: string;
      publicMessage?: string;
      message?: string;
    };
    return {
      code: String(e.code),
      message: String(e.publicMessage ?? e.message),
    };
  }
  if (result instanceof Response && result.status >= 400) {
    const body = (await result.json()) as {
      error?: { code?: string; message?: string };
    };
    return {
      code: String(body.error?.code),
      message: String(body.error?.message),
    };
  }
  return "accepted";
}

describe.each(getConfiguredTestDialects())(
  "the schema builder in production (%s)",
  dialect => {
    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), "nextly-builder-prod-"));
      session = undefined;
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [NOTES],
        plugins: [PROBE_PLUGIN],
        basePath: projectRoot,
      });
      // What the update, preview, apply, repair and delete roads start from: an entity of each
      // kind, made by the builder where it runs.
      await underEnv("development", async () => {
        await dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          { name: "posts", label: "Posts", fields: BASE }
        );
        await dispatchSingles(
          "createSingle",
          {},
          { slug: "home", label: "Home", fields: BASE }
        );
        await dispatchComponents(
          "createComponent",
          {},
          { slug: "promo", label: "Promo", fields: BASE }
        );
      });
    }, 120_000);

    afterEach(async () => {
      await t?.destroy();
      vi.unstubAllEnvs();
      await rm(projectRoot, { recursive: true, force: true });
    });

    it.each(ROADS.map(road => [road.road, road] as const))(
      "%s is refused in production with showBuilder: true, and writes nothing",
      async (_label, road) => {
        const before = await schemaState(dialect);
        expect(
          before.tables.dc_posts,
          "the builder's entities exist"
        ).not.toBeNull();

        const answer = await underEnv("production", () =>
          answerOf(() => road.send(true))
        );

        expect(answer).toEqual({
          code: "BUILDER_DISABLED",
          message: PRODUCTION_REFUSAL,
        });
        expect(await schemaState(dialect)).toEqual(before);
      }
    );

    it.each(
      ROADS.filter(road => road.adminRoad).map(
        road => [road.road, road] as const
      )
    )(
      "%s is refused in development where showBuilder is false, and writes nothing",
      async (_label, road) => {
        const before = await schemaState(dialect);

        const answer = await underEnv("development", () =>
          answerOf(() => road.send(false))
        );

        expect(answer).toEqual({
          code: "BUILDER_DISABLED",
          message: TURNED_OFF_REFUSAL,
        });
        expect(await schemaState(dialect)).toEqual(before);
      }
    );

    // The controls: the same requests, where the builder runs, change what the readers read.
    // Without them, "writes nothing" above could come from requests that never reached a write.
    it.each([
      ["POST /api/collections", ROADS[0], "dc_drafts"],
      ["DELETE /api/collections/posts", ROADS[2], "dc_posts"],
      [
        "nextly/api/field-groups POST",
        ROADS.find(r => r.road === "nextly/api/field-groups POST"),
        "comp_cta",
      ],
    ] as const)(
      "%s applies in development where showBuilder is true",
      async (_label, road, table) => {
        const before = await schemaState(dialect);

        const answer = await underEnv("development", () =>
          answerOf(() => road!.send(true))
        );

        expect(answer).toBe("accepted");
        const after = await schemaState(dialect);
        expect(after.tables[table]).not.toEqual(before.tables[table]);
      }
    );

    // A save made in code is refused for production alone: `showBuilder` is the admin's setting.
    it.each(
      ROADS.filter(road => !road.adminRoad).map(
        road => [road.road, road] as const
      )
    )(
      "%s applies in development even where showBuilder is false",
      async (_label, road) => {
        const before = await schemaState(dialect);

        const answer = await underEnv("development", () => {
          handlersWith(false);
          return answerOf(() => road.send(false));
        });

        expect(answer).toBe("accepted");
        expect(await schemaState(dialect)).not.toEqual(before);
      }
    );

    it("applies a Direct API entry write in production", async () => {
      const created = await underEnv("production", () =>
        t.nextly.create({ collection: "notes", data: { title: "Hello" } })
      );

      expect(created.item).toMatchObject({ title: "Hello" });
      const found = await t.nextly.find({ collection: "notes" });
      expect(found.items.map(item => item.title)).toEqual(["Hello"]);
    });

    it("applies a REST entry write to a builder-made collection in production", async () => {
      const response = await underEnv("production", async () =>
        handlersWith(true).POST(
          await request("POST", "collections/posts/entries", { body: "Hello" }),
          {
            params: Promise.resolve({
              params: ["collections", "posts", "entries"],
            }),
          }
        )
      );

      expect(response.status, await response.clone().text()).toBeLessThan(300);
      const found = await t.nextly.find({ collection: "posts" });
      expect(found.items.map(item => item.body)).toEqual(["Hello"]);
    });

    it("tells the admin the builder is off in production, whatever the configuration says", async () => {
      const answerFor = (nodeEnv: "production" | "development") =>
        underEnv(nodeEnv, async () => {
          const response = await handlersWith(true).GET(
            await request("GET", "admin-meta/workspace"),
            { params: Promise.resolve({ params: ["admin-meta", "workspace"] }) }
          );
          expect(response.status).toBe(200);
          return ((await response.json()) as { showBuilder?: boolean })
            .showBuilder;
        });

      // The control first: the same configuration offers it in development.
      expect(await answerFor("development")).toBe(true);
      expect(await answerFor("production")).toBe(false);
    });
  }
);
