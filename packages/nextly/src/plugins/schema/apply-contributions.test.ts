import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import type { CollectionConfig } from "../../collections/config/define-collection";
import type { FieldConfig } from "../../collections/fields/types";
import type { ComponentConfig } from "../../components/config/types";
import type { NextlyServiceConfig } from "../../di/register";
import type { SingleConfig } from "../../singles/config/types";
import type { PluginContributions } from "../contributions";
import type { PluginDefinition } from "../plugin-context";

import { applyPluginSchemaContributions } from "./apply-contributions";

// Minimal entity builders — the fold only reads `.slug`, so partial casts are fine.
const coll = (slug: string): CollectionConfig =>
  ({ slug, fields: [] }) as unknown as CollectionConfig;
const single = (slug: string): SingleConfig =>
  ({ slug, fields: [] }) as unknown as SingleConfig;
const comp = (slug: string): ComponentConfig =>
  ({ slug, fields: [] }) as unknown as ComponentConfig;

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
  it("appends each plugin's contributes.{collections,singles,components}, config-first then plugin order", () => {
    const config = cfg({
      collections: [coll("code-posts")],
      singles: [single("code-settings")],
      components: [comp("code-hero")],
    });
    const plugins = [
      plugin("plugin-a", {
        collections: [coll("a-forms")],
        singles: [single("a-single")],
        components: [comp("a-comp")],
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
    expect(slugs(result.components)).toEqual(["code-hero", "a-comp"]);
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

  it("still contributes schema for disabled plugins (D49)", () => {
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

  it("does NOT treat a collection and a single sharing a slug as a collision (separate namespaces)", () => {
    expect(() =>
      applyPluginSchemaContributions(cfg({}), [
        plugin("plugin-a", {
          collections: [coll("shared")],
          singles: [single("shared")],
        }),
      ])
    ).not.toThrow();
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

describe("applyPluginSchemaContributions — contributes.extend (D12)", () => {
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

  it("throws NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN for an unknown/builder-only target", () => {
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

describe("applyPluginSchemaContributions — extend field collisions (D13)", () => {
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

describe("applyPluginSchemaContributions — renames (D54)", () => {
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
