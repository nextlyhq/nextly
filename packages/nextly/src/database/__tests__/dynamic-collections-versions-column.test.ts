// Why: lock the contract that the canonical dialect schemas declare the
// `versions` column on dynamic_collections AND dynamic_singles. Without this
// column declared, Drizzle's `.select()` silently drops `versions` from query
// results (the same class of bug the status-column test guards), which would
// make the mutation read path fail to see the persisted versioning config.
import { describe, it, expect } from "vitest";

import { dynamicCollectionsMysql } from "../../schemas/dynamic-collections/mysql";
import { dynamicCollectionsPg } from "../../schemas/dynamic-collections/postgres";
import { dynamicCollectionsSqlite } from "../../schemas/dynamic-collections/sqlite";
import { dynamicSinglesMysql } from "../../schemas/dynamic-singles/mysql";
import { dynamicSinglesPg } from "../../schemas/dynamic-singles/postgres";
import { dynamicSinglesSqlite } from "../../schemas/dynamic-singles/sqlite";

describe("canonical dialect schemas declare the versions column", () => {
  it("dynamicCollections exposes versions on every dialect", () => {
    expect(dynamicCollectionsPg.versions).toBeDefined();
    expect(dynamicCollectionsMysql.versions).toBeDefined();
    expect(dynamicCollectionsSqlite.versions).toBeDefined();
  });

  it("dynamicSingles exposes versions on every dialect", () => {
    expect(dynamicSinglesPg.versions).toBeDefined();
    expect(dynamicSinglesMysql.versions).toBeDefined();
    expect(dynamicSinglesSqlite.versions).toBeDefined();
  });
});
