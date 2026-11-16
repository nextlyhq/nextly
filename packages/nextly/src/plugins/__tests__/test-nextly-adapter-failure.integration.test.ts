/**
 * `createTestNextly` on its default in-memory SQLite, when the adapter cannot
 * be created (the package or its native module missing): the boot fails, and
 * the environment it set up for the adapter, `DB_DIALECT` and a generated
 * `NEXTLY_SECRET`, is put back as it was, as after any other failed boot, so
 * the files that follow in the process do not read SQLite and a secret that
 * nobody set.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { _resetEnvCache } from "../../shared/lib/env";
import { createTestNextly } from "../test-nextly";

vi.mock("../../database/factory", async importOriginal => ({
  ...(await importOriginal<typeof import("../../database/factory")>()),
  createAdapter: async () => {
    throw new Error("Cannot find module 'better-sqlite3'");
  },
}));

let before: { secret?: string; dialect?: string };

// The setup file sets a secret for every suite; this one runs without it, on
// another dialect, so both changes the boot makes would show.
beforeEach(() => {
  before = {
    secret: process.env.NEXTLY_SECRET,
    dialect: process.env.DB_DIALECT,
  };
  delete process.env.NEXTLY_SECRET;
  process.env.DB_DIALECT = "postgresql";
  _resetEnvCache();
});

afterEach(() => {
  if (before.secret === undefined) delete process.env.NEXTLY_SECRET;
  else process.env.NEXTLY_SECRET = before.secret;
  if (before.dialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = before.dialect;
  _resetEnvCache();
});

it("puts the environment back when the default SQLite adapter cannot be created", async () => {
  await expect(createTestNextly()).rejects.toThrow(
    "Cannot find module 'better-sqlite3'"
  );
  expect(process.env.NEXTLY_SECRET).toBeUndefined();
  expect(process.env.DB_DIALECT).toBe("postgresql");
});
