/**
 * The Direct API's collection and Single gates answer a refused access check
 * with the refusal's own code and status.
 *
 * Both gates catch what `checkAccess` throws and deny, as they must. They used
 * to deny with a fixed 500 whatever was thrown, so a check that could not read
 * the caller's roles because the database was busy reached the caller as an
 * internal error rather than as the retryable DATABASE_BUSY it is. A refusal
 * that is not a NextlyError still denies with the gate's own 500.
 */
import { poolWaitTimeoutError } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { errorFromServiceEnvelope } from "../../../errors/from-service-envelope";
import {
  DATABASE_BUSY_RETRY_AFTER_SECONDS,
  retryAfterSeconds,
} from "../../../errors/retry-after";
import {
  createMockAdapter,
  createMockDb,
  silentLogger,
} from "../../collections/__tests__/collection-test-helpers";
import { CollectionAccessService } from "../../collections/services/collection-access-service";
import { checkSingleAccess } from "../../singles/services/single-query-service";

/** An RBAC service whose check refuses with `refusal`. */
function refusingRbac(refusal: unknown) {
  return {
    checkAccess: vi.fn().mockRejectedValue(refusal),
    checkAnonymousCodeAccess: vi.fn().mockResolvedValue(undefined),
    getRegisteredAccess: vi.fn().mockReturnValue(undefined),
    getRegisteredTarget: () => undefined,
  };
}

const user = { id: "user-1", roles: ["editor"] };

async function collectionGate(refusal: unknown) {
  const service = new CollectionAccessService(
    createMockAdapter(createMockDb({ rows: [] })) as never,
    silentLogger as never,
    refusingRbac(refusal) as never
  );
  return service.checkCollectionAccess({
    collectionName: "posts",
    operation: "read",
    user,
    overrideAccess: false,
  });
}

async function singleGate(refusal: unknown) {
  return checkSingleAccess({
    slug: "site",
    operation: "read",
    user,
    overrideAccess: false,
    rbacAccessControlService: refusingRbac(refusal) as never,
    logger: silentLogger as never,
  });
}

const GATES = [
  { name: "the collection gate", gate: collectionGate },
  { name: "the Single gate", gate: singleGate },
];

describe.each(GATES)("$name, refused by its access check", ({ gate }) => {
  it("keeps DATABASE_BUSY and its retry hint for a busy database", async () => {
    const result = await gate(NextlyError.databaseBusy());

    expect(result).toMatchObject({
      success: false,
      statusCode: 503,
      code: "DATABASE_BUSY",
      publicData: { retryAfterSeconds: DATABASE_BUSY_RETRY_AFTER_SECONDS },
    });
  });

  it("answers DATABASE_BUSY for a raw pool-wait timeout, through the boundary too", async () => {
    // The error the adapters raise, unconverted: what a role or permission
    // read throws when it waits out its bound for a connection.
    const result = await gate(poolWaitTimeoutError(15000));

    expect(result).toMatchObject({
      success: false,
      statusCode: 503,
      code: "DATABASE_BUSY",
      publicData: { retryAfterSeconds: DATABASE_BUSY_RETRY_AFTER_SECONDS },
    });
    // What the REST and Direct API boundaries rebuild from the gate result.
    const rebuilt = errorFromServiceEnvelope(result as never);
    expect(rebuilt.code).toBe("DATABASE_BUSY");
    expect(retryAfterSeconds(rebuilt)).toBe(DATABASE_BUSY_RETRY_AFTER_SECONDS);
  });

  it("keeps an internal refusal a 500", async () => {
    const result = await gate(NextlyError.internal());

    expect(result).toMatchObject({
      success: false,
      statusCode: 500,
      code: "INTERNAL_ERROR",
    });
  });

  it("denies a raw failure with its own 500", async () => {
    const result = await gate(new Error("connection reset"));

    expect(result).toMatchObject({ success: false, statusCode: 500 });
    expect(result).not.toHaveProperty("code");
  });
});
