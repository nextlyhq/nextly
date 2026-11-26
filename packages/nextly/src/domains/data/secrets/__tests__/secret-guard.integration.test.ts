/**
 * No declared secret survives the guard, on a real database of each dialect.
 *
 * A known value is seeded into every place `CORE_SECRET_ANSWERS` names, with a
 * plain value beside each in the same table. Then every core table's rows are
 * read back, as a writer of archives would read them, and serialised twice:
 * unguarded, where the scan must find every seeded secret (the control that
 * shows the seeds reached the database and the scan can see them), and through
 * the guard, where it must find none while every plain value is still there
 * (so a guard that dropped everything would fail too).
 *
 * The seeders are keyed by the places the list declares, and the first
 * assertion is that the two sets are equal: a secret added to the list without
 * a seeder here fails rather than going untested.
 */

import { randomBytes, randomUUID } from "node:crypto";

import {
  getTableColumns,
  getTableName,
  isTable,
  type Table,
} from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  availableDialects,
  buildCurrentCoreSchema,
  type FreshDatabase,
  withFreshDatabase,
} from "../../../../__tests__/helpers/fresh-database";
import { SETUP_TOKEN_META_KEY } from "../../../../auth/setup-token/setup-token";
import { loadDialectTables } from "../../../../database/dialect-tables";
import { getCoreSchema } from "../../../../schemas/core-schema";
import { PRINCIPAL_DIGEST_KEY_META_KEY } from "../../../audit/principal-digest";
import { CORE_SECRET_ANSWERS } from "../core-secrets";
import { createSecretGuard } from "../guard";
import { findSeededSecrets, type OutputPart, type SeededSecret } from "../scan";

beforeAll(async () => {
  await Promise.all(availableDialects().map(d => loadDialectTables(d)));
});

/** The drizzle surface this file needs, whichever dialect built it. */
interface Db {
  insert: (table: Table) => {
    values: (row: Record<string, unknown>) => Promise<unknown>;
  };
  select: () => {
    from: (table: Table) => Promise<Array<Record<string, unknown>>>;
  };
}

/** A fresh value per seed: 16 characters, so it fits the narrowest column. */
function seed(): string {
  return randomBytes(8).toString("hex");
}

/** The dialect's table objects by their name in the database. */
function tablesByName(fresh: FreshDatabase): Map<string, Table> {
  const out = new Map<string, Table>();
  for (const value of Object.values(fresh.tables as Record<string, unknown>)) {
    if (isTable(value)) out.set(getTableName(value), value);
  }
  return out;
}

/** A row keyed by column name, rekeyed by the table object's property names. */
function byProperty(
  table: Table,
  row: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const columns = Object.entries(getTableColumns(table));
  for (const [name, value] of Object.entries(row)) {
    const match = columns.find(([, column]) => column.name === name);
    if (!match) throw new Error(`${getTableName(table)} has no column ${name}`);
    out[match[0]] = value;
  }
  return out;
}

/** A row read through drizzle, rekeyed by column name, as an archive carries it. */
function byColumnName(
  table: Table,
  row: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [property, column] of Object.entries(getTableColumns(table))) {
    out[column.name] = row[property];
  }
  return out;
}

/** What one seeder wrote: the secrets, and the plain values beside them. */
interface Seeded {
  secrets: SeededSecret[];
  plain: string[];
}

type Insert = (table: string, row: Record<string, unknown>) => Promise<void>;

/**
 * One seeder per place the list declares, keyed `table` for a table whose
 * rows are secret (all of them or some) and `table.column` for a column.
 */
const SEEDERS: Record<
  string,
  (insert: Insert, userId: string) => Promise<Seeded>
> = {
  "users.password_hash": async (insert, userId) => {
    const value = seed();
    const plain = `${seed()}@example.test`;
    await insert("users", { id: userId, email: plain, password_hash: value });
    return {
      secrets: [{ label: "users.password_hash", value }],
      plain: [plain],
    };
  },
  password_reset_tokens: async (insert, userId) => {
    const value = seed();
    // Its id is the database's own counter.
    await insert("password_reset_tokens", {
      identifier: "a@example.test",
      user_id: userId,
      token_hash: value,
      expires: new Date(Date.now() + 60_000),
    });
    return { secrets: [{ label: "password_reset_tokens", value }], plain: [] };
  },
  user_invite_tokens: async (insert, userId) => {
    const value = seed();
    // Its id is the database's own counter.
    await insert("user_invite_tokens", {
      user_id: userId,
      token_hash: value,
      expires: new Date(Date.now() + 60_000),
    });
    return { secrets: [{ label: "user_invite_tokens", value }], plain: [] };
  },
  email_verification_tokens: async (insert, userId) => {
    const value = seed();
    // Its id is the database's own counter.
    await insert("email_verification_tokens", {
      identifier: "a@example.test",
      user_id: userId,
      token_hash: value,
      expires: new Date(Date.now() + 60_000),
    });
    return {
      secrets: [{ label: "email_verification_tokens", value }],
      plain: [],
    };
  },
  refresh_tokens: async (insert, userId) => {
    const value = seed();
    await insert("refresh_tokens", {
      id: randomUUID(),
      user_id: userId,
      token_hash: value,
      expires_at: new Date(Date.now() + 60_000),
    });
    return { secrets: [{ label: "refresh_tokens", value }], plain: [] };
  },
  api_keys: async (insert, userId) => {
    const value = seed();
    await insert("api_keys", {
      id: randomUUID(),
      name: "Seeded key",
      key_hash: value,
      key_prefix: seed(),
      token_type: "read-only",
      user_id: userId,
    });
    return { secrets: [{ label: "api_keys", value }], plain: [] };
  },
  nextly_meta: async insert => {
    const token = seed();
    const digestKey = seed();
    const plain = seed();
    // Written as JSON text: the column is JSON on PostgreSQL and MySQL and
    // plain text on SQLite, and a JSON string is stored by all three.
    await insert("nextly_meta", {
      key: SETUP_TOKEN_META_KEY,
      value: JSON.stringify({ digest: token }),
    });
    await insert("nextly_meta", {
      key: PRINCIPAL_DIGEST_KEY_META_KEY,
      value: JSON.stringify(`sealed:${digestKey}`),
    });
    await insert("nextly_meta", {
      key: "seed.marker",
      value: JSON.stringify(plain),
    });
    return {
      secrets: [
        { label: "nextly_meta setup token", value: token },
        { label: "nextly_meta digest key", value: digestKey },
      ],
      plain: [plain],
    };
  },
  "nextly_document_lock.claim_token": async (insert, userId) => {
    const value = seed();
    const plain = seed();
    await insert("nextly_document_lock", {
      id: randomUUID(),
      scope_kind: "collection",
      slug: plain,
      entry_id: "e1",
      owner_id: userId,
      claim_token: value,
      acquired_at: new Date(),
      expires_at: new Date(Date.now() + 60_000),
    });
    return {
      secrets: [{ label: "nextly_document_lock.claim_token", value }],
      plain: [plain],
    };
  },
  nextly_plugin_settings: async insert => {
    const value = seed();
    const plain = seed();
    await insert("nextly_plugin_settings", {
      owner: "fixture",
      key: "apiKey",
      value: JSON.stringify({ apiKey: value }),
      is_secret: true,
      updated_at: new Date(),
    });
    await insert("nextly_plugin_settings", {
      owner: "fixture",
      key: "theme",
      value: JSON.stringify({ theme: plain }),
      is_secret: false,
      updated_at: new Date(),
    });
    return {
      secrets: [{ label: "nextly_plugin_settings", value }],
      plain: [plain],
    };
  },
  nextly_one_time_secrets: async insert => {
    const value = seed();
    await insert("nextly_one_time_secrets", {
      id: randomUUID(),
      owner: "fixture",
      purpose: "magic-link",
      subject: "a@example.test",
      subject_key: "a",
      kind: "link",
      secret_hash: value,
      expires_at: new Date(Date.now() + 60_000),
      created_at: new Date(),
    });
    return {
      secrets: [{ label: "nextly_one_time_secrets", value }],
      plain: [],
    };
  },
  "nextly_received_webhooks.claim_token": async insert => {
    const value = seed();
    const plain = seed();
    await insert("nextly_received_webhooks", {
      delivery_key: randomUUID(),
      owner: "fixture",
      provider: "stripe",
      delivery_id: plain,
      freshness: "fresh",
      status: "pending",
      claim_token: value,
      received_at: new Date(),
      prune_at: new Date(Date.now() + 60_000),
    });
    return {
      secrets: [{ label: "nextly_received_webhooks.claim_token", value }],
      plain: [plain],
    };
  },
  "email_providers.configuration": async insert => {
    const value = seed();
    const plain = seed();
    await insert("email_providers", {
      id: randomUUID(),
      name: plain,
      type: "resend",
      from_email: "noreply@example.test",
      configuration: { apiKey: value },
    });
    return {
      secrets: [{ label: "email_providers.configuration", value }],
      plain: [plain],
    };
  },
  "email_queue.message": async insert => {
    const value = seed();
    const plain = seed();
    await insert("email_queue", {
      id: randomUUID(),
      scope: "site",
      state: "pending",
      message: value,
      template_slug: plain,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    return {
      secrets: [{ label: "email_queue.message", value }],
      plain: [plain],
    };
  },
};

// The webhook's three secret columns share one row, so one seeder answers
// for all three places.
const WEBHOOK_PLACES = [
  "nextly_webhooks.secret_hash",
  "nextly_webhooks.secret_prefix",
  "nextly_webhooks.headers",
] as const;
async function seedWebhook(insert: Insert): Promise<Seeded> {
  const signing = seed();
  const prefix = seed();
  const header = seed();
  const plain = seed();
  await insert("nextly_webhooks", {
    id: randomUUID(),
    name: plain,
    url: "https://example.test/hook",
    event_types: ["entry.published"],
    headers: { authorization: `Bearer ${header}` },
    secret_hash: [
      {
        ciphertext: signing,
        prefix,
        createdAt: new Date().toISOString(),
        expiresAt: null,
      },
    ],
    secret_prefix: prefix,
  });
  return {
    secrets: [
      { label: "nextly_webhooks.secret_hash", value: signing },
      { label: "nextly_webhooks.secret_prefix", value: prefix },
      { label: "nextly_webhooks.headers", value: header },
    ],
    plain: [plain],
  };
}

/** Every place the list declares a secret, in the keys the seeders use. */
function declaredPlaces(): string[] {
  return Object.entries(CORE_SECRET_ANSWERS).flatMap(([table, answer]) => {
    switch (answer.holds) {
      case "nothing":
        return [];
      case "every-row":
      case "some-rows":
        return [table];
      case "columns":
        return answer.columns.map(column => `${table}.${column.name}`);
    }
  });
}

/** Seed every declared place, and return what was written. */
async function seedEverything(fresh: FreshDatabase): Promise<Seeded> {
  const tables = tablesByName(fresh);
  const db = fresh.db as Db;
  const insert: Insert = async (name, row) => {
    const table = tables.get(name);
    if (!table) throw new Error(`no table object for ${name}`);
    await db.insert(table).values(byProperty(table, row));
  };
  const userId = randomUUID();
  // The user first: the token, key and lock rows point at it.
  const all: Seeded[] = [await SEEDERS["users.password_hash"](insert, userId)];
  for (const [place, seeder] of Object.entries(SEEDERS)) {
    if (place !== "users.password_hash") all.push(await seeder(insert, userId));
  }
  all.push(await seedWebhook(insert));
  return {
    secrets: all.flatMap(each => each.secrets),
    plain: all.flatMap(each => each.plain),
  };
}

/** Every core table's rows, keyed by column name, one output part per table. */
async function dumpCoreTables(
  fresh: FreshDatabase,
  transform: (table: string, rows: Array<Record<string, unknown>>) => unknown[]
): Promise<OutputPart[]> {
  const tables = tablesByName(fresh);
  const db = fresh.db as Db;
  const parts: OutputPart[] = [];
  for (const { name } of getCoreSchema(fresh.dialect).tables) {
    const table = tables.get(name);
    if (!table) throw new Error(`no table object for core table ${name}`);
    const rows = (await db.select().from(table)).map(row =>
      byColumnName(table, row)
    );
    parts.push({
      where: `${name}.json`,
      content: JSON.stringify(transform(name, rows)),
    });
  }
  return parts;
}

/** The labels of the seeds a scan found, once each, sorted. */
function labelsFound(parts: OutputPart[], seeds: SeededSecret[]): string[] {
  return [...new Set(findSeededSecrets(parts, seeds).map(s => s.label))].sort();
}

describe("the secret guard over every core table", () => {
  it("has a seeder for every place the list declares a secret", () => {
    expect([...Object.keys(SEEDERS), ...WEBHOOK_PLACES].sort()).toEqual(
      declaredPlaces().sort()
    );
  });

  it.each(availableDialects())(
    "%s: leaves no seeded secret in the guarded rows",
    async dialect => {
      await withFreshDatabase(dialect, "nextly_secret_guard", async fresh => {
        await buildCurrentCoreSchema(fresh);
        const seeded = await seedEverything(fresh);
        const everyLabel = [
          ...new Set(seeded.secrets.map(s => s.label)),
        ].sort();

        // The control: unguarded, every seeded secret is there to be found.
        const unguarded = await dumpCoreTables(fresh, (_table, rows) => rows);
        expect(labelsFound(unguarded, seeded.secrets)).toEqual(everyLabel);

        const guard = createSecretGuard({ dialect });
        const guarded = await dumpCoreTables(fresh, (table, rows) =>
          guard.rows(table, rows)
        );
        expect(findSeededSecrets(guarded, seeded.secrets)).toEqual([]);

        // And the rest of each row still leaves.
        const text = guarded.map(part => String(part.content)).join("\n");
        expect(seeded.plain.filter(value => !text.includes(value))).toEqual([]);

        // Asked for sign-in data, the guard keeps the password hash and
        // nothing else that is secret.
        const withSignIn = createSecretGuard({
          dialect,
          includeSignInData: true,
        });
        const signIn = await dumpCoreTables(fresh, (table, rows) =>
          withSignIn.rows(table, rows)
        );
        expect(labelsFound(signIn, seeded.secrets)).toEqual([
          "users.password_hash",
        ]);
      });
    },
    60_000
  );
});
