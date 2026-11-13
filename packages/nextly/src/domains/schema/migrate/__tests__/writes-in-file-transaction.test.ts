/**
 * Rows meant for a migration file's transaction are refused, before anything
 * is written, where the write would not join it: one that opened its own
 * could commit while the file rolls back.
 */
import { describe, expect, it } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { writesInFileTransaction } from "../registry-writer";

const adapter = (joins: boolean) =>
  ({ inTransaction: () => joins }) as unknown as DrizzleAdapter;

describe("writesInFileTransaction", () => {
  it("lets a write that joins the file's transaction through", () => {
    expect(() =>
      writesInFileTransaction({ adapter: adapter(true) }, "0002_x.sql")
    ).not.toThrow();
  });

  it("refuses a write that would open a transaction of its own", () => {
    expect(() =>
      writesInFileTransaction({ adapter: adapter(false) }, "0002_x.sql")
    ).toThrow();
  });
});
