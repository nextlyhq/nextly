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

  it("refuses columns on an entity table", () => {
    // An entity read selects the whole table, so a raw column would either leak
    // into API responses or be proposed as a DROP by dev push.
    const draft = createOwnerDraft(store(), { kind: "app" });
    expect(
      refusal(() =>
        draft.extendTable("dc_posts", { columns: { x: col.text() } })
      )
    ).toMatch(/may not add columns to "dc_posts"/);
  });

  it("allows an index on an entity table", () => {
    const s = store();
    const draft = createOwnerDraft(s, { kind: "plugin", id: "auth-plugin" });
    draft.extendTable("dc_posts", { indexes: [{ columns: ["title"] }] });
    expect(s.get("dc_posts")?.indexes).toEqual([
      { columns: ["title"], unique: false },
    ]);
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
