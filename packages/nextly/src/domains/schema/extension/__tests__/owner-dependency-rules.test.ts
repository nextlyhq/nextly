/**
 * Who a plugin must depend on before it may build on someone else's schema.
 *
 * Two rules, both refused at startup and naming both plugins:
 *
 * - A plugin adding a hidden column or an index to a collection, Single or
 *   field group ANOTHER plugin declared must name that plugin in its
 *   dependencies, so the owner can't be uninstalled from under it.
 * - A plugin whose index uses a column a THIRD owner contributed must name
 *   that contributor too: without the dependency nothing orders the two
 *   plugins' migrations, and uninstalling the contributor drops a column the
 *   index still stands on.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { loadDialectTables } from "../../../../database/dialect-tables";
import { NextlyError } from "../../../../errors/nextly-error";
import { createOwnerDraft, SchemaDraftStore } from "../draft";
import { col, defineTable } from "../dsl";
import { compileExtensionSchema } from "../publish";

beforeAll(async () => {
  await loadDialectTables("postgresql");
});

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof NextlyError) {
      const data = error.publicData as
        | { errors?: { message: string }[] }
        | undefined;
      return data?.errors?.[0]?.message ?? "";
    }
    throw error;
  }
  throw new Error("expected the call to throw, and it returned");
}

/**
 * Three plugins and an app collection. `shop` declared the `products`
 * collection and the `settings` Single; `reviews` and `search` are its
 * neighbours, whose dependencies each case sets.
 */
function store(dependencies: Record<string, string[]> = {}) {
  return new SchemaDraftStore({
    dialect: "postgresql",
    coreTableNames: ["users"],
    entities: [
      {
        name: "dc_products",
        slug: "products",
        entityKind: "collection",
        ownerPlugin: "shop",
        columns: [
          { name: "id", kind: "varchar", nullable: false },
          { name: "title", kind: "text", nullable: true },
        ],
      },
      {
        name: "single_settings",
        slug: "settings",
        entityKind: "single",
        ownerPlugin: "shop",
        columns: [{ name: "id", kind: "varchar", nullable: false }],
      },
      {
        name: "dc_posts",
        slug: "posts",
        entityKind: "collection",
        columns: [
          { name: "id", kind: "varchar", nullable: false },
          { name: "title", kind: "text", nullable: true },
        ],
      },
    ],
    pluginPrefixes: new Map([
      ["shop", "shop"],
      ["reviews", "reviews"],
      ["search", "search"],
    ]),
    dependencies: new Map(
      Object.entries(dependencies).map(([id, deps]) => [id, new Set(deps)])
    ),
  });
}

const plugin = (id: string) => ({ kind: "plugin" as const, id });

describe("a plugin extending another plugin's collection, Single or field group", () => {
  it("is refused without the dependency, naming both plugins", () => {
    const draft = createOwnerDraft(store(), plugin("reviews"));
    const message = refusal(() =>
      draft.extendTable("dc_products", {
        columns: { rating: col.integer({ nullable: true }) },
      })
    );
    expect(message).toMatch(/plugin "reviews"/);
    expect(message).toMatch(/plugin "shop"/);
    expect(message).toMatch(/dependsOn/);
  });

  it("is refused for an index without the dependency", () => {
    const draft = createOwnerDraft(store(), plugin("reviews"));
    expect(
      refusal(() =>
        draft.extendTable("single_settings", {
          indexes: [{ columns: ["id"] }],
        })
      )
    ).toMatch(/plugin "reviews".*plugin "shop"/s);
  });

  it("is allowed once the plugin depends on the owner", () => {
    const s = store({ reviews: ["shop"] });
    createOwnerDraft(s, plugin("reviews")).extendTable("dc_products", {
      columns: { rating: col.integer({ nullable: true }) },
      indexes: [{ columns: ["rating"] }],
    });
    expect(
      s.get("dc_products")?.columns.find(c => c.name === "rating")
    ).toMatchObject({ hidden: true, contributedBy: plugin("reviews") });
  });

  it("lets the owner extend its own collection", () => {
    const s = store();
    createOwnerDraft(s, plugin("shop")).extendTable("dc_products", {
      columns: { sku: col.shortText({ nullable: true }) },
    });
    expect(s.get("dc_products")?.columns.map(c => c.name)).toContain("sku");
  });

  it("lets the app extend a plugin's collection", () => {
    const s = store();
    createOwnerDraft(s, { kind: "app" }).extendTable("dc_products", {
      columns: { note: col.text({ nullable: true }) },
    });
    expect(s.get("dc_products")?.columns.map(c => c.name)).toContain("note");
  });

  it("leaves a plugin free to extend the app's own collection", () => {
    const s = store();
    createOwnerDraft(s, plugin("reviews")).extendTable("dc_posts", {
      columns: { rating: col.integer({ nullable: true }) },
    });
    expect(s.get("dc_posts")?.columns.map(c => c.name)).toContain("rating");
  });

  it("names the plugin that owns the entity on the draft view", () => {
    const draft = createOwnerDraft(store(), { kind: "app" });
    expect(draft.getTable("dc_products")?.owner).toEqual({
      kind: "entity",
      slug: "products",
      entityKind: "collection",
      plugin: "shop",
    });
  });
});

describe("a plugin's index on a column a third owner contributed", () => {
  const orders = defineTable("orders", {
    id: col.id(),
    total: col.integer(),
  });

  /** `shop` declares a table, and `reviews` (depending on it) adds a column. */
  function withContributedColumn(dependencies: Record<string, string[]>) {
    const s = store({ reviews: ["shop"], ...dependencies });
    createOwnerDraft(s, plugin("shop")).addTable(orders);
    createOwnerDraft(s, plugin("reviews")).extendTable("shop__orders", {
      columns: { score: col.integer({ nullable: true }) },
    });
    return s;
  }

  it("is refused without a dependency on the column's contributor", () => {
    const s = withContributedColumn({ search: ["shop"] });
    const message = refusal(() =>
      createOwnerDraft(s, plugin("search")).extendTable("shop__orders", {
        indexes: [{ columns: ["score"] }],
      })
    );
    expect(message).toMatch(/plugin "search"/);
    expect(message).toMatch(/plugin "reviews"/);
    expect(message).toMatch(/"score"/);
  });

  it("is allowed once the plugin depends on the contributor too", () => {
    const s = withContributedColumn({ search: ["shop", "reviews"] });
    createOwnerDraft(s, plugin("search")).extendTable("shop__orders", {
      indexes: [{ columns: ["score"] }],
    });
    expect(s.get("shop__orders")?.indexes.map(i => i.columns)).toContainEqual([
      "score",
    ]);
  });

  it("does not ask the table's own columns of anyone", () => {
    const s = withContributedColumn({ search: ["shop"] });
    createOwnerDraft(s, plugin("search")).extendTable("shop__orders", {
      indexes: [{ columns: ["total"] }],
    });
    expect(s.get("shop__orders")?.indexes.map(i => i.columns)).toContainEqual([
      "total",
    ]);
  });

  it("is refused on an entity table too", () => {
    const s = store({ search: [] });
    createOwnerDraft(s, plugin("reviews")).extendTable("dc_posts", {
      columns: { rating: col.integer({ nullable: true }) },
    });
    expect(
      refusal(() =>
        createOwnerDraft(s, plugin("search")).extendTable("dc_posts", {
          indexes: [{ columns: ["rating"] }],
        })
      )
    ).toMatch(/plugin "search".*plugin "reviews"/s);
  });

  it("lets the contributor index its own column", () => {
    const s = withContributedColumn({});
    createOwnerDraft(s, plugin("reviews")).extendTable("shop__orders", {
      indexes: [{ columns: ["score"] }],
    });
    expect(s.get("shop__orders")?.indexes.map(i => i.columns)).toContainEqual([
      "score",
    ]);
  });

  it("lets the app index any contributed column", () => {
    const s = withContributedColumn({});
    createOwnerDraft(s, { kind: "app" }).extendTable("shop__orders", {
      indexes: [{ columns: ["score"] }],
    });
    expect(s.get("shop__orders")?.indexes.map(i => i.columns)).toContainEqual([
      "score",
    ]);
  });
});

describe("at boot, the entity's owner comes from what each plugin contributes", () => {
  const products = {
    slug: "products",
    fields: [{ name: "title", type: "text" }],
  };
  const shop = { name: "shop", contributes: { collections: [products] } };
  const reviews = (dependsOn?: Record<string, string>) => ({
    name: "reviews",
    ...(dependsOn !== undefined ? { dependsOn } : {}),
    contributes: {
      schema: {
        extend: [
          ({
            schema,
          }: {
            schema: {
              extendTable: (name: string, ext: object) => void;
            };
          }) =>
            schema.extendTable("dc_products", {
              columns: { rating: col.integer({ nullable: true }) },
            }),
        ],
      },
    },
  });
  const compile = (plugins: unknown[]) =>
    compileExtensionSchema({
      dialect: "postgresql",
      plugins: plugins as never,
      config: { collections: [products] },
      logger: { warn: () => undefined },
    });

  it("refuses a plugin extending another plugin's collection it does not depend on", async () => {
    await expect(compile([shop, reviews()])).rejects.toThrow(NextlyError);
    const message = await compile([shop, reviews()]).then(
      () => "",
      (error: unknown) =>
        (
          (error as NextlyError).publicData as {
            errors?: { message: string }[];
          }
        ).errors?.[0]?.message ?? ""
    );
    expect(message).toMatch(/plugin "reviews".*plugin "shop"/s);
  });

  it("compiles once the plugin depends on the collection's owner", async () => {
    const schema = await compile([shop, reviews({ shop: "*" })]);
    expect(
      schema?.entityColumns.get("dc_products")?.map(column => column.name)
    ).toContain("rating");
  });
});
