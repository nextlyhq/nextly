import { describe, expect, it } from "vitest";

import { NextlyError } from "../errors/nextly-error";

import {
  isPermissionCollision,
  permissionCollisionError,
} from "./permission-error";

describe("permissionCollisionError", () => {
  it("is a 409 NextlyError carrying reason + owners in logContext", () => {
    const err = permissionCollisionError(
      "export",
      "submissions",
      ["@acme/a", "@acme/b"],
      "duplicate-permission"
    );
    expect(err).toBeInstanceOf(NextlyError);
    expect(err.code).toBe("NEXTLY_PERMISSION_COLLISION");
    expect(err.statusCode).toBe(409);
    expect(err.logContext).toMatchObject({
      reason: "duplicate-permission",
      action: "export",
      resource: "submissions",
      owners: ["@acme/a", "@acme/b"],
    });
  });

  it("carries the system-resource-reserved reason", () => {
    const err = permissionCollisionError(
      "export",
      "users",
      ["@acme/a"],
      "system-resource-reserved"
    );
    expect(err.logContext).toMatchObject({
      reason: "system-resource-reserved",
    });
  });
});

describe("isPermissionCollision", () => {
  it("recognises the collision the boot path must not swallow", () => {
    const err = permissionCollisionError(
      "delete",
      "reports",
      ["@acme/a"],
      "crud-permission-reserved"
    );
    expect(isPermissionCollision(err)).toBe(true);
  });

  it("does not claim an unrelated failure", () => {
    // The catch it guards exists for "the tables are not there yet", and those must stay
    // forgiven — a predicate that answered true for everything would fail boot on a fresh
    // database instead.
    expect(isPermissionCollision(new Error("no such table: permissions"))).toBe(
      false
    );
    expect(isPermissionCollision(undefined)).toBe(false);
  });
});
