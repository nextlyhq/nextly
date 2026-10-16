/**
 * A PostgreSQL error is classified by the driver's SQLSTATE, wherever it sits.
 *
 * A query that runs through Drizzle fails with Drizzle's `DrizzleQueryError`,
 * whose message is the statement and which carries no `code`; node-postgres's
 * own error, the one with the SQLSTATE, is its `cause`. These hold the
 * classifier to the driver's code whether or not Drizzle wrapped it. No
 * database is needed: these are the shapes the driver and Drizzle produce.
 */
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";

import { createPostgresAdapter } from "../index";

/** What node-postgres throws for a duplicate key. */
function duplicateKey(): Error {
  return Object.assign(
    new Error(
      'duplicate key value violates unique constraint "posts_slug_key"'
    ),
    { code: "23505", constraint: "posts_slug_key", table: "posts" }
  );
}

/** The adapter's classifier, which subclasses keep protected. */
function classify(error: unknown): { kind: string; code?: string } {
  const adapter = createPostgresAdapter({
    url: "postgres://user:pass@localhost:5432/testdb",
  });
  return (
    adapter as unknown as {
      classifyError(error: unknown): { kind: string; code?: string };
    }
  ).classifyError(error);
}

describe("PostgreSQL error classification", () => {
  it("classifies the driver's duplicate key as a unique violation", () => {
    expect(classify(duplicateKey()).kind).toBe("unique_violation");
  });

  it("classifies a duplicate key that Drizzle wrapped as a unique violation", () => {
    const wrapped = new DrizzleQueryError(
      'insert into "posts" ("id", "slug") values ($1, $2)',
      ["1", "a"],
      duplicateKey()
    );

    const classified = classify(wrapped);

    expect(classified.kind).toBe("unique_violation");
    expect(classified.code).toBe("23505");
  });

  it("leaves an error with no driver error anywhere in it unknown", () => {
    expect(classify(new Error("something else")).kind).toBe("unknown");
  });
});
