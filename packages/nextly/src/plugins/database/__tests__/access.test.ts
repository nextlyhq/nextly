/**
 * The access boundary.
 *
 * This is the test that matters most in A9: without it a plugin reads and
 * writes any table in the database, and nothing anywhere reports it.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { SchemaOwner } from "../../../domains/schema/extension/types";
import { assertTableAccess } from "../access";

const OWNERS = new Map<string, SchemaOwner>([
  ["auth__identities", { kind: "plugin", id: "auth" }],
  ["billing__invoices", { kind: "plugin", id: "billing" }],
  ["app_notes", { kind: "app" }],
]);

function reason(run: () => void): string {
  try {
    run();
  } catch (error) {
    if (error instanceof NextlyError) {
      return String(
        (error.logContext as { reason?: unknown } | undefined)?.reason ?? ""
      );
    }
    throw error;
  }
  throw new Error("expected the access check to refuse, and it allowed");
}

describe("a plugin", () => {
  const auth = {
    owner: { kind: "plugin", id: "auth" } as SchemaOwner,
    dependsOn: new Set(["billing"]),
    owners: OWNERS,
  };

  it("reaches its own table", () => {
    expect(() => assertTableAccess("auth__identities", auth)).not.toThrow();
  });

  it("reaches a declared dependency's table", () => {
    // Legitimate because the dependency is DECLARED: the resolver ordered
    // them and can refuse an incompatible version.
    expect(() => assertTableAccess("billing__invoices", auth)).not.toThrow();
  });

  it("is refused a plugin it did not declare", () => {
    const stranger = { ...auth, dependsOn: new Set<string>() };
    expect(reason(() => assertTableAccess("billing__invoices", stranger))).toBe(
      "table-owner-not-a-declared-dependency"
    );
  });

  it("is refused an app table", () => {
    expect(reason(() => assertTableAccess("app_notes", auth))).toBe(
      "table-not-reachable"
    );
  });

  it("is refused a core table, which has no declaration at all", () => {
    // Core stays behind ctx.services, where access control, validation and
    // hooks apply — reaching `users` directly bypasses all three.
    expect(reason(() => assertTableAccess("users", auth))).toBe(
      "table-not-declared"
    );
  });
});

describe("the app", () => {
  const app = {
    owner: { kind: "app" } as SchemaOwner,
    dependsOn: new Set<string>(),
    owners: OWNERS,
  };

  it("reaches its own table", () => {
    expect(() => assertTableAccess("app_notes", app)).not.toThrow();
  });

  it("is refused a plugin's table", () => {
    // That table belongs to the plugin's migrations; an app writing to it
    // would make those migrations describe a shape nobody maintains.
    expect(reason(() => assertTableAccess("auth__identities", app))).toBe(
      "table-owned-by-plugin"
    );
  });
});
