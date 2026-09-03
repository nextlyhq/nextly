import { describe, expect, it } from "vitest";

import {
  collectionEntityFromSettings,
  singleEntityFromSettings,
} from "./settings-to-manifest";

const FIELDS = [{ name: "headline", type: "text", required: false }];

describe("collectionEntityFromSettings", () => {
  it("forwards status: true into the manifest entity", () => {
    const entity = collectionEntityFromSettings(
      "posts",
      {
        singularName: "Post",
        pluralName: "Posts",
        slug: "posts",
        icon: "Database",
        status: true,
      },
      FIELDS
    );
    expect(entity.status).toBe(true);
    expect(entity.slug).toBe("posts");
    expect(entity.labels).toEqual({ singular: "Post", plural: "Posts" });
    expect(entity.fields.map(f => f.name)).toEqual(["headline"]);
  });

  it("writes status: false explicitly so Draft/Published can be turned off", () => {
    const entity = collectionEntityFromSettings(
      "posts",
      {
        singularName: "Post",
        pluralName: "Posts",
        slug: "posts",
        icon: "Database",
        status: false,
      },
      FIELDS
    );
    expect(entity.status).toBe(false);
  });

  it("coerces an absent status to false (never undefined)", () => {
    const entity = collectionEntityFromSettings(
      "posts",
      {
        singularName: "Post",
        pluralName: "Posts",
        slug: "posts",
        icon: "Database",
      },
      FIELDS
    );
    expect(entity.status).toBe(false);
  });
});

describe("singleEntityFromSettings", () => {
  it("forwards status: true and sets single labels from singularName", () => {
    const entity = singleEntityFromSettings(
      "home_hero",
      {
        singularName: "Home Hero",
        slug: "home_hero",
        icon: "FileText",
        status: true,
      },
      FIELDS
    );
    expect(entity.status).toBe(true);
    expect(entity.labels).toEqual({
      singular: "Home Hero",
      plural: "Home Hero",
    });
  });

  it("writes status: false explicitly", () => {
    const entity = singleEntityFromSettings(
      "home_hero",
      {
        singularName: "Home Hero",
        slug: "home_hero",
        icon: "FileText",
        status: false,
      },
      FIELDS
    );
    expect(entity.status).toBe(false);
  });
});

describe("version history in the manifest mirror", () => {
  // Both mappers, because the committed ui-schema.json is the other half of the
  // builder's dual write: a kind missing here silently reverts the setting the
  // next time the manifest syncs.
  const cases = [
    ["collection", collectionEntityFromSettings],
    ["single", singleEntityFromSettings],
  ] as const;

  for (const [kind, build] of cases) {
    it(`${kind}: mirrors the toggle when on`, () => {
      const entity = build(
        "posts",
        {
          singularName: "Post",
          pluralName: "Posts",
          slug: "posts",
          icon: "FileText",
          versions: true,
        },
        FIELDS
      );
      expect(entity.versions).toBe(true);
    });

    it(`${kind}: writes versions: false explicitly`, () => {
      // Omitting it would let a stale `true` survive in the manifest and turn
      // versioning back on at the next sync.
      const entity = build(
        "posts",
        {
          singularName: "Post",
          pluralName: "Posts",
          slug: "posts",
          icon: "FileText",
          versions: false,
        },
        FIELDS
      );
      expect(entity.versions).toBe(false);
    });
  }
});

describe("cache revalidation in the manifest mirror", () => {
  const cases = [
    ["collection", collectionEntityFromSettings],
    ["single", singleEntityFromSettings],
  ] as const;

  const base = {
    singularName: "Post",
    pluralName: "Posts",
    slug: "posts",
    icon: "FileText",
  };

  for (const [kind, build] of cases) {
    it(`${kind}: mirrors the opt-out when off`, () => {
      const entity = build("posts", { ...base, revalidate: false }, FIELDS);
      expect(entity.revalidate).toBe(false);
    });

    it(`${kind}: defaults to on when the setting is absent`, () => {
      // Revalidation is on unless explicitly disabled, so an absent value must
      // land as true in the manifest, not undefined (which would drop the key).
      const entity = build("posts", base, FIELDS);
      expect(entity.revalidate).toBe(true);
    });
  }
});

describe("the description a later save must not erase", () => {
  it("carries it into the manifest entity for a collection and a single", () => {
    // 🔴 The migration's upsert writes this column UNCONDITIONALLY so that
    // clearing a description propagates. A manifest omitting it therefore does
    // not leave the stored value alone — it replaces it with NULL, erasing on
    // the next Builder save a description the create migration had deployed.
    const settings = {
      slug: "articles",
      singularName: "Article",
      pluralName: "Articles",
      description: "Long-form editorial pieces",
      icon: "FileText",
    } as never;
    expect(
      collectionEntityFromSettings("articles", settings, []).description
    ).toBe("Long-form editorial pieces");
    expect(singleEntityFromSettings("about", settings, []).description).toBe(
      "Long-form editorial pieces"
    );
  });

  it("omits the key entirely when there is no description", () => {
    // The control: writing an explicit undefined would serialise into the
    // manifest as a present-but-empty key, and a mapper that always set it
    // would satisfy the assertion above.
    const settings = {
      slug: "articles",
      singularName: "Article",
      pluralName: "Articles",
      icon: "FileText",
    } as never;
    expect(
      "description" in collectionEntityFromSettings("articles", settings, [])
    ).toBe(false);
  });
});
