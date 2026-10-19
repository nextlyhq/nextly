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
    service = new ApiKeyService(
      {
        ...testDb.adapter,
        getDrizzle: () => held.db,
        getCapabilities: () => testDb.adapter.getCapabilities(),
      } as unknown as ConstructorParameters<typeof ApiKeyService>[0],
      testLogger
    );
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

  it("admits the key when the write fails", async () => {
    held.state.failing = true;
    held.release();

    expect(await service.authenticateApiKey(key)).not.toBeNull();
  });
});
