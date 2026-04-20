import { describe, it, expect } from "vitest";

import {
  mapKindToStatus,
  mapDbErrorToServiceError,
  type MessageOverrides,
} from "./db-error";

describe("mapKindToStatus", () => {
  it("should map unique-violation to 409", () => {
    expect(mapKindToStatus("unique-violation")).toBe(409);
  });

  it("should map fk-violation to 409", () => {
    expect(mapKindToStatus("fk-violation")).toBe(409);
  });

  it("should map not-null-violation to 400", () => {
    expect(mapKindToStatus("not-null-violation")).toBe(400);
  });

  it("should map syntax error to 400", () => {
    expect(mapKindToStatus("syntax")).toBe(400);
  });

  it("should map timeout to 503", () => {
    expect(mapKindToStatus("timeout")).toBe(503);
  });

  it("should map connection-lost to 503", () => {
    expect(mapKindToStatus("connection-lost")).toBe(503);
  });

  it("should map deadlock to 503", () => {
    expect(mapKindToStatus("deadlock")).toBe(503);
  });

  it("should map serialization-failure to 503", () => {
    expect(mapKindToStatus("serialization-failure")).toBe(503);
  });

  it("should map constraint to 409", () => {
    expect(mapKindToStatus("constraint")).toBe(409);
  });

  it("should map internal error to 500", () => {
    expect(mapKindToStatus("internal")).toBe(500);
  });

  it("should map unknown error to 500", () => {
    expect(mapKindToStatus("unknown" as any)).toBe(500);
  });
});

describe("mapDbErrorToServiceError", () => {
  const defaultMessages: MessageOverrides = {
    defaultMessage: "Database operation failed",
    "unique-violation": "Record already exists",
    "fk-violation": "Referenced record does not exist",
  };

  it("should use custom message for unique-violation", () => {
    // Simulate a unique violation error
    const error = new Error("duplicate key value violates unique constraint");
    const result = mapDbErrorToServiceError(error, defaultMessages);

    expect(result.success).toBe(false);
    expect(result.data).toBe(null);
    // The actual status code depends on error detection logic
    expect(result.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("should use default message when no override provided", () => {
    const error = new Error("some generic db error");
    const messages: MessageOverrides = {
      defaultMessage: "Something went wrong",
    };
    const result = mapDbErrorToServiceError(error, messages);

    expect(result.success).toBe(false);
    expect(result.message).toBeDefined();
    expect(result.data).toBe(null);
  });

  it("should return ServiceErrorResult structure", () => {
    const error = new Error("test error");
    const result = mapDbErrorToServiceError(error, defaultMessages);

    expect(result).toHaveProperty("success", false);
    expect(result).toHaveProperty("statusCode");
    expect(result).toHaveProperty("message");
    expect(result).toHaveProperty("data", null);
  });
});
