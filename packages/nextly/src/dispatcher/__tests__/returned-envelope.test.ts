/**
 * A handler that RETURNS a failed service envelope, rather than throwing or
 * unwrapping it, is answered with the error the envelope reports.
 *
 * Observed through `ServiceDispatcher.dispatch` itself: only the adapter
 * lookup, the service container and one handler are stood in for, so the
 * normalization under test is the dispatcher's own.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../errors/nextly-error";

const returned = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("../helpers/di", () => ({ getAdapterFromDI: () => ({}) }));
vi.mock("../../services", () => ({
  ServiceContainer: class {
    readonly hasAdapter = true;
  },
}));
vi.mock("../handlers/user-dispatcher", () => ({
  dispatchUser: () => Promise.resolve(returned.value),
}));

const { ServiceDispatcher } = await import("../dispatcher");

async function dispatchReturning(envelope: unknown) {
  returned.value = envelope;
  return new ServiceDispatcher().dispatch({
    service: "users",
    operation: "update",
    method: "updateUser",
  });
}

describe("a handler's returned envelope", () => {
  beforeEach(() => {
    returned.value = undefined;
  });

  it("answers a returned 403 as FORBIDDEN, not as a server fault", async () => {
    const result = await dispatchReturning({
      success: false,
      statusCode: 403,
      message: "You can't edit this user.",
    });

    expect(result.success).toBe(false);
    expect(NextlyError.is(result.error)).toBe(true);
    expect(result.error).toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });
  });

  it("keeps a returned envelope's own code and status", async () => {
    const result = await dispatchReturning({
      success: false,
      statusCode: 503,
      code: "DATABASE_BUSY",
      message: "The database is busy.",
    });

    expect(result.error).toMatchObject({
      code: "DATABASE_BUSY",
      statusCode: 503,
    });
  });

  it("answers a failure that carries no message with its status", async () => {
    // Without a message the envelope used to carry no error at all, and the
    // route answered it as an unexplained 500.
    const result = await dispatchReturning({ success: false, statusCode: 404 });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("passes a successful envelope through with no error", async () => {
    const result = await dispatchReturning({
      success: true,
      statusCode: 200,
      data: { id: "u1" },
    });

    expect(result).toMatchObject({ success: true, data: { id: "u1" } });
    expect(result.error).toBeUndefined();
  });
});
