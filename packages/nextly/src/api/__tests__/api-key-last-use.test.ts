/**
 * A key's last use is written before the request it records is answered, at
 * most once a minute per key, and a failed write never refuses the key.
 *
 * Before the request is answered, because a serverless runtime may freeze or
 * end the invocation once the response is out, and a write still pending
 * then is lost. Once a minute, so a busy key does not cost a write on every
 * request. The write is held open here to observe the order.
 */
import { randomUUID } from "crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestDb,
  testLogger,
  type TestDb,
} from "../../__tests__/fixtures/db";
import {
  ApiKeyService,
  generateApiKey,
} from "../../domains/auth/services/api-key-service";

// The creator's standing is not what these tests are about.
vi.mock("../../auth/session/session-standing", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../auth/session/session-standing")
  >()),
  accountIsActive: async () => true,
}));

/**
 * The test database, with every `update` held until `release` and counted,
 * and failing instead when `failing` is set.
 */
function heldUpdates(db: TestDb["db"]) {
  let release: () => void = () => {};
  let gate = new Promise<void>(resolve => (release = resolve));
  const state = { updates: 0, failing: false };
  const proxy = new Proxy(db, {
    get(target, property) {
      if (property === "update") {
        return (table: Parameters<typeof db.update>[0]) => ({
          set: (values: Record<string, unknown>) => ({
            where: async (condition: Parameters<typeof eq>[0]) => {
              state.updates += 1;
              await gate;
              if (state.failing) throw new Error("write failed");
              return target
                .update(table)
                .set(values)
                .where(condition as never);
            },
          }),
        });
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    db: proxy,
    state,
    release: () => release(),
    reopen: () => {
      gate = new Promise<void>(resolve => (release = resolve));
    },
  };
}

describe("ApiKeyService records a key's last use", () => {
  let testDb: TestDb;
  let held: ReturnType<typeof heldUpdates>;
  let service: ApiKeyService;
  let key: string;
  let keyId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    held = heldUpdates(testDb.db);
    // The real adapter, its transactions included, handing out the held
    // database: a copy spread from it would drop its methods.
    const adapter = new Proxy(testDb.adapter, {
      get(target, property) {
        if (property === "getDrizzle") return () => held.db;
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    service = new ApiKeyService(adapter, testLogger);
    const userId = randomUUID();
    await testDb.db.insert(testDb.schema.users).values({
      id: userId,
      email: `owner-${userId}@example.com`,
      isActive: true,
    });
    const generated = generateApiKey();
    keyId = randomUUID();
    await testDb.db.insert(testDb.schema.apiKeys).values({
      id: keyId,
      name: "used",
      keyHash: generated.keyHash,
      keyPrefix: generated.keyPrefix,
      tokenType: "read-only",
      userId,
      expiresAt: null,
    });
    key = generated.fullKey;
  });

  afterEach(async () => {
    held.release();
    await testDb.reset();
    await testDb.close();
  });

  async function lastUsedAt(): Promise<unknown> {
    const rows = await testDb.db
      .select({ lastUsedAt: testDb.schema.apiKeys.lastUsedAt })
      .from(testDb.schema.apiKeys)
      .where(eq(testDb.schema.apiKeys.id, keyId));
    return rows[0]?.lastUsedAt ?? null;
  }

  it("answers only once the write has been made", async () => {
    let answered = false;
    const auth = service.authenticateApiKey(key).then(result => {
      answered = true;
      return result;
    });
    await vi.waitFor(() => expect(held.state.updates).toBe(1));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(answered).toBe(false);

    held.release();
    expect(await auth).not.toBeNull();
    expect(await lastUsedAt()).not.toBeNull();
  });

  it("writes again only once a minute has passed", async () => {
    held.release();
    await service.authenticateApiKey(key);
    await service.authenticateApiKey(key);
    expect(held.state.updates).toBe(1);

    await testDb.db
      .update(testDb.schema.apiKeys)
      .set({ lastUsedAt: new Date(Date.now() - 61_000) })
      .where(eq(testDb.schema.apiKeys.id, keyId));
    await service.authenticateApiKey(key);
    expect(held.state.updates).toBe(2);
  });

  it("never moves the last use back to an older request's time", async () => {
    // Two requests with one key at once: the older one's write is held while
    // the newer one's lands, and must not replace it when it is let go.
    const auth = service.authenticateApiKey(key);
    await vi.waitFor(() => expect(held.state.updates).toBe(1));
    const newer = new Date(Date.now() + 5_000);
    await testDb.db
      .update(testDb.schema.apiKeys)
      .set({ lastUsedAt: newer })
      .where(eq(testDb.schema.apiKeys.id, keyId));

    held.release();
    await auth;

    const recorded = await lastUsedAt();
    expect(
      recorded instanceof Date ? recorded.getTime() : Number(recorded)
    ).toBeGreaterThanOrEqual(Math.floor(newer.getTime() / 1000) * 1000);
  });

  it("writes nothing when another request recorded a use within the minute", async () => {
    // Requests arriving together all read the old record and pass the early
    // check; the write's own condition keeps all but the first from writing.
    const auth = service.authenticateApiKey(key);
    await vi.waitFor(() => expect(held.state.updates).toBe(1));
    const recent = new Date(Date.now() - 30_000);
    await testDb.db
      .update(testDb.schema.apiKeys)
      .set({ lastUsedAt: recent })
      .where(eq(testDb.schema.apiKeys.id, keyId));

    held.release();
    await auth;

    const recorded = await lastUsedAt();
    expect(
      recorded instanceof Date ? recorded.getTime() : Number(recorded)
    ).toBe(Math.floor(recent.getTime() / 1000) * 1000);
  });

  it("admits the key when the write fails", async () => {
    held.state.failing = true;
    held.release();

    expect(await service.authenticateApiKey(key)).not.toBeNull();
  });
});

describe("ApiKeyService records a key's last use on SQLite's one connection", () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(async () => {
    await testDb.reset();
    await testDb.close();
  });

  it("keeps the record when another request's open transaction rolls back", async () => {
    // Every request shares the one connection, so a write issued while
    // another request's transaction is open would run inside it and be
    // undone by its rollback.
    const service = new ApiKeyService(testDb.adapter, testLogger);
    const userId = randomUUID();
    await testDb.db.insert(testDb.schema.users).values({
      id: userId,
      email: `owner-${userId}@example.com`,
      isActive: true,
    });
    const { key } = await service.createApiKey(userId, {
      name: "used",
      tokenType: "read-only",
      expiresIn: "unlimited",
    });

    let finish: () => void = () => {};
    const finishing = new Promise<void>(resolve => (finish = resolve));
    let opened: () => void = () => {};
    const open = new Promise<void>(resolve => (opened = resolve));
    const other = testDb.adapter
      .transaction(async () => {
        opened();
        await finishing;
        throw new Error("the other request rolls back");
      })
      .catch(() => undefined);
    await open;

    const auth = service.authenticateApiKey(key);
    await new Promise(resolve => setTimeout(resolve, 20));
    finish();
    await other;
    expect(await auth).not.toBeNull();

    const rows = await testDb.db
      .select({ lastUsedAt: testDb.schema.apiKeys.lastUsedAt })
      .from(testDb.schema.apiKeys);
    expect(rows[0]?.lastUsedAt).not.toBeNull();
  });
});
