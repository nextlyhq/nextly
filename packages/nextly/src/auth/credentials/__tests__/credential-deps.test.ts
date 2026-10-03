/**
 * The password sign-in's lookup lets a database failure through.
 *
 * Answered as `null`, a failed lookup reads as an unknown email, and
 * `verifyCredentials` reports an unknown email as a wrong password — so an
 * outage would reach the caller as `AUTH_INVALID_CREDENTIALS`.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it, vi } from "vitest";

import { passwordCredentialDeps } from "../credential-deps";

// A users table whose columns the query can name, so the failure below comes
// from the database and not from resolving a dialect.
vi.mock("../../../database/index", () => ({
  getDialectTables: () => ({
    users: { email: { name: "email" }, id: { name: "id" } },
  }),
}));

/** An adapter whose every query fails, as a connection-level fault does. */
function failingAdapter(failure: Error): DrizzleAdapter {
  const query = {
    select: () => query,
    from: () => query,
    where: () => query,
    limit: () => Promise.reject(failure),
  };
  return { getDrizzle: () => query } as unknown as DrizzleAdapter;
}

describe("passwordCredentialDeps", () => {
  it("rejects with the database's error rather than answering no user", async () => {
    const outage = new Error("connection refused");
    const deps = passwordCredentialDeps(() => failingAdapter(outage));

    await expect(deps.findUserByEmail("a@example.com")).rejects.toBe(outage);
  });
});
