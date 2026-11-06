/**
 * A document's version history and its content events say the database has not
 * been migrated for the collection, on every dialect, when a declared field's
 * column or the collection's table is missing.
 *
 * Both reads ask about the document before reading its history: the version
 * routes read it as the caller, to judge whether the caller may see its
 * history; the content-events read asks whether a document whose life ended is
 * still there, as trusted server code, whoever the caller is. Each case boots
 * with the collection migrated, a live document with versions and a deleted
 * one, then takes away the column or the table.
 *
 * A caller held to access rules is told the collection and the reason only,
 * never the table or the field; trusted server code is told both. Before the
 * change each of these answered INTERNAL_ERROR 500.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { NextlyError } from "../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";

const POSTS = "nmv_posts";
/** Its table, as the registry names it. */
const POSTS_TABLE = `dc_${POSTS}`;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

function t(): TestNextly {
  if (!current) throw new Error("not booted");
  return current;
}

/** The Direct API, as the reads below call it. */
interface DirectApi {
  create(args: Record<string, unknown>): Promise<{ item: { id: string } }>;
  update(args: Record<string, unknown>): Promise<unknown>;
  delete(args: Record<string, unknown>): Promise<unknown>;
  contentEvents: { list(args: Record<string, unknown>): Promise<unknown> };
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

interface Target {
  /** An API key whose role holds every permission on the collection. */
  key: string;
  /** The key's owner, a person held to access rules on the Direct API. */
  owner: string;
  /** A live document with a version history. */
  live: string;
  /** A document deleted after it was made, so its life has ended. */
  gone: string;
}

/**
 * Boot with a versioned collection holding a live document with versions and
 * a deleted one, and an API key whose role holds every permission on it, so a
 * REST request reaches the read rather than stopping at authorization.
 */
async function boot(dialect: TestDialect): Promise<Target> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        versions: true,
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
  const granted = permissions.items.filter(p => p.slug.endsWith(`-${POSTS}`));
  expect(
    granted.map(p => p.slug),
    "the key must hold the read permission, or REST answers a refusal"
  ).toContain(`read-${POSTS}`);
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
  const live = await api.create({
    collection: POSTS,
    data: { title: "First", subtitle: "One" },
  });
  await api.update({
    collection: POSTS,
    id: live.item.id,
    data: { title: "Second", _overwrite: true },
  });
  const gone = await api.create({
    collection: POSTS,
    data: { title: "Gone", subtitle: "Two" },
  });
  await api.delete({ collection: POSTS, id: gone.item.id });
  return {
    key,
    owner: owner.item.id,
    live: live.item.id,
    gone: gone.item.id,
  };
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
  path: string[],
  query: Record<string, string> = {}
): Promise<Answer> {
  const search = new URLSearchParams(query).toString();
  const res = await createDynamicHandlers().GET(
    new Request(
      `http://localhost/api/${path.join("/")}${search ? `?${search}` : ""}`,
      { headers: { authorization: `Bearer ${key}` } }
    ),
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

interface Read {
  name: string;
  /** Whether the caller is trusted server code, told the table and field. */
  trusted: boolean;
  run(target: Target): Promise<Answer>;
}

/** The ended document's events, read by subject. */
const goneSubject = (target: Target) => ({
  kind: "collection",
  slug: POSTS,
  id: target.gone,
});

const READS: Read[] = [
  // The version routes read the live document as the caller.
  {
    name: "REST version list",
    trusted: false,
    run: ({ key, live }) =>
      viaRest(key, ["collections", POSTS, "entries", live, "versions"]),
  },
  {
    name: "REST version detail",
    trusted: false,
    run: ({ key, live }) =>
      viaRest(key, ["collections", POSTS, "entries", live, "versions", "1"]),
  },
  // The events read asks, as trusted server code, whether the ended document
  // is still there, and answers the caller by the caller's own trust.
  {
    name: "REST content events",
    trusted: false,
    run: ({ key, gone }) =>
      viaRest(key, ["content-events"], {
        subject: "collection",
        slug: POSTS,
        id: gone,
      }),
  },
  {
    name: "Direct content events as a person",
    trusted: false,
    run: target =>
      viaDirect(() =>
        direct().contentEvents.list({
          subject: goneSubject(target),
          user: { id: target.owner },
          overrideAccess: false,
        })
      ),
  },
  {
    name: "Direct content events as server code",
    trusted: true,
    run: target =>
      viaDirect(() =>
        direct().contentEvents.list({ subject: goneSubject(target) })
      ),
  },
];

/** Words of a statement, none of which a public message may carry. */
const SQL = /\b(select|insert|update|delete|from|where|returning)\b/i;

/**
 * Run each read and assert it answers ENTITY_NOT_MIGRATED with `missing`,
 * softly, so one run reports every read rather than the first that differs.
 *
 * Each assertion rejects a plausible broken answer: the INTERNAL_ERROR 500 a
 * read gave before; the trusted answer forwarded whole to a caller held to
 * access rules, which would name the table and field to it; and the names
 * withheld from everyone, which leaves server code without the table and
 * field it is owed.
 */
async function expectEveryAnswer(
  target: Target,
  missing: { reason: "column" | "table"; field?: string }
): Promise<void> {
  // Both names are withheld from a caller held to access rules. Trusted code
  // is told the one the reason is about: the field for a missing column, the
  // table for a missing table (the column's table is in the data).
  const hidden = [POSTS_TABLE, ...(missing.field ? [missing.field] : [])];
  const told = missing.field ?? POSTS_TABLE;
  for (const read of READS) {
    const answer = await read.run(target);
    const named = {
      table: POSTS_TABLE,
      ...(missing.field ? { field: missing.field } : {}),
    };
    expect
      .soft(answer, `${read.name} answers ENTITY_NOT_MIGRATED`)
      .toMatchObject({
        status: 409,
        code: "ENTITY_NOT_MIGRATED",
        data: {
          reason: missing.reason,
          kind: "collection",
          slug: POSTS,
          ...(read.trusted ? named : {}),
        },
      });
    if (!read.trusted) {
      // An answer with no data is caught by the assertion above; here only
      // what it names matters.
      const data = answer.data ?? {};
      expect
        .soft(data, `${read.name} withholds the table`)
        .not.toHaveProperty("table");
      expect
        .soft(data, `${read.name} withholds the field`)
        .not.toHaveProperty("field");
    }
    if (read.trusted) {
      expect
        .soft(answer.message, `${read.name}'s message names ${told}`)
        .toContain(`"${told}"`);
    } else {
      for (const name of hidden) {
        expect
          .soft(answer.message, `${read.name}'s message withholds ${name}`)
          .not.toContain(name);
      }
    }
    for (const name of [`"${POSTS}"`, "`nextly migrate`"]) {
      expect
        .soft(answer.message, `${read.name}'s message names ${name}`)
        .toContain(name);
    }
    expect
      .soft(answer.message, `${read.name}'s message holds no SQL`)
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
  "a version or event read the database is not migrated for (%s)",
  dialect => {
    it("says a declared field's column is missing, naming it only to trusted code", async () => {
      const target = await boot(dialect);
      await execute(
        `ALTER TABLE ${quoted(dialect, POSTS_TABLE)} DROP COLUMN ${quoted(dialect, "subtitle")}`
      );
      await expectEveryAnswer(target, { reason: "column", field: "subtitle" });
    }, 120_000);

    it("says the collection's table is missing, naming it only to trusted code", async () => {
      const target = await boot(dialect);
      await execute(`DROP TABLE ${quoted(dialect, POSTS_TABLE)}`);
      await expectEveryAnswer(target, { reason: "table" });
    }, 120_000);
  }
);
