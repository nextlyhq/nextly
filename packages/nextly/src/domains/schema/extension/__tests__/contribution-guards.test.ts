/**
 * What a hook may contribute to a table it does not own, refused at the
 * declaration rather than discovered at a push or a deploy.
 *
 * Driven through `compileExtensionSchema` — the function boot and every
 * migration command compile with — so the entity tables are seeded exactly as
 * they are in production, from the config's own fields.
 */
import { afterEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { clearActiveExtensionSchema } from "../active-schema";
import { col, defineTable } from "../dsl";
import { compileExtensionSchema } from "../publish";

type Hook = (args: {
  schema: {
    extendTable(name: string, input: Record<string, unknown>): void;
    addTable(definition: unknown): void;
  };
}) => void;

const compile = (
  extend: Hook[],
  dialect: "postgresql" | "mysql" = "postgresql"
) =>
  compileExtensionSchema({
    dialect,
    plugins: [],
    config: {
      collections: [
        {
          slug: "posts",
          fields: [
            { name: "publishedAt", type: "date" },
            { name: "meta", type: "json" },
          ],
        },
      ],
      singles: [{ slug: "site", fields: [{ name: "motto", type: "text" }] }],
      fieldGroups: [
        { slug: "hero", fields: [{ name: "caption", type: "text" }] },
      ],
      db: { schema: { extend } },
    },
    logger: { warn: () => {} },
  } as never);

/** The refusal's message, or a note that nothing was refused. */
async function refusal(extend: Hook[], dialect?: "mysql"): Promise<string> {
  try {
    await compile(extend, dialect);
  } catch (error) {
    if (error instanceof NextlyError) {
      const data = error.publicData as
        | { errors?: { message: string }[] }
        | undefined;
      return data?.errors?.map(entry => entry.message).join(" ") ?? "";
    }
    // Hook failures are wrapped with the owner and position; the refusal
    // travels as the cause.
    throw error;
  }
  return "not refused";
}

/** The first refusal message, unwrapping the hook-attribution wrapper. */
function messageOf(error: unknown): string {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current instanceof NextlyError) {
      const data = current.publicData as
        | { errors?: { message: string }[] }
        | undefined;
      const joined = data?.errors?.map(entry => entry.message).join(" ");
      if (joined) return joined;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return "";
}

async function refusedWith(extend: Hook[], dialect?: "mysql") {
  try {
    const message = await refusal(extend, dialect);
    return message;
  } catch (error) {
    return messageOf(error);
  }
}

afterEach(() => clearActiveExtensionSchema());

const contribute =
  (table: string, columns: Record<string, unknown>): Hook =>
  ({ schema }) =>
    schema.extendTable(table, { columns });

describe("a contributed column reusing a name the entity already has", () => {
  it("is accepted when the name is new (the control)", async () => {
    expect(
      await refusedWith([
        contribute("dc_posts", {
          reviewNote: col.shortText({ nullable: true }),
        }),
      ])
    ).toBe("not refused");
  });

  it.each([
    ["a field's column", "dc_posts", "publishedAt"],
    ["a system column", "dc_posts", "slug"],
    ["a timestamp column", "dc_posts", "createdAt"],
    ["a Single's field", "single_site", "motto"],
    ["a component's field", "comp_hero", "caption"],
  ])("is refused when it is %s", async (_label, table, key) => {
    expect(
      await refusedWith([
        contribute(table, { [key]: col.shortText({ nullable: true }) }),
      ])
    ).toMatch(/already declared/);
  });

  it("is refused on an extendable core table too", async () => {
    expect(
      await refusedWith([
        contribute("users", { email: col.shortText({ nullable: true }) }),
      ])
    ).toMatch(/already declared/);
  });
});

describe("a key or generated value contributed to a table somebody else owns", () => {
  it("refuses col.id(), a generated primary key", async () => {
    expect(
      await refusedWith([contribute("dc_posts", { ref: col.id() })])
    ).toMatch(/primary key|generated/);
  });

  it("refuses col.serial() added beside an extension table's own key", async () => {
    const addsSecondKey: Hook = ({ schema }) => {
      schema.addTable(defineTable("ledger", { id: col.id() }));
      schema.extendTable("ledger", { columns: { seq: col.serial() } });
    };
    expect(await refusedWith([addsSecondKey])).toMatch(/already has one/);
  });
});

describe("an index contributed to an entity table", () => {
  const index =
    (columns: string[]): Hook =>
    ({ schema }) =>
      schema.extendTable("dc_posts", { indexes: [{ columns }] });

  it("names a column by its key as well as its SQL name", async () => {
    const schema = await compile([index(["publishedAt"])]);
    expect(schema?.entityIndexes.get("dc_posts")?.[0]?.columns).toEqual([
      "published_at",
    ]);
  });

  it("is refused when it names a column the table does not have", async () => {
    expect(await refusedWith([index(["nope"])])).toMatch(/does not have/);
  });

  it("is refused over a column a dialect cannot index", async () => {
    // A JSON field: MySQL cannot key it, so the index would be proposed on
    // every push and refused by the server every time.
    expect(await refusedWith([index(["meta"])])).toMatch(/cannot/);
  });
});

describe("the contributor of an element on a table the caller does not own", () => {
  it("is recorded on entity and core-table columns and indexes", async () => {
    const schema = await compile([
      ({ schema: draft }) => {
        draft.extendTable("dc_posts", {
          columns: { reviewNote: col.shortText({ nullable: true }) },
          indexes: [{ columns: ["review_note"] }],
        });
        draft.extendTable("users", {
          columns: { nickname: col.shortText({ nullable: true }) },
        });
      },
    ]);
    const app = { kind: "app" };
    expect(schema?.entityColumns.get("dc_posts")?.[0]?.contributedBy).toEqual(
      app
    );
    expect(schema?.entityIndexes.get("dc_posts")?.[0]?.contributedBy).toEqual(
      app
    );
    expect(schema?.entityColumns.get("users")?.[0]?.contributedBy).toEqual(app);
  });
});

describe("an expression index key that orders or classes its value", () => {
  const withKey = (expression: string) => () =>
    defineTable(
      "notes",
      { id: col.id(), title: col.shortText() },
      { indexes: [{ columns: [], expression, name: "idx_notes_title" }] }
    );

  it("is accepted when every key computes a value (the control)", () => {
    expect(withKey("lower(title), title")).not.toThrow();
  });

  it.each([
    "lower(title) DESC",
    "title ASC",
    "title NULLS LAST",
    'title COLLATE "C"',
    "title text_pattern_ops",
  ])("refuses %s at declaration, naming table, index and key", key => {
    let caught: unknown;
    try {
      withKey(`id, ${key}`)();
    } catch (error) {
      caught = error;
    }
    expect(NextlyError.isValidation(caught)).toBe(true);
    const message =
      (caught as { publicData?: { errors?: { message?: string }[] } })
        .publicData?.errors?.[0]?.message ?? "";
    expect(message).toContain('"idx_notes_title"');
    expect(message).toContain('"notes"');
    expect(message).toContain(`"${key}"`);
  });
});
