/**
 * Why `authenticateApiKey` refused a key, for the server's log.
 *
 * Every refused key returns `null`, so the caller is told the same thing
 * whichever check failed. The check itself is told to `onRefused`, so the
 * log can say an unknown key from a revoked one, an expired one, or one whose
 * creator is not active.
 */
import { randomUUID } from "crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestDb,
  testLogger,
  type TestDb,
} from "../../../__tests__/fixtures/db";
import {
  ApiKeyService,
  generateApiKey,
  type ApiKeyRefusalCause,
} from "../services/api-key-service";

const accountIsActive = vi.hoisted(() =>
  vi.fn<(userId: string) => Promise<boolean>>()
);
vi.mock("../../../auth/session/session-standing", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../auth/session/session-standing")
  >()),
  accountIsActive,
}));

describe("why ApiKeyService.authenticateApiKey refused a key", () => {
  let testDb: TestDb;
  let service: ApiKeyService;
  let creatorId: string;

  beforeEach(async () => {
    accountIsActive.mockReset();
    accountIsActive.mockResolvedValue(true);
    testDb = await createTestDb();
    service = new ApiKeyService(testDb.adapter, testLogger);
    creatorId = randomUUID();
    await testDb.db.insert(testDb.schema.users).values({
      id: creatorId,
      email: `creator-${creatorId}@example.com`,
      isActive: true,
    });
  });

  afterEach(async () => {
    await testDb.reset();
    await testDb.close();
  });

  /** A key of the creator's, stored with `columns`; its full key. */
  async function storedKey(columns: {
    isActive?: boolean;
    expiresAt?: Date | null;
  }): Promise<string> {
    const { fullKey, keyHash, keyPrefix } = generateApiKey();
    await testDb.db.insert(testDb.schema.apiKeys).values({
      id: randomUUID(),
      name: "A key",
      keyHash,
      keyPrefix,
      tokenType: "read-only",
      userId: creatorId,
      expiresAt: columns.expiresAt ?? null,
      ...(columns.isActive === undefined ? {} : { isActive: columns.isActive }),
    });
    return fullKey;
  }

  /** What authenticating `key` returned, and the cause it was told. */
  async function authenticate(key: string) {
    const causes: ApiKeyRefusalCause[] = [];
    const result = await service.authenticateApiKey(key, cause => {
      causes.push(cause);
    });
    return { result, causes };
  }

  it("tells a key this site never issued", async () => {
    await expect(authenticate(generateApiKey().fullKey)).resolves.toEqual({
      result: null,
      causes: ["unknown"],
    });
  });

  it("tells a revoked key from one never issued", async () => {
    const key = await storedKey({ isActive: false });
    await expect(authenticate(key)).resolves.toEqual({
      result: null,
      causes: ["revoked"],
    });
  });

  it("tells an expired key", async () => {
    const key = await storedKey({ expiresAt: new Date(Date.now() - 60_000) });
    await expect(authenticate(key)).resolves.toEqual({
      result: null,
      causes: ["expired"],
    });
  });

  it("tells a key whose creator is not active", async () => {
    accountIsActive.mockResolvedValue(false);
    const key = await storedKey({});
    await expect(authenticate(key)).resolves.toEqual({
      result: null,
      causes: ["creator-inactive"],
    });
  });

  it("tells nothing for a key it admits", async () => {
    const key = await storedKey({});
    const { result, causes } = await authenticate(key);
    expect(result).not.toBeNull();
    expect(causes).toEqual([]);
  });
});
