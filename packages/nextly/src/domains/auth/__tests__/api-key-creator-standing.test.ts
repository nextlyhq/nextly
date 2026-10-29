/**
 * `authenticateApiKey` asks whether the key's creator is active, and admits
 * the key only on a yes.
 *
 * The answer comes from the account-standing cache, which is stubbed here so
 * each case can give it one: active, not active, or a read that fails. The
 * behaviour end to end, through the cache and the REST and Direct API doors,
 * is `../services/__tests__/api-key-creator-deactivated.integration.test.ts`.
 */
import { randomUUID } from "crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestDb,
  testLogger,
  type TestDb,
} from "../../../__tests__/fixtures/db";
import { ApiKeyService, generateApiKey } from "../services/api-key-service";

const accountIsActive = vi.hoisted(() =>
  vi.fn<(userId: string) => Promise<boolean>>()
);
vi.mock("../../../auth/session/session-standing", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../auth/session/session-standing")
  >()),
  accountIsActive,
}));

describe("ApiKeyService.authenticateApiKey and the key's creator", () => {
  let testDb: TestDb;
  let service: ApiKeyService;
  let creatorId: string;
  let key: string;
  let keyId: string;

  beforeEach(async () => {
    accountIsActive.mockReset();
    testDb = await createTestDb();
    service = new ApiKeyService(testDb.adapter, testLogger);

    creatorId = randomUUID();
    await testDb.db.insert(testDb.schema.users).values({
      id: creatorId,
      email: `creator-${creatorId}@example.com`,
      isActive: true,
    });
    const { fullKey, keyHash, keyPrefix } = generateApiKey();
    keyId = randomUUID();
    await testDb.db.insert(testDb.schema.apiKeys).values({
      id: keyId,
      name: "Creator's key",
      keyHash,
      keyPrefix,
      tokenType: "read-only",
      userId: creatorId,
      expiresAt: null,
    });
    key = fullKey;
  });

  afterEach(async () => {
    await testDb.reset();
    await testDb.close();
  });

  it("admits the key while its creator is active", async () => {
    accountIsActive.mockResolvedValue(true);

    // The whole answer: the key, its creator, and when its standing was
    // asked (a monotonic reading the scope compares later), unexpiring here.
    expect(await service.authenticateApiKey(key)).toEqual({
      id: keyId,
      userId: creatorId,
      tokenType: "read-only",
      roleId: null,
      expiresAt: null,
      standingAskedAt: expect.any(Number),
    });
    expect(accountIsActive).toHaveBeenCalledWith(creatorId);
  });

  it("refuses the key while its creator is not active", async () => {
    accountIsActive.mockResolvedValue(false);

    expect(await service.authenticateApiKey(key)).toBeNull();
    expect(accountIsActive).toHaveBeenCalledWith(creatorId);
  });

  it("refuses the key when the creator's standing cannot be read", async () => {
    // The read's error travels, as it does for a session, so the request
    // fails rather than the key being admitted on a question nobody answered.
    const unreadable = new Error("standing read failed");
    accountIsActive.mockRejectedValue(unreadable);

    await expect(service.authenticateApiKey(key)).rejects.toBe(unreadable);
  });

  it("does not ask about the creator of a key that is not found", async () => {
    accountIsActive.mockResolvedValue(true);

    expect(
      await service.authenticateApiKey(generateApiKey().fullKey)
    ).toBeNull();
    expect(accountIsActive).not.toHaveBeenCalled();
  });
});
