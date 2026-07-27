/**
 * `createErrorFromResult` rebuilds a NextlyError from a failed legacy service
 * envelope for Direct API callers. When the envelope carries the originating
 * NextlyError `code`, that code must win over the status-derived fallback:
 * status 409 alone cannot distinguish a duplicate from an optimistic-
 * concurrency conflict, and `statusCodeToErrorCode` can only guess CONFLICT.
 */
import { describe, it, expect } from "vitest";

import { createErrorFromResult } from "../namespaces/helpers";

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
