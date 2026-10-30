/**
 * A read or write the database has not been migrated for says so, on every
 * dialect, through the REST API and the Direct API, for a collection and a
 * Single.
 *
 * Each case boots with both entities migrated and written, then takes away
 * what a skipped `nextly migrate` would leave missing: a declared field's
 * column, or the entity's table. A third case leaves the database whole and
 * takes the entity out of the running instance's registry, as an instance
 * that started before a migration added the entity holds it.
 *
 * Every operation is asserted by its code, its status and the entity and field
 * or table its public data names, so an operation answered for any other
 * reason fails here, and by its message: the entity, the field or table and
 * `nextly migrate` named, and no SQL. Before the change every one of them
 * answered INTERNAL_ERROR 500 with "An unexpected error occurred."
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runWithRequestCaller } from "../../../auth/caller-scope";
import { defineCollection, defineSingle, text } from "../../../config";
import type { SchemaRegistry } from "../../../database/schema-registry";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { DynamicCollectionService } from "../services/dynamic-collection-service";
import { ServiceContainer } from "../../../services/index";

const POSTS = "um_posts";
const BANNER = "um_banner";
/** Their tables, as the registry names them. */
const POSTS_TABLE = `dc_${POSTS}`;
const BANNER_TABLE = `single_${BANNER}`;
/** Translated, with Draft/Published, for publishing every language at once. */
const PUB = "um_pub";
const PUB_BANNER = "um_pub_banner";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

function t(): TestNextly {
  if (!current) throw new Error("not booted");
  return current;
}

/** The Direct API, as the operations below call it. */
interface DirectApi {
  find(args: Record<string, unknown>): Promise<unknown>;
  findByID(args: Record<string, unknown>): Promise<unknown>;
  create(args: Record<string, unknown>): Promise<{ item: { id: string } }>;
  update(args: Record<string, unknown>): Promise<unknown>;
  delete(args: Record<string, unknown>): Promise<unknown>;
  count(args: Record<string, unknown>): Promise<unknown>;
  group(args: Record<string, unknown>): Promise<unknown>;
  timeseries(args: Record<string, unknown>): Promise<unknown>;
  findSingle(args: Record<string, unknown>): Promise<unknown>;
  updateSingle(args: Record<string, unknown>): Promise<unknown>;
  users: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
  };
  permissions: {
    find(args: {
      limit: number;
    }): Promise<{ items: { id: string; slug: string }[] }>;
  };
  roles: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
  };
}

const direct = (): DirectApi => t().nextly as unknown as DirectApi;

/**
 * Boot with a collection and a Single, each holding a document, and return
 * an API key whose role holds every permission on both, so a REST request
 * reaches the read or write rather than stopping at authorization.
 */
async function boot(dialect: TestDialect): Promise<{
  key: string;
  id: string;
  owner: string;
  pubId: string;
}> {
  current = await createTestNextly({
    dialect,
    localization: { locales: ["en", "de"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: POSTS,
        fields: [
          text({ name: "title" }),
          // Readable only by trusted server code, so a REST caller is never
          // told its name.
          text({ name: "subtitle", access: { read: () => false } }),
        ],
      }),
      defineCollection({
        slug: PUB,
        status: true,
        localized: true,
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: BANNER,
        fields: [
          text({ name: "title" }),
          // Readable only by trusted server code, so a REST caller is never
          // told its name.
          text({ name: "subtitle", access: { read: () => false } }),
        ],
      }),
      defineSingle({
        slug: PUB_BANNER,
        status: true,
        localized: true,
        fields: [text({ name: "title" })],
      }),
    ],
  });
  const api = direct();
  const owner = await api.users.create({
    data: {
      email: "owner@example.com",
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });
  const permissions = await api.permissions.find({ limit: 500 });
  const granted = permissions.items.filter(
    p => p.slug.endsWith(`-${POSTS}`) || p.slug.endsWith(`-${BANNER}`)
  );
  expect(
    granted.map(p => p.slug).sort(),
    "the key must hold the entities' permissions, or REST answers a refusal"
  ).toEqual(
    expect.arrayContaining([
      `create-${POSTS}`,
      `delete-${POSTS}`,
      `read-${POSTS}`,
      `update-${POSTS}`,
      `read-${BANNER}`,
      `update-${BANNER}`,
    ])
  );
  const role = await api.roles.create({
    data: {
      name: "Editor",
      slug: "editor",
      permissionIds: granted.map(p => p.id),
    },
  });
  const apiKeys = t().getService("apiKeyService") as unknown as {
    createApiKey(
      userId: string,
      input: {
        name: string;
        tokenType: string;
        roleId: string;
        expiresIn: string;
      }
    ): Promise<{ key: string }>;
  };
  const { key } = await apiKeys.createApiKey(owner.item.id, {
    name: "editor",
    tokenType: "role-based",
    roleId: role.item.id,
    expiresIn: "unlimited",
  });
  const entry = await api.create({
    collection: POSTS,
    data: { title: "First", subtitle: "One" },
  });
  await api.updateSingle({ slug: BANNER, data: { title: "First" } });
  const pub = await api.create({ collection: PUB, data: { title: "Draft" } });
  await api.updateSingle({ slug: PUB_BANNER, data: { title: "Draft" } });
  return { key, id: entry.item.id, owner: owner.item.id, pubId: pub.item.id };
}

/** Run `work` as the install's owner, signed in, as a REST dispatch is. */
function asOwner<T>(owner: string, work: () => Promise<T>): Promise<T> {
  return runWithRequestCaller(
    {
      userId: owner,
      actor: { type: "user", id: owner },
      roles: ["super-admin"],
    },
    work
  );
}

/** The entry service, for the writes a caller's transaction makes. */
function entryService(): Record<
  string,
  (...args: unknown[]) => Promise<Record<string, unknown>>
> {
  return (
    t().getService("collectionsHandler") as unknown as {
      getEntryService(): Record<
        string,
        (...args: unknown[]) => Promise<Record<string, unknown>>
      >;
    }
  ).getEntryService();
}

/** What `write` answered inside a transaction of the caller's own. */
async function inTransaction(
  write: (tx: unknown) => Promise<Record<string, unknown>>
): Promise<Record<string, unknown> | undefined> {
  let result: Record<string, unknown> | undefined;
  // The transaction itself may refuse to commit after the failure; what the
  // write answered inside it is what is asserted.
  await t()
    .adapter.transaction(async tx => {
      result = await write(tx);
      if (result.success === false) throw new Error("roll back");
    })
    .catch(() => undefined);
  return result;
}

/** What a caller is answered, from either door. */
interface Answer {
  status: number;
  code?: string;
  data?: unknown;
  message?: string;
}

async function viaDirect(work: () => Promise<unknown>): Promise<Answer> {
  try {
    await work();
    return { status: 200 };
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    return {
      status: error.statusCode,
      code: error.code,
      data: error.publicData,
      message: error.publicMessage,
    };
  }
}

async function viaRest(
  key: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string[],
  body?: unknown
): Promise<Answer> {
  const res = await createDynamicHandlers()[method](
    new Request(`http://localhost/api/${path.join("/")}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ params: path }) }
  );
  const json = (await res.json()) as {
    error?: { code?: string; message?: string; data?: unknown };
  };
  return {
    status: res.status,
    code: json.error?.code,
    data: json.error?.data,
    message: json.error?.message,
  };
}

interface Operation {
  name: string;
  kind: "collection" | "single";
  run(key: string, id: string): Promise<Answer>;
}

/** Every read and write of an entry each door offers, one row each. */
const OPERATIONS: Operation[] = [
  {
    name: "Direct find",
    kind: "collection",
    run: () => viaDirect(() => direct().find({ collection: POSTS })),
  },
  {
    name: "Direct findByID",
    kind: "collection",
    run: (_key, id) =>
      viaDirect(() => direct().findByID({ collection: POSTS, id })),
  },
  // The aggregate reads filter on the field the column cases take away, so
  // their statement names it.
  {
    name: "Direct count",
    kind: "collection",
    run: () =>
      viaDirect(() =>
        direct().count({
          collection: POSTS,
          where: { subtitle: { equals: "One" } },
        })
      ),
  },
  {
    name: "Direct group",
    kind: "collection",
    run: () =>
      viaDirect(() =>
        direct().group({ collection: POSTS, groupBy: "subtitle" })
      ),
  },
  {
    name: "Direct timeseries",
    kind: "collection",
    run: () =>
      viaDirect(() =>
        direct().timeseries({
          collection: POSTS,
          dateField: "createdAt",
          interval: "day",
          where: { subtitle: { equals: "One" } },
        })
      ),
  },
  {
    name: "Direct create",
    kind: "collection",
    run: () =>
      viaDirect(() =>
        direct().create({
          collection: POSTS,
          data: { title: "Second", subtitle: "Two" },
        })
      ),
  },
  {
    name: "Direct update",
    kind: "collection",
    run: (_key, id) =>
      viaDirect(() =>
        direct().update({ collection: POSTS, id, data: { subtitle: "Uno" } })
      ),
  },
  {
    name: "Direct delete",
    kind: "collection",
    run: (_key, id) =>
      viaDirect(() => direct().delete({ collection: POSTS, id })),
  },
  {
    name: "Direct findSingle",
    kind: "single",
    run: () => viaDirect(() => direct().findSingle({ slug: BANNER })),
  },
  {
    name: "Direct updateSingle",
    kind: "single",
    run: () =>
      viaDirect(() =>
        direct().updateSingle({ slug: BANNER, data: { subtitle: "Uno" } })
      ),
  },
  {
    name: "REST list",
    kind: "collection",
    run: key => viaRest(key, "GET", ["collections", POSTS, "entries"]),
  },
  {
    name: "REST get",
    kind: "collection",
    run: (key, id) =>
      viaRest(key, "GET", ["collections", POSTS, "entries", id]),
  },
  {
    name: "REST create",
    kind: "collection",
    run: key =>
      viaRest(key, "POST", ["collections", POSTS, "entries"], {
        title: "Second",
        subtitle: "Two",
      }),
  },
  {
    name: "REST update",
    kind: "collection",
    run: (key, id) =>
      viaRest(key, "PATCH", ["collections", POSTS, "entries", id], {
        subtitle: "Uno",
      }),
  },
  {
    name: "REST delete",
    kind: "collection",
    run: (key, id) =>
      viaRest(key, "DELETE", ["collections", POSTS, "entries", id]),
  },
  {
    name: "REST Single get",
    kind: "single",
    run: key => viaRest(key, "GET", ["singles", BANNER]),
  },
  {
    name: "REST Single update",
    kind: "single",
    run: key => viaRest(key, "PATCH", ["singles", BANNER], { subtitle: "Uno" }),
  },
];

/** The entity an operation is about, as its answer names it. */
function entityOf(operation: Operation) {
  return operation.kind === "single"
    ? { kind: "single", slug: BANNER, table: BANNER_TABLE }
    : { kind: "collection", slug: POSTS, table: POSTS_TABLE };
}

/** Words of a statement, none of which a public message may carry. */
const SQL = /\b(select|insert|update|delete|from|where|returning)\b/i;

/**
 * Run each operation and assert it is answered as `expected` says, softly, so
 * one run reports every operation rather than the first that differs.
 */
async function expectEveryAnswer(
  operations: Operation[],
  target: { key: string; id: string },
  expected: (operation: Operation) => {
    data: Record<string, unknown>;
    names: string[];
  }
): Promise<void> {
  for (const operation of operations) {
    const answer = await operation.run(target.key, target.id);
    let want = expected(operation);
    // REST callers are held to access rules: never told the table, and not
    // the field either, since `subtitle`'s read rule denies them. The Direct
    // API runs as trusted server code and is told both.
    if (operation.name.startsWith("REST")) {
      const { table, field, ...shown } = want.data;
      want = {
        data: shown,
        names: want.names.filter(
          name => name !== `"${String(table)}"` && name !== `"${String(field)}"`
        ),
      };
      expect
        .soft(answer.data, `${operation.name} withholds the table`)
        .not.toHaveProperty("table");
      expect
        .soft(answer.data, `${operation.name} withholds the field`)
        .not.toHaveProperty("field");
      for (const hidden of [table, field]) {
        if (typeof hidden === "string") {
          expect
            .soft(
              answer.message,
              `${operation.name}'s message withholds ${hidden}`
            )
            .not.toContain(`"${hidden}"`);
        }
      }
    }
    expect
      .soft(answer, `${operation.name} answers ENTITY_NOT_MIGRATED`)
      .toMatchObject({
        status: 409,
        code: "ENTITY_NOT_MIGRATED",
        data: want.data,
      });
    for (const name of [...want.names, "`nextly migrate`"]) {
      expect
        .soft(answer.message, `${operation.name}'s message names ${name}`)
        .toContain(name);
    }
    expect
      .soft(answer.message, `${operation.name}'s message holds no SQL`)
      .not.toMatch(SQL);
  }
}

function quoted(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

async function execute(sql: string): Promise<void> {
  await (
    t().adapter as unknown as { executeQuery(sql: string): Promise<unknown> }
  ).executeQuery(sql);
}

describe.each(getConfiguredTestDialects())(
  "a read or write the database is not migrated for (%s)",
  dialect => {
    it("names the field whose column is missing, as a skipped migration leaves it", async () => {
      const target = await boot(dialect);
      for (const table of [POSTS_TABLE, BANNER_TABLE]) {
        await execute(
          `ALTER TABLE ${quoted(dialect, table)} DROP COLUMN ${quoted(dialect, "subtitle")}`
        );
      }
      await expectEveryAnswer(OPERATIONS, target, operation => {
        const { kind, slug, table } = entityOf(operation);
        return {
          data: { reason: "column", kind, slug, table, field: "subtitle" },
          names: [`"${slug}"`, `"subtitle"`, "not been migrated"],
        };
      });
      // Neither name for a read that enforces field rules though it overrides
      // document access (a preview link's), nor for a super-admin over REST:
      // only trusted server code is told the schema's physical names.
      const withheld = [
        await viaDirect(() =>
          direct().findByID({
            collection: POSTS,
            id: target.id,
            overrideAccess: true,
            enforceFieldAccess: true,
          })
        ),
        await viaDirect(() =>
          asOwner(target.owner, () =>
            dispatchCollections(
              new ServiceContainer(t().adapter),
              "listEntries",
              { collectionName: POSTS } as never,
              undefined
            )
          )
        ),
      ];
      for (const [i, answer] of withheld.entries()) {
        expect.soft(answer, `withheld answer ${i}`).toMatchObject({
          code: "ENTITY_NOT_MIGRATED",
          data: { reason: "column", kind: "collection", slug: POSTS },
        });
        expect
          .soft(answer.data, `withheld answer ${i}`)
          .not.toHaveProperty("field");
        expect
          .soft(answer.data, `withheld answer ${i}`)
          .not.toHaveProperty("table");
      }
    }, 120_000);

    it("names the entity and its table when its table is missing", async () => {
      const target = await boot(dialect);
      for (const table of [POSTS_TABLE, BANNER_TABLE]) {
        await execute(`DROP TABLE ${quoted(dialect, table)}`);
      }
      await expectEveryAnswer(OPERATIONS, target, operation => {
        const { kind, slug, table } = entityOf(operation);
        return {
          data: { reason: "table", kind, slug, table },
          names: [`"${slug}"`, `"${table}"`, "not been migrated"],
        };
      });
    }, 120_000);

    it.each([
      ["a declared field's column", "column"],
      ["the entity's table", "table"],
    ] as const)(
      "answers the same inside a caller's transaction when %s is missing",
      async (_what, reason) => {
        // The transactional writes a plugin or a batch makes. On PostgreSQL
        // the failed statement aborts the transaction, so the answer cannot
        // depend on reading anything more through it.
        const target = await boot(dialect);
        await execute(
          reason === "column"
            ? `ALTER TABLE ${quoted(dialect, POSTS_TABLE)} DROP COLUMN ${quoted(dialect, "subtitle")}`
            : `DROP TABLE ${quoted(dialect, POSTS_TABLE)}`
        );
        const entries = entryService();
        const params = { collectionName: POSTS, overrideAccess: true };
        const writes: Array<
          [string, (tx: unknown) => Promise<Record<string, unknown>>]
        > = [
          [
            "create",
            tx =>
              entries.createEntryInTransaction(tx, params, {
                title: "Second",
                subtitle: "Two",
              }),
          ],
          [
            "update",
            tx =>
              entries.updateEntryInTransaction(
                tx,
                { ...params, entryId: target.id },
                { subtitle: "Uno" }
              ),
          ],
          [
            "delete",
            tx =>
              entries.deleteEntryInTransaction(tx, {
                ...params,
                entryId: target.id,
              }),
          ],
        ];
        // A registry read on the pool while the caller's transaction holds a
        // connection could wait forever on a small pool: the answer comes
        // from the row the write read on its own transaction.
        const registryReads = vi.spyOn(
          DynamicCollectionService.prototype,
          "getCollection"
        );
        for (const [name, write] of writes) {
          registryReads.mockClear();
          const result = await inTransaction(write);
          expect
            .soft(
              registryReads.mock.calls.filter(call => call[1] === undefined),
              `${name} reads no registry row on the pool`
            )
            .toEqual([]);
          expect
            .soft(
              result,
              `${name} in a transaction answers ENTITY_NOT_MIGRATED`
            )
            .toMatchObject({
              success: false,
              code: "ENTITY_NOT_MIGRATED",
              publicData:
                reason === "column"
                  ? { reason, slug: POSTS, field: "subtitle" }
                  : { reason, slug: POSTS, table: POSTS_TABLE },
            });
        }
      },
      120_000
    );

    it("names the entity when discarding a working draft finds its table missing", async () => {
      // The root-exported discards, called directly: their own transaction
      // meets the missing table first. Not trusted server code, so the table
      // is not named.
      const target = await boot(dialect);
      for (const table of [POSTS_TABLE, BANNER_TABLE]) {
        await execute(`DROP TABLE ${quoted(dialect, table)}`);
      }
      const discards: Array<[string, string, string, () => Promise<unknown>]> =
        [
          [
            "collection discard",
            "collection",
            POSTS,
            () =>
              (
                t().getService("collectionsHandler") as unknown as {
                  discardWorkingDraft(
                    p: Record<string, unknown>
                  ): Promise<void>;
                }
              ).discardWorkingDraft({
                collectionName: POSTS,
                entryId: target.id,
              }),
          ],
          [
            "Single discard",
            "single",
            BANNER,
            () =>
              (
                t().getService("singleEntryService") as unknown as {
                  discardWorkingDraft(
                    p: Record<string, unknown>
                  ): Promise<void>;
                }
              ).discardWorkingDraft({ slug: BANNER }),
          ],
        ];
      for (const [name, kind, slug, run] of discards) {
        const answer = await viaDirect(run);
        expect.soft(answer, name).toMatchObject({
          status: 409,
          code: "ENTITY_NOT_MIGRATED",
          data: { reason: "table", kind, slug },
        });
        expect
          .soft(answer.data, `${name} withholds the table`)
          .not.toHaveProperty("table");
      }
    }, 120_000);

    it("names the entity and its table when publishing every language finds its table missing", async () => {
      const target = await boot(dialect);
      // Neither was migrated: each companion goes first, since it references
      // its main table.
      for (const table of [
        `dc_${PUB}_locales`,
        `dc_${PUB}`,
        `single_${PUB_BANNER}_locales`,
        `single_${PUB_BANNER}`,
      ]) {
        await execute(`DROP TABLE ${quoted(dialect, table)}`);
      }
      const publishes: Array<[string, string, string, () => Promise<unknown>]> =
        [
          [
            "collection publish-all",
            "collection",
            PUB,
            () =>
              asOwner(target.owner, () =>
                dispatchCollections(
                  new ServiceContainer(t().adapter),
                  "publishAllLocales",
                  { collectionName: PUB, entryId: target.pubId } as never,
                  undefined
                )
              ),
          ],
          [
            "Single publish-all",
            "single",
            PUB_BANNER,
            () =>
              asOwner(target.owner, () =>
                dispatchSingles(
                  "publishAllSingleLocales",
                  { slug: PUB_BANNER } as never,
                  undefined
                )
              ),
          ],
        ];
      for (const [name, kind, slug, run] of publishes) {
        const answer = await viaDirect(run);
        // Through the REST dispatcher, held to access rules: the entity, and
        // not its table.
        expect.soft(answer, name).toMatchObject({
          status: 409,
          code: "ENTITY_NOT_MIGRATED",
          data: { reason: "table", kind, slug },
        });
        expect
          .soft((answer as Answer).data, `${name} withholds the table`)
          .not.toHaveProperty("table");
      }
    }, 120_000);

    it("refuses a write to an entity this instance has not registered, naming it and its table", async () => {
      const target = await boot(dialect);
      // An instance that started before a migration added the entity holds
      // no table for it; the database has it.
      const registry = t().getService(
        "schemaRegistry" as never
      ) as SchemaRegistry;
      registry.retractDynamicSchema(POSTS_TABLE);
      const writes = OPERATIONS.filter(operation =>
        [
          "Direct update",
          "Direct delete",
          "REST update",
          "REST delete",
        ].includes(operation.name)
      );
      await expectEveryAnswer(writes, target, operation => {
        const { kind, slug, table } = entityOf(operation);
        return {
          data: { reason: "unregistered", kind, slug, table },
          names: [`"${slug}"`, `"${table}"`, "not registered"],
        };
      });
    }, 120_000);
  }
);
