// Why: lock the contract that the runtime dialect-tables descriptor includes
// the status column on dynamicCollections (and dynamicSingles via the
// canonical re-export). Without this column declared in the runtime descriptor,
// Drizzle's `.select()` silently drops `status` from query results, which is
// what caused the API endpoint to never surface the Draft/Published flag even
// when the DB column was set. Regression coverage for the Task 5 PR 2 fix.
import { describe, it, expect } from "vitest";

import * as schema from "../schema/index";

describe("dynamicCollections runtime descriptor includes status column", () => {
  it("postgres dialect tables expose status on dynamicCollections", () => {
    expect(schema.postgres.dynamicCollections.status).toBeDefined();
  });

  it("mysql dialect tables expose status on dynamicCollections", () => {
    expect(schema.mysql.dynamicCollections.status).toBeDefined();
  });

  it("sqlite dialect tables expose status on dynamicCollections", () => {
    expect(schema.sqlite.dynamicCollections.status).toBeDefined();
  });

  it("singles already expose status (verifies the canonical re-export pattern works as expected)", () => {
    expect(schema.postgres.dynamicSingles.status).toBeDefined();
    expect(schema.mysql.dynamicSingles.status).toBeDefined();
    expect(schema.sqlite.dynamicSingles.status).toBeDefined();
  });
});
