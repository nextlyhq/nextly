/**
 * Ownership in the draft.
 *
 * The rules here are the whole reason hooks can be given to plugins at all:
 * Payload's are app-only, so nothing has to decide who may change what. Ours
 * do, and a mistake means one plugin silently altering another's table.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { createOwnerDraft, SchemaDraftStore } from "../draft";
import { col, defineTable } from "../dsl";

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

function store() {
  return new SchemaDraftStore({
    dialect: "postgresql",
    coreTableNames: ["users", "media"],
    entities: [
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
      ["auth-plugin", "auth"],
      ["other-plugin", "other"],
    ]),
  });
}

const identities = defineTable("identities", {
  id: col.id(),
  provider: col.shortText(),
});

describe("SchemaDraftStore seeding", () => {
  it("seeds core tables as read-only", () => {
    const draft = createOwnerDraft(store(), { kind: "app" });
    expect(draft.getTable("users")?.owner).toEqual({ kind: "core" });
  });

  it("seeds entity tables with their kind and slug", () => {
    const draft = createOwnerDraft(store(), { kind: "app" });
    expect(draft.getTable("dc_posts")?.owner).toEqual({
      kind: "entity",
      slug: "posts",
      entityKind: "collection",
    });
  });
});

describe("addTable", () => {
  it("applies a plugin's prefix exactly once", () => {
    const s = store();
    createOwnerDraft(s, { kind: "plugin", id: "auth-plugin" }).addTable(
      identities
    );
    expect(s.get("auth__identities")?.owner).toEqual({
      kind: "plugin",
      id: "auth-plugin",
    });
  });

  it("refuses a name that already carries the prefix rather than doubling it", () => {
    const draft = createOwnerDraft(store(), {
      kind: "plugin",
      id: "auth-plugin",
    });
    expect(
      refusal(() =>
        draft.addTable(defineTable("auth__identities", { id: col.id() }))
      )
    ).toMatch(/already carries the prefix/);
  });

  it("refuses a duplicate table and names both owners", () => {
    const s = store();
    createOwnerDraft(s, { kind: "plugin", id: "auth-plugin" }).addTable(
      identities
    );
    const message = refusal(() =>
      createOwnerDraft(s, { kind: "plugin", id: "auth-plugin" }).addTable(
        identities
      )
    );
    expect(message).toMatch(/already declared by plugin "auth-plugin"/);
  });

  it("refuses an app table that collides with a core table", () => {
    const draft = createOwnerDraft(store(), { kind: "app" });
    expect(
      refusal(() => draft.addTable(defineTable("users", { id: col.id() })))
    ).toMatch(/is a core table/);
  });
});

describe("extendTable ownership", () => {
  it("lets an owner add columns to its own table", () => {
    const s = store();
    const draft = createOwnerDraft(s, { kind: "plugin", id: "auth-plugin" });
    draft.addTable(identities);
    draft.extendTable("auth__identities", {
      columns: { lastSeenAt: col.timestamp({ nullable: true }) },
    });
    expect(s.get("auth__identities")?.columns.map(c => c.name)).toContain(
      "last_seen_at"
    );
  });

  it("refuses columns on another plugin's table", () => {
    const s = store();
    createOwnerDraft(s, { kind: "plugin", id: "auth-plugin" }).addTable(
      identities
    );
    const other = createOwnerDraft(s, { kind: "plugin", id: "other-plugin" });
    expect(
      refusal(() =>
        other.extendTable("auth__identities", { columns: { x: col.text() } })
      )
    ).toMatch(/may not add columns to "auth__identities"/);
  });

  it("allows a HIDDEN column on an entity table", () => {
    // Part A refused this. It is allowed now because both halves exist: the
    // column reaches the runtime table (so push and SQLite rebuilds keep it)
    // and is marked hidden (so no entry API returns it). Neither half alone
    // would be safe — unhidden it leaks into every response, and absent from
    // the runtime table the next push proposes DROPPING it.
    const s = store();
    const draft = createOwnerDraft(s, { kind: "app" });
    draft.extendTable("dc_posts", {
      columns: { searchVector: col.text({ nullable: true }) },
    });
    expect(
      s.get("dc_posts")?.columns.find(c => c.name === "search_vector")
    ).toMatchObject({ hidden: true });
  });

  it("refuses a NOT NULL column with no default on a populated table", () => {
    // Existing rows already exist, so this cannot be added on any dialect —
    // and it fails on exactly the installations that have data. Caught at
    // resolve time, on an empty dev database, rather than in production.
    const draft = createOwnerDraft(store(), { kind: "app" });
    expect(
      refusal(() =>
        draft.extendTable("dc_posts", { columns: { x: col.text() } })
      )
    ).toMatch(/NOT NULL with no default/);
  });

  it("does not require a default on the caller's OWN new table", () => {
    // The discriminator: a table being declared right now is empty by
    // construction, so the rule above would have no failure to prevent there.
    const s = store();
    const draft = createOwnerDraft(s, { kind: "plugin", id: "auth-plugin" });
    draft.addTable(identities);
    expect(() =>
      draft.extendTable("auth__identities", {
        columns: { notNullNoDefault: col.text() },
      })
    ).not.toThrow();
  });

  it("allows an index on an entity table", () => {
    const s = store();
    const draft = createOwnerDraft(s, { kind: "plugin", id: "auth-plugin" });
    draft.extendTable("dc_posts", { indexes: [{ columns: ["title"] }] });
    expect(s.get("dc_posts")?.indexes).toEqual([
      { columns: ["title"], unique: false },
    ]);
  });

  it("allows an index on an entity table whose columns are only seeded", () => {
    // The real boot seeds an entity with NO columns — `publish.ts` says so in
    // terms, because the field pipeline is what knows them. The store above
    // seeds `dc_posts` WITH columns, so every other test here reaches a case
    // production never has, and the refusal this guards against fired on the
    // first plugin that indexed an entity table.
    const seeded = new SchemaDraftStore({
      dialect: "postgresql",
      coreTableNames: ["users", "media"],
      entities: [
        {
          name: "dc_posts",
          slug: "posts",
          entityKind: "collection",
          columns: [],
        },
      ],
      pluginPrefixes: new Map([["auth-plugin", "auth"]]),
    });
    const draft = createOwnerDraft(seeded, {
      kind: "plugin",
      id: "auth-plugin",
    });
    expect(() =>
      draft.extendTable("dc_posts", { indexes: [{ columns: ["created_at"] }] })
    ).not.toThrow();
    expect(seeded.get("dc_posts")?.indexes).toEqual([
      { columns: ["created_at"], unique: false },
    ]);
  });

  it("still refuses an unknown column on a table that DOES declare its own", () => {
    // The control for the rule above: relaxing the check for seeded tables
    // must not relax it for a table whose column set is authoritative, or the
    // rule would be satisfied by never checking anything.
    const s2 = store();
    const draft = createOwnerDraft(s2, { kind: "plugin", id: "auth-plugin" });
    draft.addTable(identities);
    expect(
      refusal(() =>
        draft.extendTable("auth__identities", {
          indexes: [{ columns: ["nope"] }],
        })
      )
    ).toMatch(/does not declare/);
  });

  it("refuses an index on another plugin's table", () => {
    const s = store();
    createOwnerDraft(s, { kind: "plugin", id: "auth-plugin" }).addTable(
      identities
    );
    const other = createOwnerDraft(s, { kind: "plugin", id: "other-plugin" });
    expect(
      refusal(() =>
        other.extendTable("auth__identities", {
          indexes: [{ columns: ["id"] }],
        })
      )
    ).toMatch(/may not index "auth__identities"/);
  });

  it("refuses extending a table that does not exist", () => {
    const draft = createOwnerDraft(store(), { kind: "app" });
    expect(
      refusal(() =>
        draft.extendTable("ghost", { indexes: [{ columns: ["id"] }] })
      )
    ).toMatch(/does not exist/);
  });
});
