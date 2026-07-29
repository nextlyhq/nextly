// Why: lock the contract that the canonical dialect schemas declare the
// `webhooks` column on dynamic_collections AND dynamic_singles. Without the
// column declared, Drizzle's `.select()` silently drops `webhooks` from query
// results (the same class of bug the versions/status/revalidate column tests
// guard), so a Builder-authored opt-out would never reach the recording policy
// and writes holding personal data would keep reaching the outbox.
import { describe, it, expect } from "vitest";

import { dynamicCollectionsMysql } from "../../schemas/dynamic-collections/mysql";
import { dynamicCollectionsPg } from "../../schemas/dynamic-collections/postgres";
import { dynamicCollectionsSqlite } from "../../schemas/dynamic-collections/sqlite";
import { dynamicSinglesMysql } from "../../schemas/dynamic-singles/mysql";
import { dynamicSinglesPg } from "../../schemas/dynamic-singles/postgres";
import { dynamicSinglesSqlite } from "../../schemas/dynamic-singles/sqlite";

describe("canonical dialect schemas declare the webhooks column", () => {
  it("dynamicCollections exposes webhooks on every dialect", () => {
    expect(dynamicCollectionsPg.webhooks).toBeDefined();
    expect(dynamicCollectionsMysql.webhooks).toBeDefined();
    expect(dynamicCollectionsSqlite.webhooks).toBeDefined();
  });

  it("dynamicSingles exposes webhooks on every dialect", () => {
    expect(dynamicSinglesPg.webhooks).toBeDefined();
    expect(dynamicSinglesMysql.webhooks).toBeDefined();
    expect(dynamicSinglesSqlite.webhooks).toBeDefined();
  });
});
