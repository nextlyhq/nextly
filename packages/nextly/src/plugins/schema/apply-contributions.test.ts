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
  enabled = true,
  dependsOn: string[] = []
): PluginDefinition => ({
  name,
  version: "1.0.0",
  nextly: ">=0.0.0",
  enabled,
  contributes,
  ...(dependsOn.length > 0
    ? { dependsOn: Object.fromEntries(dependsOn.map(on => [on, "*"])) }
    : {}),
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

    it("throws when a plugin named `code` takes an app single's slug", () => {
      // The app's claims are told apart from a plugin's by what they are, not
      // by a name a plugin could also take.
      const err = collisionError(() =>
        applyPluginSchemaContributions(cfg({ singles: [single("shared")] }), [
          plugin("code", { collections: [coll("shared")] }),
        ])
      );
      expect(err.logContext?.reason).toBe("slug-collision");
      expect(err.logContext?.slug).toBe("shared");
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

/**
 * The wiring, not the module.
 *
 * `entity-transforms.ts` was written once with no `transforms` key to supply
 * it and no caller to run it, and was deleted for exactly that reason. A test
 * that calls `runEntityTransforms` directly would have passed the whole time
 * it was dead code, so these go through the fold — the one point every
 * runtime and CLI path reaches.
 */
describe("applyPluginSchemaContributions (transforms — C11)", () => {
  it("runs a plugin's transform over ANOTHER plugin's collection", () => {
    // The gap `extend` cannot close: adding fields to someone else's
    // collection was always possible, changing one was not, because
    // `setup(config)` runs before the merge and never sees it.
    const config = cfg({ collections: [] });
    const plugins = [
      plugin("plugin-a", { collections: [coll("a-forms")] }),
      plugin(
        "plugin-b",
        {
          transforms: [
            {
              target: "a-forms",
              transform: entity => ({ ...entity, internal: true }),
            },
          ],
        },
        true,
        ["plugin-a"]
      ),
    ];

    const result = applyPluginSchemaContributions(config, plugins);

    expect(result.collections?.[0]).toMatchObject({
      slug: "a-forms",
      internal: true,
    });
  });

  it("refuses a transform naming an entity nothing declares", () => {
    // Doing nothing silently means the plugin appears installed and simply
    // has no effect, which is the hardest kind of "working" to diagnose.
    const plugins = [
      plugin("plugin-b", {
        transforms: [{ target: "nope", transform: e => e }],
      }),
    ];

    expect(() =>
      applyPluginSchemaContributions(cfg({ collections: [] }), plugins)
    ).toThrow(NextlyError);
  });

  it("hands each transform a FROZEN definition", () => {
    // Mutating instead of returning would make the result depend on whether a
    // later transform read a field before or after an earlier one wrote it —
    // an ordering invisible in the config, so the bug would present as a
    // plugin that works until another is installed.
    let frozen: boolean | undefined;
    const plugins = [
      plugin("plugin-a", { collections: [coll("a-forms")] }),
      plugin(
        "plugin-b",
        {
          transforms: [
            {
              target: "a-forms",
              transform: entity => {
                frozen = Object.isFrozen(entity);
                return { ...entity };
              },
            },
          ],
        },
        true,
        ["plugin-a"]
      ),
    ];

    applyPluginSchemaContributions(cfg({ collections: [] }), plugins);

    expect(frozen).toBe(true);
  });

  it("leaves the arrays untouched when no plugin declares one", () => {
    // The control: the fold runs on every path, so a transform step that
    // rebuilt the entity arrays unconditionally would churn them for every
    // config that has no transforms at all.
    const collections = [coll("a-forms")];
    const result = applyPluginSchemaContributions(cfg({ collections }), []);

    expect(result.collections?.[0]).toBe(collections[0]);
  });
});

/**
 * A disabled plugin keeps its storage and runs none of its behaviour. A
 * transform can carry both at once, so a disabled plugin's transform still
 * runs — turning a plugin off must not change a table — and every function it
 * sets is put back to what the entity had.
 */
describe("applyPluginSchemaContributions (a disabled plugin's transforms)", () => {
  const existingHook = (): void => undefined;
  const pluginHook = (): void => undefined;
  const pluginValidate = (): true => true;

  /** `a-forms`, owned by plugin-a, with a hook the app already relies on. */
  const owner = () =>
    plugin("plugin-a", {
      collections: [
        {
          slug: "a-forms",
          fields: [{ name: "title", type: "text" }],
          hooks: { beforeChange: [existingHook] },
        } as unknown as CollectionConfig,
      ],
    });

  /** plugin-b's transform: adds a validated field, swaps the hooks. */
  const transformer = (enabled: boolean) =>
    plugin(
      "plugin-b",
      {
        transforms: [
          {
            target: "a-forms",
            transform: entity => ({
              ...entity,
              fields: [
                ...((entity.fields as unknown[]) ?? []),
                { name: "flag", type: "checkbox", validate: pluginValidate },
              ],
              hooks: { beforeChange: [pluginHook] },
            }),
          },
        ],
      },
      enabled,
      ["plugin-a"]
    );

  const formsOf = (enabled: boolean) =>
    applyPluginSchemaContributions(cfg({ collections: [] }), [
      owner(),
      transformer(enabled),
    ]).collections?.[0] as unknown as {
      fields: { name: string; validate?: unknown }[];
      hooks?: { beforeChange?: unknown[] };
    };

  it("keeps the field it adds, so disabling the plugin changes no table", () => {
    expect(formsOf(false).fields.map(f => f.name)).toEqual(["title", "flag"]);
  });

  it("drops the behaviour it adds and restores the behaviour it replaces", () => {
    const forms = formsOf(false);
    expect(forms.fields[1]).not.toHaveProperty("validate");
    expect(forms.hooks?.beforeChange).toEqual([existingHook]);
  });

  it("applies everything when the plugin is enabled", () => {
    // The control: the stripping is the disabled plugin's, not the fold's.
    const forms = formsOf(true);
    expect(forms.fields[1]?.validate).toBe(pluginValidate);
    expect(forms.hooks?.beforeChange).toEqual([pluginHook]);
  });
});

describe("applyPluginSchemaContributions (behaviour a disabled plugin's transform removes)", () => {
  const h1 = (): void => undefined;
  const h2 = (): void => undefined;
  const readRule = (): boolean => false;

  const owner = () =>
    plugin("plugin-a", {
      collections: [
        {
          slug: "a-forms",
          fields: [{ name: "title", type: "text" }],
          hooks: { beforeChange: [h1, h2] },
          access: { read: readRule },
        } as unknown as CollectionConfig,
      ],
    });

  const disabledTransform = (
    change: (entity: Record<string, unknown>) => Record<string, unknown>
  ) =>
    applyPluginSchemaContributions(cfg({ collections: [] }), [
      owner(),
      plugin(
        "plugin-b",
        { transforms: [{ target: "a-forms", transform: change }] },
        false,
        ["plugin-a"]
      ),
    ]).collections?.[0] as unknown as {
      hooks?: { beforeChange?: unknown[] };
      access?: { read?: unknown };
      fields: Record<string, unknown>[];
    };

  it("restores a hook list it emptied", () => {
    const forms = disabledTransform(entity => ({
      ...entity,
      hooks: { beforeChange: [] },
    }));
    expect(forms.hooks?.beforeChange).toEqual([h1, h2]);
  });

  it("restores a hook list it removed one entry from, not the entries shifted", () => {
    const forms = disabledTransform(entity => ({
      ...entity,
      hooks: { beforeChange: [h2] },
    }));
    expect(forms.hooks?.beforeChange).toEqual([h1, h2]);
  });

  it("keeps an access rule it replaced with a boolean", () => {
    // `read: true` opens reads as surely as a function would.
    const forms = disabledTransform(entity => ({
      ...entity,
      access: { read: true },
    }));
    expect(forms.access?.read).toBe(readRule);
  });

  it("keeps a function-bearing value it replaced with a value of another kind", () => {
    // A components map turned into a string: nothing in the string pairs with
    // the function the map held, so merging them kept none of it.
    const Field = (): null => null;
    const forms = applyPluginSchemaContributions(cfg({ collections: [] }), [
      plugin("plugin-a", {
        collections: [
          {
            slug: "a-forms",
            fields: [{ name: "title", type: "text" }],
            admin: { components: { Field } },
          } as unknown as CollectionConfig,
        ],
      }),
      plugin(
        "plugin-b",
        {
          transforms: [
            {
              target: "a-forms",
              transform: entity => ({
                ...entity,
                admin: { components: "none" },
              }),
            },
          ],
        },
        false,
        ["plugin-a"]
      ),
    ]).collections?.[0] as unknown as {
      admin: { components: unknown };
    };
    expect(forms.admin.components).toEqual({ Field });
  });

  it("keeps a key named `access` in ordinary data, such as a JSON default", () => {
    // Only the entity's and its fields' `access` are access rules. A JSON
    // default's `access` is data, and the structure a disabled transform
    // writes stands.
    const forms = disabledTransform(entity => ({
      ...entity,
      fields: [
        {
          name: "title",
          type: "text",
          defaultValue: { access: "public", n: 2 },
        },
      ],
    }));
    expect(forms.fields[0]?.defaultValue).toEqual({ access: "public", n: 2 });
  });

  it("adds no access rule to a field nested under a key other than `fields` or `blocks`", () => {
    // Every key but the data keys is schema, so an access rule restores
    // wherever a layout nests its fields, not only in `fields` and `blocks`.
    const forms = disabledTransform(entity => ({
      ...entity,
      // Beside plugin-a's own field, which the transform keeps: only the
      // plugin that declared a field may remove it.
      fields: [
        ...(entity.fields as unknown[]),
        {
          name: "layout",
          type: "group",
          // A group must declare `fields`; this one's fields nest under
          // `tabs` instead.
          fields: [],
          tabs: [
            {
              label: "Main",
              fields: [{ name: "note", type: "text", access: { read: false } }],
            },
          ],
        },
      ],
    }));
    const layout = forms.fields[1] as {
      tabs: { fields: Record<string, unknown>[] }[];
    };
    expect(layout.tabs[0]?.fields[0]).toEqual({ name: "note", type: "text" });
  });

  it("keeps a property named `access` in a JSON field's schema", () => {
    // `jsonSchema.properties` maps property names to their schemas: a
    // property called `access` is the author's data, not an access rule.
    const forms = disabledTransform(entity => ({
      ...entity,
      // Beside plugin-a's own field, which the transform keeps: only the
      // plugin that declared a field may remove it.
      fields: [
        ...(entity.fields as unknown[]),
        {
          name: "meta",
          type: "json",
          jsonSchema: {
            type: "object",
            properties: { access: { type: "string" } },
          },
        },
      ],
    }));
    expect(forms.fields[1]?.jsonSchema).toEqual({
      type: "object",
      properties: { access: { type: "string" } },
    });
  });

  it("keeps a query on a field named `access` in a relationship's filterOptions", () => {
    const forms = disabledTransform(entity => ({
      ...entity,
      // Beside plugin-a's own field, which the transform keeps: only the
      // plugin that declared a field may remove it.
      fields: [
        ...(entity.fields as unknown[]),
        {
          name: "owner",
          type: "relationship",
          relationTo: "users",
          filterOptions: { access: { equals: "public" } },
        },
      ],
    }));
    expect(forms.fields[1]?.filterOptions).toEqual({
      access: { equals: "public" },
    });
  });

  it("keeps a sort for a collection named `access` in a relationship's sortOptions", () => {
    const forms = disabledTransform(entity => ({
      ...entity,
      // Beside plugin-a's own field, which the transform keeps: only the
      // plugin that declared a field may remove it.
      fields: [
        ...(entity.fields as unknown[]),
        {
          name: "owner",
          type: "relationship",
          relationTo: ["users", "access"],
          admin: { sortOptions: { access: "name" } },
        },
      ],
    }));
    expect(
      (forms.fields[1]?.admin as { sortOptions: unknown }).sortOptions
    ).toEqual({ access: "name" });
  });

  it("keeps a field's access rule when a tab is inserted before the tab holding it", () => {
    // Tabs have no name. Paired by position, the inserted tab took the
    // original's place, the original's field read as new, and its access
    // rule as one the transform added, so it was stripped and the field
    // opened.
    const rule = { read: () => false };
    const tabs = (fields: unknown[]) => [
      { name: "layout", type: "group", tabs: fields },
    ];
    const forms = applyPluginSchemaContributions(
      cfg({
        // The app's own entity: a plugin reshaping the app's fields is what
        // transforms are for, where another plugin's fields stay its own.
        collections: [
          {
            slug: "a-forms",
            fields: tabs([
              {
                label: "Main",
                fields: [{ name: "secret", type: "text", access: rule }],
              },
            ]),
          } as unknown as CollectionConfig,
        ],
      }),
      [
        plugin(
          "plugin-b",
          {
            transforms: [
              {
                target: "a-forms",
                transform: entity => {
                  const [layout] = entity.fields as { tabs: unknown[] }[];
                  return {
                    ...entity,
                    fields: tabs([
                      {
                        label: "Extra",
                        fields: [{ name: "note", type: "text" }],
                      },
                      ...(layout?.tabs ?? []),
                    ]),
                  };
                },
              },
            ],
          },
          false
        ),
      ]
    ).collections?.[0] as unknown as {
      fields: { tabs: { fields: Record<string, unknown>[] }[] }[];
    };
    expect(forms.fields[0]?.tabs[1]?.fields[0]?.access).toBe(rule);
    expect(forms.fields[0]?.tabs[0]?.fields[0]).not.toHaveProperty("access");
  });

  it("keeps a field's access rule when the transform moves it into another group", () => {
    const rule = { read: () => false };
    const forms = applyPluginSchemaContributions(
      cfg({
        // The app's own entity: a plugin reshaping the app's fields is what
        // transforms are for, where another plugin's fields stay its own.
        collections: [
          {
            slug: "a-forms",
            fields: [
              {
                name: "a",
                type: "group",
                fields: [{ name: "secret", type: "text", access: rule }],
              },
              { name: "b", type: "group", fields: [] },
            ],
          } as unknown as CollectionConfig,
        ],
      }),
      [
        plugin(
          "plugin-b",
          {
            transforms: [
              {
                target: "a-forms",
                transform: entity => {
                  const [a, b] = entity.fields as {
                    name: string;
                    fields: unknown[];
                  }[];
                  return {
                    ...entity,
                    fields: [
                      { ...a, fields: [] },
                      { ...b, fields: a?.fields ?? [] },
                    ],
                  };
                },
              },
            ],
          },
          false
        ),
      ]
    ).collections?.[0] as unknown as {
      fields: { fields: Record<string, unknown>[] }[];
    };
    expect(forms.fields[1]?.fields[0]?.access).toBe(rule);
  });

  it("keeps a key named `access` in a plugin field type's own options", () => {
    // A plugin's field type may carry options of its own on the field; their
    // content is the plugin's data.
    const forms = disabledTransform(entity => ({
      ...entity,
      // Beside plugin-a's own field, which the transform keeps: only the
      // plugin that declared a field may remove it.
      fields: [
        ...(entity.fields as unknown[]),
        {
          name: "rating",
          type: "stars",
          presentation: { access: "public", size: 5 },
        },
      ],
    }));
    expect(forms.fields[1]?.presentation).toEqual({
      access: "public",
      size: 5,
    });
  });

  it("keeps a key named `access` in a field's pluginOptions", () => {
    const forms = disabledTransform(entity => ({
      ...entity,
      fields: [
        {
          name: "title",
          type: "text",
          pluginOptions: { seo: { access: "public" } },
        },
      ],
    }));
    expect(forms.fields[0]?.pluginOptions).toEqual({
      seo: { access: "public" },
    });
  });

  it("adds no field access rule, boolean or function", () => {
    const forms = disabledTransform(entity => ({
      ...entity,
      fields: [
        ...((entity.fields as unknown[]) ?? []),
        { name: "flag", type: "checkbox", access: { read: false } },
      ],
    }));
    expect(forms.fields.map(f => f.name)).toEqual(["title", "flag"]);
    expect(forms.fields[1]).not.toHaveProperty("access");
  });
});

describe("applyPluginSchemaContributions (a transform naming a Builder entity)", () => {
  it("is refused with a message that says what to use instead", () => {
    // A Builder slug is the one a correct-looking target most often is: it
    // exists, just not in the config transforms run over.
    let message = "";
    try {
      applyPluginSchemaContributions(cfg({ collections: [] }), [
        plugin("plugin-b", {
          transforms: [{ target: "builder-made", transform: e => e }],
        }),
      ]);
    } catch (error) {
      message =
        (error as { publicData?: { errors?: { message: string }[] } })
          .publicData?.errors?.[0]?.message ?? "";
    }
    expect(message).toContain("builder-made");
    expect(message).toMatch(/Schema Builder/);
    expect(message).toMatch(/extend/);
  });
});
