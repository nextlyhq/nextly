import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import type { CollectionConfig } from "../../collections/config/define-collection";
import type { FieldConfig } from "../../collections/fields/types";
import type { FieldGroupConfig } from "../../field-groups/config/types";
import type { NextlyServiceConfig } from "../../di/register";
import type { SingleConfig } from "../../singles/config/types";
import type { PluginContributions } from "../contributions";
import type { PluginDefinition } from "../plugin-context";

import {
  applyPluginSchemaContributions,
  applyPluginSchemaContributionsDeferred,
  assertRegisteredKeepTheirKind,
  finalizeDeferredExtendTargets,
  resolveBuilderExtends,
} from "./apply-contributions";

// Minimal entity builders — the fold only reads `.slug`, so partial casts are fine.
const coll = (slug: string): CollectionConfig =>
  ({ slug, fields: [] }) as unknown as CollectionConfig;
const single = (slug: string): SingleConfig =>
  ({ slug, fields: [] }) as unknown as SingleConfig;
const comp = (slug: string): FieldGroupConfig =>
  ({ slug, fields: [] }) as unknown as FieldGroupConfig;

const cfg = (partial: Partial<NextlyServiceConfig>): NextlyServiceConfig =>
  ({ imageProcessor: {}, ...partial }) as unknown as NextlyServiceConfig;

const plugin = (
  name: string,
  contributes: PluginContributions,
  enabled = true
): PluginDefinition => ({
  name,
  version: "1.0.0",
  nextly: ">=0.0.0",
  enabled,
  contributes,
});

const slugs = (entities: { slug: string }[] | undefined): string[] =>
  (entities ?? []).map(e => e.slug);

describe("applyPluginSchemaContributions (fold — D3/D12)", () => {
  it("appends each plugin's contributes.{collections,singles,fieldGroups}, config-first then plugin order", () => {
    const config = cfg({
      collections: [coll("code-posts")],
      singles: [single("code-settings")],
      fieldGroups: [comp("code-hero")],
    });
    const plugins = [
      plugin("plugin-a", {
        collections: [coll("a-forms")],
        singles: [single("a-single")],
        fieldGroups: [comp("a-comp")],
      }),
      plugin("plugin-b", {
        collections: [coll("b-submissions")],
      }),
    ];

    const result = applyPluginSchemaContributions(config, plugins);

    expect(slugs(result.collections)).toEqual([
      "code-posts",
      "a-forms",
      "b-submissions",
    ]);
    expect(slugs(result.singles)).toEqual(["code-settings", "a-single"]);
    expect(slugs(result.fieldGroups)).toEqual(["code-hero", "a-comp"]);
  });

  it("does not mutate the input config or its arrays", () => {
    const config = cfg({ collections: [coll("code-posts")] });
    const before = config.collections;

    const result = applyPluginSchemaContributions(config, [
      plugin("plugin-a", { collections: [coll("a-forms")] }),
    ]);

    expect(config.collections).toBe(before);
    expect(config.collections).toHaveLength(1);
    expect(result).not.toBe(config);
    expect(result.collections).not.toBe(before);
  });

  it("still contributes schema for disabled plugins", () => {
    const config = cfg({ collections: [coll("code-posts")] });

    const result = applyPluginSchemaContributions(config, [
      plugin("plugin-disabled", { collections: [coll("d-forms")] }, false),
    ]);

    expect(slugs(result.collections)).toEqual(["code-posts", "d-forms"]);
  });

  it("handles plugins with no contributes and an empty config", () => {
    const result = applyPluginSchemaContributions(cfg({}), [
      { name: "bare", version: "1.0.0", nextly: ">=0.0.0" },
    ]);

    expect(slugs(result.collections)).toEqual([]);
    expect(slugs(result.singles)).toEqual([]);
    expect(slugs(result.components)).toEqual([]);
  });
});

describe("applyPluginSchemaContributions (slug collisions — D13)", () => {
  const collisionError = (fn: () => unknown): NextlyError => {
    try {
      fn();
    } catch (err) {
      return err as NextlyError;
    }
    throw new Error("expected applyPluginSchemaContributions to throw");
  };

  it("throws when two plugins contribute the same collection slug", () => {
    const err = collisionError(() =>
      applyPluginSchemaContributions(cfg({}), [
        plugin("plugin-a", { collections: [coll("forms")] }),
        plugin("plugin-b", { collections: [coll("forms")] }),
      ])
    );

    expect(err).toBeInstanceOf(NextlyError);
    expect(err.code).toBe("NEXTLY_SCHEMA_SLUG_COLLISION");
    expect(err.logContext?.reason).toBe("slug-collision");
    expect(err.logContext?.slug).toBe("forms");
    expect(err.logContext?.owners).toEqual(
      expect.arrayContaining(["plugin-a", "plugin-b"])
    );
  });

  it("throws when a plugin collection slug collides with a code collection", () => {
    const err = collisionError(() =>
      applyPluginSchemaContributions(cfg({ collections: [coll("posts")] }), [
        plugin("plugin-a", { collections: [coll("posts")] }),
      ])
    );

    expect(err.code).toBe("NEXTLY_SCHEMA_SLUG_COLLISION");
    expect(err.logContext?.owners).toEqual(
      expect.arrayContaining(["code", "plugin-a"])
    );
  });

  describe("across kinds, which are one slug namespace", () => {
    // 🔴 A collection, a single and a component share one slug namespace: the
    // registries refuse a slug the other kind holds, a permission is named
    // `read-<slug>` for either kind, and code access resolves by slug alone.
    // Checked per kind, a plugin collection under an app single's slug passed
    // this fold, the app's single was then silently refused at sync, and the
    // install booted without it -- its reads answering not-found under the
    // collection's rule.

    it("throws when a plugin collection takes an app single's slug", () => {
      const err = collisionError(() =>
        applyPluginSchemaContributions(cfg({ singles: [single("shared")] }), [
          plugin("plugin-a", { collections: [coll("shared")] }),
        ])
      );
      expect(err.logContext?.reason).toBe("slug-collision");
      expect(err.logContext?.slug).toBe("shared");
      expect(err.logContext?.owners).toEqual([
        "code (single)",
        "plugin-a (collection)",
      ]);
    });

    it("throws when a plugin single takes an app collection's slug", () => {
      const err = collisionError(() =>
        applyPluginSchemaContributions(cfg({ collections: [coll("shared")] }), [
          plugin("plugin-a", { singles: [single("shared")] }),
        ])
      );
      expect(err.logContext?.owners).toEqual([
        "code (collection)",
        "plugin-a (single)",
      ]);
    });

    it("throws when one plugin contributes two kinds under one slug", () => {
      collisionError(() =>
        applyPluginSchemaContributions(cfg({}), [
          plugin("plugin-a", {
            collections: [coll("shared")],
            singles: [single("shared")],
          }),
        ])
      );
    });

    it("throws when two plugins claim one slug as different kinds", () => {
      const err = collisionError(() =>
        applyPluginSchemaContributions(cfg({}), [
          plugin("plugin-a", { singles: [single("shared")] }),
          plugin("plugin-b", { fieldGroups: [comp("shared")] }),
        ])
      );
      expect(err.logContext?.owners).toEqual([
        "plugin-a (single)",
        "plugin-b (component)",
      ]);
    });

    it("throws from the fold the runtime boots through, too", () => {
      // `di/register.ts` and the CLI call the deferring fold, not this one.
      collisionError(() =>
        applyPluginSchemaContributionsDeferred(
          cfg({ singles: [single("shared")] }),
          [plugin("plugin-a", { collections: [coll("shared")] })]
        )
      );
    });

    it("still merges two kinds under DIFFERENT slugs", () => {
      // The control: a check that refused every cross-kind contribution
      // would satisfy every case above.
      const merged = applyPluginSchemaContributions(
        cfg({ singles: [single("settings")] }),
        [
          plugin("plugin-a", {
            collections: [coll("posts")],
            singles: [single("hero")],
          }),
        ]
      );
      expect(merged.collections?.map(c => c.slug)).toEqual(["posts"]);
      expect(merged.singles?.map(s => s.slug)).toEqual(["settings", "hero"]);
    });

    it("refuses a configured entity whose slug a REGISTERED entity of another kind holds", () => {
      // The Builder's entities are unknown at fold time -- they live in the
      // `dynamic_*` tables -- so this is the same rule run once they are
      // readable, at the runtime boot and on the CLI.
      const err = collisionError(() =>
        assertRegisteredKeepTheirKind(cfg({ collections: [coll("shared")] }), {
          singles: [{ slug: "shared" }],
        })
      );
      expect(err.logContext?.reason).toBe("slug-collision");
      expect(err.logContext?.owners).toEqual([
        "code (collection)",
        "registered (single)",
      ]);

      collisionError(() =>
        assertRegisteredKeepTheirKind(cfg({ singles: [single("shared")] }), {
          collections: [{ slug: "shared" }],
        })
      );
    });

    it("says nothing about a registered entity of the SAME kind, which is that entity's own row", () => {
      // The control, twice over: a code-first entity IS a registry row, so
      // refusing a same-kind pair would refuse every boot that has one -- and
      // an unrelated Builder entity is no one's business.
      expect(() =>
        assertRegisteredKeepTheirKind(cfg({ collections: [coll("posts")] }), {
          collections: [{ slug: "posts" }],
          singles: [{ slug: "homepage" }],
          components: [{ slug: "hero" }],
        })
      ).not.toThrow();
    });

    it("leaves a code-vs-code clash across kinds to defineConfig (G2 -- plugin-free path unchanged)", () => {
      expect(() =>
        applyPluginSchemaContributions(
          cfg({ collections: [coll("shared")], singles: [single("shared")] }),
          []
        )
      ).not.toThrow();
    });
  });

  it("does NOT newly throw on pre-existing code-vs-code duplicate slugs (G2 — plugin-free path unchanged)", () => {
    expect(() =>
      applyPluginSchemaContributions(
        cfg({ collections: [coll("dup"), coll("dup")] }),
        []
      )
    ).not.toThrow();
  });
});

const field = (name: string): FieldConfig =>
  ({ name, type: "text" }) as unknown as FieldConfig;
const collWith = (slug: string, ...names: string[]): CollectionConfig =>
  ({ slug, fields: names.map(field) }) as unknown as CollectionConfig;
const fieldNames = (
  entity: { fields?: { name?: string }[] } | undefined
): string[] => (entity?.fields ?? []).map(f => f.name ?? "");

describe("applyPluginSchemaContributions — contributes.extend", () => {
  const extendError = (fn: () => unknown): NextlyError => {
    try {
      fn();
    } catch (err) {
      return err as NextlyError;
    }
    throw new Error("expected applyPluginSchemaContributions to throw");
  };

  it("appends extend fields to the target collection", () => {
    const result = applyPluginSchemaContributions(
      cfg({ collections: [collWith("posts", "title")] }),
      [
        plugin("@t/seo", {
          extend: [{ target: "posts", fields: [field("seoTitle")] }],
        }),
      ]
    );
    const posts = (result.collections ?? []).find(c => c.slug === "posts");
    expect(fieldNames(posts)).toEqual(["title", "seoTitle"]);
  });

  it("applies an array target to each listed entity", () => {
    const result = applyPluginSchemaContributions(
      cfg({
        collections: [collWith("posts", "title"), collWith("pages", "title")],
      }),
      [
        plugin("@t/seo", {
          extend: [{ target: ["posts", "pages"], fields: [field("seoTitle")] }],
        }),
      ]
    );
    expect(
      fieldNames((result.collections ?? []).find(c => c.slug === "posts"))
    ).toContain("seoTitle");
    expect(
      fieldNames((result.collections ?? []).find(c => c.slug === "pages"))
    ).toContain("seoTitle");
  });

  it("can extend a collection contributed by an earlier plugin", () => {
    const result = applyPluginSchemaContributions(cfg({}), [
      plugin("@t/forms", { collections: [collWith("forms", "name")] }),
      plugin("@t/seo", {
        extend: [{ target: "forms", fields: [field("seoTitle")] }],
      }),
    ]);
    expect(
      fieldNames((result.collections ?? []).find(c => c.slug === "forms"))
    ).toEqual(["name", "seoTitle"]);
  });

  it("does not mutate the input target entity", () => {
    const posts = collWith("posts", "title");
    applyPluginSchemaContributions(cfg({ collections: [posts] }), [
      plugin("@t/seo", {
        extend: [{ target: "posts", fields: [field("seoTitle")] }],
      }),
    ]);
    expect(fieldNames(posts)).toEqual(["title"]); // original untouched
  });

  it("(eager fold) throws NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN for a target absent from code/plugin (Builder targets use the deferring fold instead — P8)", () => {
    const err = extendError(() =>
      applyPluginSchemaContributions(
        cfg({ collections: [collWith("posts", "title")] }),
        [
          plugin("@t/seo", {
            extend: [{ target: "ghost", fields: [field("x")] }],
          }),
        ]
      )
    );
    expect(err.code).toBe("NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN");
    expect(err.logContext?.reason).toBe("extend-target-unknown");
    expect(err.logContext?.target).toBe("ghost");
  });
});

describe("applyPluginSchemaContributions — extend field collisions", () => {
  const caught = (fn: () => unknown): NextlyError => {
    try {
      fn();
    } catch (err) {
      return err as NextlyError;
    }
    throw new Error("expected applyPluginSchemaContributions to throw");
  };

  it("throws when extend adds a field already on the target", () => {
    const err = caught(() =>
      applyPluginSchemaContributions(
        cfg({ collections: [collWith("posts", "title")] }),
        [
          plugin("@t/seo", {
            extend: [{ target: "posts", fields: [field("title")] }],
          }),
        ]
      )
    );
    expect(err.code).toBe("NEXTLY_SCHEMA_EXTEND_FIELD_DUPLICATE");
    expect(err.logContext?.reason).toBe("extend-field-duplicate");
    expect(err.logContext?.field).toBe("title");
    expect(err.logContext?.target).toBe("posts");
  });

  it("throws when two plugins extend the same target with the same field", () => {
    const err = caught(() =>
      applyPluginSchemaContributions(
        cfg({ collections: [collWith("posts", "title")] }),
        [
          plugin("@t/a", {
            extend: [{ target: "posts", fields: [field("seoTitle")] }],
          }),
          plugin("@t/b", {
            extend: [{ target: "posts", fields: [field("seoTitle")] }],
          }),
        ]
      )
    );
    expect(err.code).toBe("NEXTLY_SCHEMA_EXTEND_FIELD_DUPLICATE");
    expect(err.logContext?.field).toBe("seoTitle");
  });
});

const relField = (name: string, relationTo: string): FieldConfig =>
  ({ name, type: "relationship", relationTo }) as unknown as FieldConfig;
const groupField = (name: string, fields: FieldConfig[]): FieldConfig =>
  ({ name, type: "group", fields }) as unknown as FieldConfig;
const collFields = (slug: string, fields: FieldConfig[]): CollectionConfig =>
  ({ slug, fields }) as unknown as CollectionConfig;
const renamingPlugin = (
  name: string,
  contributes: PluginContributions,
  renameMap: Record<string, string>
): PluginDefinition => ({ ...plugin(name, contributes), renameMap });
const relationTo = (
  entity: { fields?: { relationTo?: string }[] } | undefined
) => entity?.fields?.[0]?.relationTo;

describe("applyPluginSchemaContributions — renames", () => {
  const renameError = (fn: () => unknown): NextlyError => {
    try {
      fn();
    } catch (err) {
      return err as NextlyError;
    }
    throw new Error("expected applyPluginSchemaContributions to throw");
  };

  it("renames a contributed collection slug in the merged config", () => {
    const result = applyPluginSchemaContributions(cfg({}), [
      renamingPlugin(
        "@t/fb",
        { collections: [coll("forms")] },
        {
          forms: "contact-forms",
        }
      ),
    ]);
    expect(slugs(result.collections)).toEqual(["contact-forms"]);
  });

  it("rewrites the plugin's own relationTo to the renamed slug", () => {
    const result = applyPluginSchemaContributions(cfg({}), [
      renamingPlugin(
        "@t/fb",
        {
          collections: [
            coll("forms"),
            collFields("submissions", [relField("form", "forms")]),
          ],
        },
        { forms: "contact-forms" }
      ),
    ]);
    const submissions = (result.collections ?? []).find(
      c => c.slug === "submissions"
    );
    expect(relationTo(submissions)).toBe("contact-forms");
  });

  it("rewrites a relationTo nested inside a group/repeater container field", () => {
    const result = applyPluginSchemaContributions(cfg({}), [
      renamingPlugin(
        "@t/fb",
        {
          collections: [
            coll("forms"),
            collFields("submissions", [
              groupField("settings", [relField("form", "forms")]),
            ]),
          ],
        },
        { forms: "contact-forms" }
      ),
    ]);
    const submissions = (result.collections ?? []).find(
      c => c.slug === "submissions"
    ) as unknown as {
      fields: { fields?: { relationTo?: string }[] }[];
    };
    expect(submissions.fields[0].fields?.[0]?.relationTo).toBe("contact-forms");
  });

  it("does not rewrite a relationTo pointing at a non-renamed slug", () => {
    const result = applyPluginSchemaContributions(
      cfg({ collections: [coll("posts")] }),
      [
        renamingPlugin(
          "@t/fb",
          {
            collections: [
              coll("forms"),
              collFields("submissions", [relField("post", "posts")]),
            ],
          },
          { forms: "contact-forms" }
        ),
      ]
    );
    const submissions = (result.collections ?? []).find(
      c => c.slug === "submissions"
    );
    expect(relationTo(submissions)).toBe("posts");
  });

  it("throws NEXTLY_SCHEMA_RENAME_UNKNOWN_TARGET for a renameMap key the plugin does not contribute", () => {
    const err = renameError(() =>
      applyPluginSchemaContributions(cfg({}), [
        renamingPlugin(
          "@t/fb",
          { collections: [coll("forms")] },
          {
            ghost: "x",
          }
        ),
      ])
    );
    expect(err.code).toBe("NEXTLY_SCHEMA_RENAME_UNKNOWN_TARGET");
    expect(err.logContext?.reason).toBe("rename-unknown-target");
  });
});

describe("applyPluginSchemaContributionsDeferred — defers Builder targets", () => {
  it("does not throw on an extend target absent from code+plugin; collects it as deferred", () => {
    const { config, deferredExtends } = applyPluginSchemaContributionsDeferred(
      cfg({ collections: [collWith("posts", "title")] }),
      [
        plugin("@t/seo", {
          extend: [
            { target: "posts", fields: [field("seoTitle")] }, // code target → applied in-place
            { target: "pages", fields: [field("metaTitle")] }, // builder target → deferred
          ],
        }),
      ]
    );
    expect(
      fieldNames((config.collections ?? []).find(c => c.slug === "posts"))
    ).toEqual(["title", "seoTitle"]);
    expect(deferredExtends).toEqual([
      { target: "pages", fields: [field("metaTitle")], owner: "@t/seo" },
    ]);
  });

  it("returns no deferred extends when every target resolves to code/plugin", () => {
    const { deferredExtends } = applyPluginSchemaContributionsDeferred(
      cfg({ collections: [collWith("posts", "title")] }),
      [
        plugin("@t/seo", {
          extend: [{ target: "posts", fields: [field("seoTitle")] }],
        }),
      ]
    );
    expect(deferredExtends).toEqual([]);
  });

  it("merges code + plugin collections exactly like the throwing fold", () => {
    const config = cfg({ collections: [coll("code-posts")] });
    const plugins = [plugin("@t/a", { collections: [coll("a-forms")] })];
    const { config: deferred } = applyPluginSchemaContributionsDeferred(
      config,
      plugins
    );
    const eager = applyPluginSchemaContributions(config, plugins);
    expect(slugs(deferred.collections)).toEqual(slugs(eager.collections));
  });
});

describe("resolveBuilderExtends — applies deferred extends to Builder entities", () => {
  const builderColl = (slug: string, ...names: string[]) => ({
    slug,
    fields: names.map(field),
  });
  const caught = (fn: () => unknown): NextlyError => {
    try {
      fn();
    } catch (err) {
      return err as NextlyError;
    }
    throw new Error("expected resolveBuilderExtends to throw");
  };

  it("appends deferred extend fields to the matching Builder collection", () => {
    const out = resolveBuilderExtends(
      [{ target: "pages", fields: [field("metaTitle")], owner: "@t/seo" }],
      {
        collections: [builderColl("pages", "title")],
        singles: [],
        components: [],
      }
    );
    expect(fieldNames(out.collections?.find(c => c.slug === "pages"))).toEqual([
      "title",
      "metaTitle",
    ]);
  });

  it("tags merged Builder fields as source:plugin/owner/locked (migrate parity)", () => {
    const out = resolveBuilderExtends(
      [
        {
          target: "articles",
          fields: [field("metaTitle")],
          owner: "@acme/seo",
        },
      ],
      {
        collections: [builderColl("articles", "title")],
        singles: [],
        components: [],
      }
    );
    const meta = out.collections
      ?.find(c => c.slug === "articles")
      ?.fields?.find(f => (f as { name?: string }).name === "metaTitle");
    expect(meta).toMatchObject({
      source: "plugin",
      owner: "@acme/seo",
      locked: true,
    });
  });

  it("throws NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN when neither code/plugin nor Builder has the target", () => {
    const err = caught(() =>
      resolveBuilderExtends(
        [{ target: "ghost", fields: [field("x")], owner: "@t/seo" }],
        {
          collections: [builderColl("pages", "title")],
          singles: [],
          components: [],
        }
      )
    );
    expect(err.code).toBe("NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN");
    expect(err.logContext?.target).toBe("ghost");
  });

  it("does not mutate the input Builder entity", () => {
    const pages = builderColl("pages", "title");
    resolveBuilderExtends(
      [{ target: "pages", fields: [field("metaTitle")], owner: "@t/seo" }],
      { collections: [pages], singles: [], components: [] }
    );
    expect(fieldNames(pages)).toEqual(["title"]);
  });
});

describe("finalizeDeferredExtendTargets — runtime existence check", () => {
  const caught = (fn: () => unknown): NextlyError => {
    try {
      fn();
    } catch (err) {
      return err as NextlyError;
    }
    throw new Error("expected finalizeDeferredExtendTargets to throw");
  };

  it("passes when every deferred target is a known (Builder) slug", () => {
    expect(() =>
      finalizeDeferredExtendTargets(
        [{ target: "pages", fields: [field("metaTitle")], owner: "@t/seo" }],
        ["pages", "posts"]
      )
    ).not.toThrow();
  });

  it("throws NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN for a target absent from the known set", () => {
    const err = caught(() =>
      finalizeDeferredExtendTargets(
        [{ target: "ghost", fields: [field("x")], owner: "@t/seo" }],
        ["pages"]
      )
    );
    expect(err.code).toBe("NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN");
    expect(err.logContext?.target).toBe("ghost");
  });

  it("does NOT re-append fields (existence-only — the DB row is authoritative)", () => {
    // No return value; it only validates. A target whose column already exists
    // in the DB must NOT raise a duplicate-field error here.
    expect(() =>
      finalizeDeferredExtendTargets(
        [{ target: "pages", fields: [field("metaTitle")], owner: "@t/seo" }],
        ["pages"]
      )
    ).not.toThrow();
  });
});
