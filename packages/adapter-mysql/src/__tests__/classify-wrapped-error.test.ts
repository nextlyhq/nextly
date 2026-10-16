/**
 * A MySQL error is classified by the driver's error number, wherever it sits.
 *
 * A query that runs through Drizzle fails with Drizzle's `DrizzleQueryError`,
 * whose message is the statement and which carries no `errno`; mysql2's own
 * error, the one that knows a duplicate key from anything else, is its
 * `cause`. Classified from the wrapper alone, a duplicate key read as
 * "unknown", and every caller that looks for a unique violation missed it on
 * MySQL alone. No database is needed: these are the shapes the driver and
 * Drizzle produce.
 */
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";

import { createMySqlAdapter } from "../index";

/** What mysql2 throws for a duplicate key. */
function duplicateKey(): Error {
  return Object.assign(new Error("Duplicate entry 'a' for key 'slug'"), {
    errno: 1062,
    code: "ER_DUP_ENTRY",
    sqlState: "23000",
  });
}

/** The adapter's classifier, which subclasses keep protected. */
function classify(error: unknown): { kind: string; code?: string } {
  const adapter = createMySqlAdapter({ url: "mysql://localhost:3306/test" });
  return (
    adapter as unknown as {
      classifyError(error: unknown): { kind: string; code?: string };
    }
  ).classifyError(error);
}

describe("MySQL error classification", () => {
  it("classifies the driver's duplicate key as a unique violation", () => {
    // The control: the unwrapped error, which classified correctly before.
    expect(classify(duplicateKey()).kind).toBe("unique_violation");
  });

  it("classifies a duplicate key that Drizzle wrapped as a unique violation", () => {
    const wrapped = new DrizzleQueryError(
      "insert into `posts` (`id`, `slug`) values (?, ?)",
      ["1", "a"],
      duplicateKey()
    );

    const classified = classify(wrapped);

    expect(classified.kind).toBe("unique_violation");
    expect(classified.code).toBe("ER_DUP_ENTRY");
  });

  it("leaves an error with no driver error anywhere in it unknown", () => {
    expect(classify(new Error("something else")).kind).toBe("unknown");
  });
});
