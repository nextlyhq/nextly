// Why: lock the contract that the canonical dialect schemas declare the
// `status` column on dynamic_collections (and dynamic_singles). Without this
// column declared, Drizzle's `.select()` silently drops `status` from query
// results, which is what caused the API endpoint to never surface the
// Draft/Published flag in the past.
import { describe, it, expect } from "vitest";

import { dynamicCollectionsPg } from "../../schemas/dynamic-collections/postgres";
import { dynamicCollectionsMysql } from "../../schemas/dynamic-collections/mysql";
import { dynamicCollectionsSqlite } from "../../schemas/dynamic-collections/sqlite";
import { dynamicSinglesPg } from "../../schemas/dynamic-singles/postgres";
import { dynamicSinglesMysql } from "../../schemas/dynamic-singles/mysql";
import { dynamicSinglesSqlite } from "../../schemas/dynamic-singles/sqlite";

describe("dynamicCollections canonical descriptor includes status column", () => {
  it("postgres dialect tables expose status on dynamicCollections", () => {
    expect(dynamicCollectionsPg.status).toBeDefined();
  });

  it("mysql dialect tables expose status on dynamicCollections", () => {
    expect(dynamicCollectionsMysql.status).toBeDefined();
  });

  it("sqlite dialect tables expose status on dynamicCollections", () => {
    expect(dynamicCollectionsSqlite.status).toBeDefined();
  });

  it("singles already expose status (verifies parity with the collections schema)", () => {
    expect(dynamicSinglesPg.status).toBeDefined();
    expect(dynamicSinglesMysql.status).toBeDefined();
    expect(dynamicSinglesSqlite.status).toBeDefined();
  });
});
