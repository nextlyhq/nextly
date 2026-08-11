/**
 * `createErrorFromResult` rebuilds a NextlyError from a failed legacy service
 * envelope for Direct API callers. When the envelope carries the originating
 * NextlyError `code`, that code must win over the status-derived fallback:
 * status 409 alone cannot distinguish a duplicate from an optimistic-
 * concurrency conflict, and `statusCodeToErrorCode` can only guess CONFLICT.
 */
import { describe, it, expect } from "vitest";

import { createErrorFromResult, directApiActor } from "../namespaces/helpers";

describe("createErrorFromResult", () => {
  it("prefers the envelope's code over the status-derived fallback", () => {
    const err = createErrorFromResult({
      success: false,
      statusCode: 409,
      code: "DUPLICATE",
      message: "Resource already exists.",
      data: null,
    });

    expect(err.code).toBe("DUPLICATE");
    expect(err.statusCode).toBe(409);
    expect(err.publicMessage).toBe("Resource already exists.");
  });

  it("falls back to the status-derived code when the envelope has none", () => {
    const err = createErrorFromResult({
      success: false,
      statusCode: 409,
      message: "The resource has changed.",
      data: null,
    });

    expect(err.code).toBe("CONFLICT");
  });
});

describe("the acting identity a Direct API call carries", () => {
  it("records an API key AS a key, never as its owner", () => {
    // A key carries the owner's `user` so the operation can be authorized.
    // Reading that as the acting identity puts a person's name against a write
    // they did not make — worse than an absent entry, because it is a
    // plausible one.
    expect(
      directApiActor(
        {},
        {
          user: { id: "owner-1" } as never,
          actor: { actorType: "apiKey", permissions: [] },
        }
      )
    ).toEqual({ type: "apiKey" });
  });

  it("names the user for an ordinary session call", () => {
    // The control: the case this helper exists for must still be attributed.
    expect(directApiActor({}, { user: { id: "user-1" } as never })).toEqual({
      type: "user",
      id: "user-1",
    });
  });

  it("records nobody when the call names nobody", () => {
    expect(directApiActor({}, {})).toBeUndefined();
  });

  it("takes the per-operation actor over the instance default", () => {
    // `mergeConfig` semantics: one call can act as a key without the instance
    // being reconfigured.
    expect(
      directApiActor(
        { user: { id: "owner-1" } as never },
        { actor: { actorType: "apiKey", permissions: [] } }
      )
    ).toEqual({ type: "apiKey" });
  });
});
