import { describe, expect, it } from "vitest";

import {
  collectionEntityFromSettings,
  fieldGroupEntityFromSettings,
  manifestSettingKeys,
  manifestSettingsFrom,
  singleEntityFromSettings,
} from "./settings-to-manifest";

const FIELDS = [{ name: "headline", type: "text", required: false }];

/**
 * Every setting a person can answer, each with a value distinguishable from the
 * default the projection would produce by forgetting it.
 *
 * 🔴 Built once and shared, so a test cannot pass by omitting the key it is
 * about. `revalidate` and `webhooks` are FALSE here for that reason: they
 * default on, so a projection that dropped them would still emit `true` and an
 * assertion written against a truthy value could not tell the two apart.
 */
const EVERY_SETTING = {
  singularName: "Post",
  pluralName: "Posts",
  slug: "posts",
  icon: "Database",
  category: "Content",
  description: "Long-form writing",
  status: true,
  i18n: true,
  versions: true,
  versionsMaxPerDoc: 10 as number | false,
  revalidate: false,
  webhooks: false,
  startingFieldType: "text",
};

describe("the projection carries every setting the manifest declares", () => {
  it.each(["collection", "single", "component"] as const)(
    "emits each key the classification says a %s carries",
    kind => {
      // 🔴 Against the CLASSIFICATION, not against a second hand-written list.
      // The point of the map is that a new setting fails to compile until it is
      // classified; this is the other half — that a key classified as carried is
      // actually projected, rather than declared and forgotten.
      const projected = manifestSettingsFrom(EVERY_SETTING, kind);
      const emitted = Object.entries(projected)
        .filter(([, v]) => v !== undefined)
        .map(([k]) => (k === "localized" ? "i18n" : k))
        .sort();
      expect(emitted).toEqual(manifestSettingKeys(kind));
    }
  );

  it("leaves a component the four keys the manifest schema refuses", () => {
    // 🔴 `_zod/ui-schema.ts` rejects these KEYS on a component — `versions`,
    // `versionsMaxPerDoc`, `revalidate`, `webhooks` — testing `!== undefined`,
    // so an explicit `false` is refused exactly like a `true`. A shared
    // projection that emitted them would leave every field-group manifest write
    // rejected while its database write succeeded, and the file silently stale
    // behind a warning toast.
    const entity = fieldGroupEntityFromSettings("seo", EVERY_SETTING, FIELDS);
    expect(entity.versions).toBeUndefined();
    expect(entity.versionsMaxPerDoc).toBeUndefined();
    expect(entity.revalidate).toBeUndefined();
    expect(entity.webhooks).toBeUndefined();
    // The control: a collection still gets all four, so the assertion above
    // cannot pass by the projection having stopped emitting them everywhere.
    const collection = collectionEntityFromSettings(
      "posts",
      EVERY_SETTING,
      FIELDS
    );
    expect(collection.versions).toBe(true);
    expect(collection.versionsMaxPerDoc).toBe(10);
    expect(collection.revalidate).toBe(false);
    expect(collection.webhooks).toBe(false);
  });

  it("keeps version retention through an EDIT, not only a create", () => {
    // 🔴 The defect this module was rewritten for. The dev-schema endpoint
    // full-replaces the entity by slug, and the create path projected
    // `versionsMaxPerDoc` while both edit paths did not — so choosing "keep 10"
    // on a new collection wrote it to ui-schema.json and the next edit of that
    // collection replaced the entity without it. Not a missing feature: a value
    // the file HAD and lost.
    const created = collectionEntityFromSettings("posts", EVERY_SETTING, []);
    const edited = collectionEntityFromSettings("posts", EVERY_SETTING, FIELDS);
    expect(created.versionsMaxPerDoc).toBe(10);
    expect(edited.versionsMaxPerDoc).toBe(10);
  });

  it("carries unlimited retention, which is false and not absent", () => {
    // `false` means keep everything and `undefined` means the default of 50, so
    // a projection that treated the two alike would silently cap a history the
    // author asked to keep whole.
    const entity = singleEntityFromSettings(
      "home",
      { ...EVERY_SETTING, versionsMaxPerDoc: false },
      []
    );
    expect(entity.versionsMaxPerDoc).toBe(false);
  });

  it("gives a field group the same description projection as the others", () => {
    // Field groups were the sites that forgot the description most often,
    // because each wrote its own projection inline.
    const entity = fieldGroupEntityFromSettings("seo", EVERY_SETTING, FIELDS);
    expect(entity.description).toBe("Long-form writing");
    expect(entity.labels).toEqual({ singular: "Post", plural: "Post" });
  });

  it("passes the description through, because it was normalised at the form", () => {
    // 🔴 The projection deliberately does NOT trim. It once did, and that made
    // it the only writer that normalised: the create and update REQUESTS send
    // the raw value, so a description typed with trailing spaces was stored one
    // way in the row and another in the file, and replaying the manifest
    // visibly changed what a person had saved. The trim moved to the settings
    // form, which is the one boundary both writes read from — see
    // `BuilderSettingsModal`'s `normalized`.
    const settings = { ...EVERY_SETTING, description: "  spaced  " };
    expect(
      collectionEntityFromSettings("posts", settings, []).description
    ).toBe("  spaced  ");
  });

  it("does not project what the manifest has no place for", () => {
    // A control for the assertion above: "emits every carried key" also passes
    // if the projection emits EVERYTHING, which would put keys into the file
    // that its schema rejects.
    const projected = manifestSettingsFrom(
      EVERY_SETTING,
      "collection"
    ) as Record<string, unknown>;
    for (const key of ["icon", "category", "slug", "startingFieldType"]) {
      expect(projected[key]).toBeUndefined();
    }
  });
});

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
    // 🔴 The migration replays where the Builder's local row does not exist,
    // so a manifest omitting the description deploys a collection without one —
    // the help text is simply absent on the deployed copy, visible only to
    // whoever opens it there.
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
