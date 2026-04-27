import { describe, it, expect } from "vitest";

import { DbError, type DbErrorKind } from "../database/errors";

import { NextlyError } from "./nextly-error";

function makeDbError(
  kind: DbErrorKind,
  extras: {
    constraint?: string;
    meta?: Record<string, unknown>;
    cause?: unknown;
  } = {}
): DbError {
  return new DbError({
    message: `simulated ${kind}`,
    kind,
    dialect: "postgresql",
    code: extras.constraint,
    meta: extras.meta,
    cause: extras.cause ?? new Error("driver"),
  });
}

describe("NextlyError.fromDatabaseError", () => {
  describe("DbError mapping table", () => {
    it("maps unique-violation to DUPLICATE 409", () => {
      const dbErr = makeDbError("unique-violation", {
        constraint: "users_email_key",
      });
      const err = NextlyError.fromDatabaseError(dbErr);
      expect(err.code).toBe("DUPLICATE");
      expect(err.statusCode).toBe(409);
      expect(err.publicMessage).toBe("Resource already exists.");
    });

    it("maps fk-violation to VALIDATION_ERROR 400", () => {
      const err = NextlyError.fromDatabaseError(makeDbError("fk-violation"));
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.statusCode).toBe(400);
      expect(err.publicMessage).toBe("Referenced record does not exist.");
    });

    it("maps not-null-violation to VALIDATION_ERROR 400 with required-field message", () => {
      const err = NextlyError.fromDatabaseError(
        makeDbError("not-null-violation")
      );
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.statusCode).toBe(400);
      expect(err.publicMessage).toBe("A required field is missing.");
    });

    it("maps generic constraint to VALIDATION_ERROR 400 with generic message", () => {
      const err = NextlyError.fromDatabaseError(makeDbError("constraint"));
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.statusCode).toBe(400);
      expect(err.publicMessage).toBe(
        "The provided data violates a constraint."
      );
    });

    it("maps deadlock to CONFLICT 409 with retry message", () => {
      const err = NextlyError.fromDatabaseError(makeDbError("deadlock"));
      expect(err.code).toBe("CONFLICT");
      expect(err.statusCode).toBe(409);
      expect(err.publicMessage).toBe(
        "The operation could not be completed. Please retry."
      );
    });

    it("maps serialization-failure to CONFLICT 409 with retry message", () => {
      const err = NextlyError.fromDatabaseError(
        makeDbError("serialization-failure")
      );
      expect(err.code).toBe("CONFLICT");
      expect(err.statusCode).toBe(409);
      expect(err.publicMessage).toBe(
        "The operation could not be completed. Please retry."
      );
    });

    it("maps timeout to DATABASE_ERROR 500", () => {
      const err = NextlyError.fromDatabaseError(makeDbError("timeout"));
      expect(err.code).toBe("DATABASE_ERROR");
      expect(err.statusCode).toBe(500);
      expect(err.publicMessage).toBe(
        "The operation timed out. Please try again."
      );
    });

    it("maps connection-lost to DATABASE_ERROR 500", () => {
      const err = NextlyError.fromDatabaseError(makeDbError("connection-lost"));
      expect(err.code).toBe("DATABASE_ERROR");
      expect(err.statusCode).toBe(500);
      expect(err.publicMessage).toBe(
        "A temporary database error occurred. Please try again."
      );
    });

    it("maps syntax to INTERNAL_ERROR 500 with generic message", () => {
      const err = NextlyError.fromDatabaseError(makeDbError("syntax"));
      expect(err.code).toBe("INTERNAL_ERROR");
      expect(err.statusCode).toBe(500);
      expect(err.publicMessage).toBe("An unexpected error occurred.");
    });

    it("maps internal to INTERNAL_ERROR 500", () => {
      const err = NextlyError.fromDatabaseError(makeDbError("internal"));
      expect(err.code).toBe("INTERNAL_ERROR");
      expect(err.statusCode).toBe(500);
      expect(err.publicMessage).toBe("An unexpected error occurred.");
    });
  });

  describe("cause and logContext", () => {
    it("preserves the DbError as cause", () => {
      const dbErr = makeDbError("unique-violation");
      const err = NextlyError.fromDatabaseError(dbErr);
      expect(err.cause).toBe(dbErr);
    });

    it("copies dbKind, constraint, dialect, and meta into logContext", () => {
      const dbErr = makeDbError("unique-violation", {
        constraint: "users_email_key",
        meta: { table: "users" },
      });
      const err = NextlyError.fromDatabaseError(dbErr);
      expect(err.logContext).toMatchObject({
        dbKind: "unique-violation",
        dialect: "postgresql",
      });
      // constraint and meta should be present (constraint is sent via DbError.code per the existing class).
      expect(err.logContext?.meta).toEqual({ table: "users" });
    });

    it("never leaks DB constraint name into publicMessage", () => {
      const err = NextlyError.fromDatabaseError(
        makeDbError("unique-violation", {
          constraint: "secret_constraint_name",
        })
      );
      expect(err.publicMessage).not.toContain("secret_constraint_name");
    });

    it("never leaks the original DB driver message into publicMessage", () => {
      const dbErr = new DbError({
        message:
          'duplicate key value violates unique constraint "users_email_key"',
        kind: "unique-violation",
        dialect: "postgresql",
        cause: new Error("driver"),
      });
      const err = NextlyError.fromDatabaseError(dbErr);
      expect(err.publicMessage).toBe("Resource already exists.");
      expect(err.publicMessage).not.toContain("users_email_key");
      expect(err.publicMessage).not.toContain("violates unique constraint");
    });
  });

  describe("non-DbError fallback", () => {
    it("wraps a plain Error as INTERNAL_ERROR with cause", () => {
      const plain = new Error("not a DbError");
      const err = NextlyError.fromDatabaseError(plain);
      expect(err.code).toBe("INTERNAL_ERROR");
      expect(err.statusCode).toBe(500);
      expect(err.publicMessage).toBe("An unexpected error occurred.");
      expect(err.cause).toBe(plain);
    });

    it("wraps a non-Error value as INTERNAL_ERROR", () => {
      const err = NextlyError.fromDatabaseError("just a string");
      expect(err.code).toBe("INTERNAL_ERROR");
      expect(err.statusCode).toBe(500);
      expect(err.publicMessage).toBe("An unexpected error occurred.");
    });
  });

  describe("public-vs-log layering", () => {
    it("toResponseJSON omits all DB context", () => {
      const err = NextlyError.fromDatabaseError(
        makeDbError("unique-violation", { constraint: "users_email_key" })
      );
      const json = err.toResponseJSON("req_test");
      expect(json).toEqual({
        code: "DUPLICATE",
        message: "Resource already exists.",
        requestId: "req_test",
      });
      expect(json).not.toHaveProperty("data");
      expect(json).not.toHaveProperty("logContext");
      expect(json).not.toHaveProperty("cause");
    });
  });
});
