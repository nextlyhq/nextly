/**
 * A populated relationship spreads the whole related row into the parent, so a
 * column a schema hook contributed to the TARGET's table must be stripped under
 * the target's physical table name.
 *
 * Contributed hidden columns are recorded per physical table. A target
 * collection configured with `dbName` lives in a table other than
 * `dc_<slug>`, and the users system entity lives in `users`, not `dc_users`;
 * redaction that rebuilds the name from the slug looks under a table with no
 * contributed columns and returns the column to any caller who populates the
 * relationship. Each fixture registers the column on the physical table only,
 * so the slug-derived lookup and the resolved one give different answers.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  clearActiveExtensionSchema,
  setActiveExtensionSchema,
} from "../../../schema/extension/active-schema";
import { buildExtensionSchema } from "../../../schema/extension/build-extension-schema";
import { col } from "../../../schema/extension/dsl";
import { TRUSTS_EVERY_COLLECTION } from "../../../../services/collections/trust-grant";
import { CollectionRelationshipService } from "../collection-relationship-service";

// The users system table is resolved through env.DB_DIALECT; sqlite needs no
// DATABASE_URL, so it validates in a unit test. The same arrangement
// relationship-redaction.test.ts uses.
const ORIGINAL_DB_DIALECT = process.env.DB_DIALECT;
process.env.DB_DIALECT = "sqlite";
afterAll(() => {
  if (ORIGINAL_DB_DIALECT === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = ORIGINAL_DB_DIALECT;
});

/** The physical table of the `articles` collection, from its `dbName`. */
const ARTICLES_TABLE = "dc_news_items";

async function activateContributedColumns(): Promise<void> {
  const schema = await buildExtensionSchema({
    dialect: "postgresql",
    coreTableNames: ["users", "media"],
    entities: [
      {
        name: ARTICLES_TABLE,
        slug: "articles",
        entityKind: "collection",
        columns: [
          { name: "id", kind: "varchar", nullable: false },
          { name: "title", kind: "text", nullable: true },
        ],
      },
    ],
    pluginPrefixes: new Map(),
    plugins: [],
    app: {
      owner: { kind: "app" },
      extend: [
        ({ schema: draft }) => {
          draft.extendTable(ARTICLES_TABLE, {
            columns: { searchVector: col.text({ nullable: true }) },
          });
          draft.extendTable("users", {
            columns: { riskScore: col.text({ nullable: true }) },
          });
        },
      ],
    },
  });
  setActiveExtensionSchema("postgresql", schema);
}

function silentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as never;
}

/** An adapter whose `select().from().where()` returns one stored row. */
function adapterReturning(row: Record<string, unknown>) {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => Promise.resolve([row]),
  };
  return {
    getDrizzle: () => chain,
    getDialect: () => "postgresql",
    dialect: "postgresql",
    getCapabilities: () => ({ dialect: "postgresql" }),
  } as never;
}

/** The registry record for `articles`, carrying its resolved physical table. */
const articlesRecord = {
  slug: "articles",
  tableName: ARTICLES_TABLE,
  fields: [{ name: "title", type: "text" }],
};

afterEach(() => {
  clearActiveExtensionSchema();
});

describe("a contributed column on a related row", () => {
  it("is stripped from a fetched row of a dbName collection", async () => {
    await activateContributedColumns();
    const service = new CollectionRelationshipService(
      adapterReturning({ id: "a1", title: "Hello", search_vector: "hello" }),
      silentLogger(),
      { loadDynamicSchema: vi.fn().mockResolvedValue({ id: {} }) } as never,
      { getCollection: vi.fn().mockResolvedValue(articlesRecord) } as never
    );

    const related = await service.fetchRelatedEntry("articles", "a1");

    // The row came back, so the column's absence is the strip rather than a
    // withheld row.
    expect(related).toMatchObject({ id: "a1", title: "Hello" });
    expect(related).not.toHaveProperty("search_vector");
    expect(related).not.toHaveProperty("searchVector");
  });

  it("is stripped from a fetched users row", async () => {
    await activateContributedColumns();
    const service = new CollectionRelationshipService(
      adapterReturning({ id: "u1", email: "a@b.co", risk_score: "high" }),
      silentLogger(),
      {} as never,
      {} as never
    );

    const related = await service.fetchRelatedEntry("users", "u1");

    expect(related).toMatchObject({ id: "u1", email: "a@b.co" });
    expect(related).not.toHaveProperty("risk_score");
    expect(related).not.toHaveProperty("riskScore");
  });

  it("is stripped again from a populated row the nested walk reaches", async () => {
    // The walk re-strips each populated row because a hook can put a column
    // back after the fetch removed it. Here the row arrives carrying it, as it
    // would after such a hook, so only the walk's own strip can remove it.
    await activateContributedColumns();
    const getCollection = vi.fn((slug: string) =>
      Promise.resolve(
        slug === "articles"
          ? articlesRecord
          : {
              slug: "posts",
              fields: [
                {
                  name: "article",
                  type: "relationship",
                  relationTo: "articles",
                },
              ],
            }
      )
    );
    const service = new CollectionRelationshipService(
      adapterReturning({ id: "unused" }),
      silentLogger(),
      { loadDynamicSchema: vi.fn().mockResolvedValue({ id: {} }) } as never,
      { getCollection } as never
    );
    const entry: Record<string, unknown> = {
      id: "p1",
      article: { id: "a1", title: "Hello", search_vector: "hello" },
    };

    await service.applyNestedFieldHooks(entry, "posts", {
      enforceFieldAccess: true,
      overrideAccess: true,
      trusted: TRUSTS_EVERY_COLLECTION,
    });

    const article = entry.article as Record<string, unknown>;
    expect(article).toMatchObject({ id: "a1", title: "Hello" });
    expect(article).not.toHaveProperty("search_vector");
  });
});
