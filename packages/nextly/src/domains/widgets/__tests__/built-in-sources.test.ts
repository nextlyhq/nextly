import { beforeEach, describe, expect, it } from "vitest";

import { registerBuiltInSources } from "../built-in-sources";
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

  it("is idempotent across a boot", () => {
    const collections = [{ slug: "posts", fields: [], timestamps: true }];
    registerBuiltInSources(collections);
    clearSources();
    registerBuiltInSources(collections);
    expect(listSources()).toHaveLength(1);
  });
});
