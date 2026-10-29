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

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import type { SchemaRegistry } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

const POSTS = "um_posts";
const BANNER = "um_banner";
/** Their tables, as the registry names them. */
const POSTS_TABLE = `dc_${POSTS}`;
const BANNER_TABLE = `single_${BANNER}`;

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
async function boot(
  dialect: TestDialect
): Promise<{ key: string; id: string }> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        fields: [text({ name: "title" }), text({ name: "subtitle" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: BANNER,
        fields: [text({ name: "title" }), text({ name: "subtitle" })],
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
  return { key, id: entry.item.id };
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
    const want = expected(operation);
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
