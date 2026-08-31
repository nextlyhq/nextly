import { beforeEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { registerBuiltInSources } from "../built-in-sources";
import { validateWidgetQuery } from "../query";
import { clearSources, getSource, listSources } from "../sources";

beforeEach(() => clearSources());

describe("built-in sources", () => {
  it("registers one source per collection, addressed by slug", () => {
    registerBuiltInSources([
      {
        slug: "posts",
        fields: [{ name: "title", type: "text" }],
        timestamps: true,
      },
    ]);

    const source = getSource("collection:posts");
    expect(source?.kind).toBe("collection");
    expect(source?.supports).toContain("count");
    expect(source?.supports).toContain("list");
  });

  it("keeps the FIRST declaration when two declared fields share a name", () => {
    // `readableFields` flattens unnamed presentational groups into the level
    // they sit in, so a top-level `title` and a `title` inside an unnamed group
    // arrive as two entries with one name. `validateSourceFields` refuses a
    // duplicate -- correctly, since a repeated name collapses two fields into
    // one entry in the query validator's allowlist -- but the refusal aborted
    // the whole rebuild rather than this one collection. Deduplicated before
    // the source is built, keeping the first declaration, which is the one an
    // author reading their config top to bottom means.
    registerBuiltInSources([
      {
        slug: "posts",
        fields: [
          { name: "title", type: "text" },
          { name: "title", type: "number" },
        ],
        timestamps: false,
      },
    ]);

    const fields = getSource("collection:posts")?.fields ?? [];
    expect(fields.filter(f => f.name === "title")).toHaveLength(1);
    // The FIRST declaration: `text` maps to `string`, the later `number` to
    // `number`, so the surviving type says which one was kept.
    expect(fields.find(f => f.name === "title")?.type).toBe("string");
  });

  it("does not let one collection's duplicate name unpublish the others", () => {
    // The consequence the deduplication exists for. `refreshCollectionSources`
    // rebuilds every collection source in one pass, so a throw on one member
    // used to take the whole install's sources with it.
    registerBuiltInSources([
      {
        slug: "posts",
        fields: [
          { name: "title", type: "text" },
          { name: "title", type: "text" },
        ],
      },
      { slug: "pages", fields: [{ name: "heading", type: "text" }] },
    ]);

    expect(getSource("collection:posts")).toBeDefined();
    expect(getSource("collection:pages")).toBeDefined();
  });

  it("exposes only the collection's own declared fields", () => {
    // No `timestamps` key: an absent flag defaults to ON, the way
    // `defineCollection` normalizes it and the way the registry stores it.
    registerBuiltInSources([
      { slug: "posts", fields: [{ name: "title", type: "text" }] },
    ]);

    const names = getSource("collection:posts")?.fields.map(f => f.name) ?? [];
    // `id`, `createdAt` and `updatedAt` are always present on a collection and
    // are what a recency widget sorts by, so they are added rather than assumed.
    expect(names).toEqual(
      expect.arrayContaining(["title", "id", "createdAt", "updatedAt"])
    );
    expect(names).not.toContain("password");
  });

  // A password field's own type declares that its value is "never returned by
  // any read or mutation response" (collections/fields/types/password.ts).
  // Declaring it as a widget-selectable/filterable field would be a promise
  // the executor cannot keep, and would give a filter an oracle over a value
  // that is supposed to be unreadable. This registers a password field
  // ALONGSIDE an ordinary one so the assertion above is not satisfied by a
  // fixture that simply never contained a password field.
  it("never exposes a password field, even when the collection declares one", () => {
    registerBuiltInSources([
      {
        slug: "users",
        fields: [
          { name: "email", type: "text" },
          { name: "password", type: "password" },
        ],
        timestamps: true,
      },
    ]);

    const names = getSource("collection:users")?.fields.map(f => f.name) ?? [];
    expect(names).toContain("email");
    expect(names).not.toContain("password");
  });

  it("derives a read permission from the collection slug, in the PermissionSlug spelling", () => {
    // `read-<slug>` is the vocabulary the permission table and
    // `canReadEntity` use (`auth/entity-read-access.ts`). The same field name
    // on `WidgetDefinition` and `PluginAdminWidget` already carries that
    // spelling, so a source emitting `posts:read` meant one field name held
    // two vocabularies -- and a consumer that eventually compares them would
    // match nothing while looking entirely correct.
    registerBuiltInSources([{ slug: "posts", fields: [], timestamps: true }]);
    expect(getSource("collection:posts")?.requiredPermission).toBe(
      "read-posts"
    );
  });

  it("omits the timestamp columns a collection does not have", () => {
    // `timestamps: false` means the table has no `created_at`/`updated_at`
    // columns at all. Declaring them selectable and sortable anyway makes a
    // query pass validation and then fail in the read path on a missing
    // column -- a refusal the caller cannot act on, from a field the source
    // told them was available.
    registerBuiltInSources([
      {
        slug: "audit",
        fields: [{ name: "action", type: "text" }],
        timestamps: false,
      },
    ]);

    const names = getSource("collection:audit")?.fields.map(f => f.name) ?? [];
    expect(names).toContain("action");
    // `id` is present whatever the timestamps setting says.
    expect(names).toContain("id");
    expect(names).not.toContain("createdAt");
    expect(names).not.toContain("updatedAt");
  });

  it("keeps them for a collection that HAS them", () => {
    // The control: the assertion above would also pass on a build that never
    // appended the timestamp columns to anything.
    registerBuiltInSources([
      {
        slug: "posts",
        fields: [{ name: "title", type: "text" }],
        timestamps: true,
      },
    ]);

    const names = getSource("collection:posts")?.fields.map(f => f.name) ?? [];
    expect(names).toContain("createdAt");
    expect(names).toContain("updatedAt");
  });

  it("offers the status column to a collection that HAS Draft/Published", () => {
    // `status: true` is what makes the schema pipeline inject a `status`
    // system column (`hasStatus` in `diff/build-from-fields.ts`), so the
    // column is REAL and a widget must be able to select, sort and filter on
    // it. The source's `fields` is the only allowlist `validateWidgetQuery`
    // checks against, so a column left out of it is refused as undeclared --
    // a refusal about a field the table actually carries, which is the
    // mirror-image of the `timestamps` defect.
    registerBuiltInSources([
      {
        slug: "posts",
        fields: [{ name: "title", type: "text" }],
        timestamps: true,
        status: true,
      },
    ]);

    const status = getSource("collection:posts")?.fields.find(
      f => f.name === "status"
    );
    // Typed `string`, because the column stores "draft"/"published" text.
    expect(status).toEqual({ name: "status", type: "string" });
  });

  it("withholds it from a collection that does NOT", () => {
    // The control. `status` defaults to OFF -- the opposite of `timestamps`,
    // which defaults ON -- so an absent flag must leave the column out, and
    // this assertion would also be satisfied by a build that never added the
    // column to anything, which the case above rules out.
    registerBuiltInSources([
      { slug: "audit", fields: [{ name: "action", type: "text" }] },
    ]);

    const names = getSource("collection:audit")?.fields.map(f => f.name) ?? [];
    expect(names).toContain("action");
    expect(names).not.toContain("status");
  });

  it("lets a widget select, sort and filter on the status it declared", () => {
    // The outcome, not the shape: a name in `fields` is only worth anything
    // if `validateWidgetQuery` accepts it in all three positions, which is
    // what a `status: "all"` table widget actually does.
    registerBuiltInSources([
      {
        slug: "posts",
        fields: [{ name: "title", type: "text" }],
        status: true,
      },
    ]);

    expect(
      validateWidgetQuery({
        source: "collection:posts",
        op: "list",
        status: "all",
        select: ["title", "status"],
        sort: "-status",
        where: { status: { equals: "draft" } },
      })
    ).toMatchObject({ select: ["title", "status"], sort: "-status" });
  });

  it("refuses the same query against a collection with no status column", () => {
    // The other half: an undeclared field must still be refused, so the case
    // above is not passing because the validator stopped checking.
    registerBuiltInSources([
      { slug: "audit", fields: [{ name: "action", type: "text" }] },
    ]);

    expect(() =>
      validateWidgetQuery({
        source: "collection:audit",
        op: "list",
        select: ["status"],
      })
    ).toThrow(NextlyError);
  });

  it("is idempotent across a boot", () => {
    const collections = [{ slug: "posts", fields: [], timestamps: true }];
    registerBuiltInSources(collections);
    clearSources();
    registerBuiltInSources(collections);
    expect(listSources()).toHaveLength(1);
  });
});
