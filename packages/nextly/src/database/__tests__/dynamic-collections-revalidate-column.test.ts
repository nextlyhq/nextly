// Why: lock the contract that the canonical dialect schemas declare the
// `revalidate` column on dynamic_collections AND dynamic_singles. Without this
// column declared, Drizzle's `.select()` silently drops `revalidate` from query
// results (the same class of bug the versions/status column tests guard), so the
// mutation read path would never see a collection's persisted `disable`/`tags`.
import { describe, it, expect } from "vitest";

import { dynamicCollectionsMysql } from "../../schemas/dynamic-collections/mysql";
import { dynamicCollectionsPg } from "../../schemas/dynamic-collections/postgres";
import { dynamicCollectionsSqlite } from "../../schemas/dynamic-collections/sqlite";
import { dynamicSinglesMysql } from "../../schemas/dynamic-singles/mysql";
import { dynamicSinglesPg } from "../../schemas/dynamic-singles/postgres";
import { dynamicSinglesSqlite } from "../../schemas/dynamic-singles/sqlite";

describe("canonical dialect schemas declare the revalidate column", () => {
  it("dynamicCollections exposes revalidate on every dialect", () => {
    expect(dynamicCollectionsPg.revalidate).toBeDefined();
    expect(dynamicCollectionsMysql.revalidate).toBeDefined();
    expect(dynamicCollectionsSqlite.revalidate).toBeDefined();
  });

  it("dynamicSingles exposes revalidate on every dialect", () => {
    expect(dynamicSinglesPg.revalidate).toBeDefined();
    expect(dynamicSinglesMysql.revalidate).toBeDefined();
    expect(dynamicSinglesSqlite.revalidate).toBeDefined();
  });
});
