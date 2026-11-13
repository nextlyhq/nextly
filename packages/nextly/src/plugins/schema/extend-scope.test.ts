import { describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
import type { FieldConfig } from "../../collections/fields/types";
import type { NextlyServiceConfig } from "../../di/register";
import type { FieldGroupConfig } from "../../field-groups/config/types";
import type { SingleConfig } from "../../singles/config/types";
import type { ContentTypeScope } from "../content-type-scope";
import {
  builderExtensionsOf,
  publishBuilderExtensions,
  typesExtendedBy,
} from "../extended-types";
import type { PluginContributions } from "../contributions";
import type { PluginDefinition } from "../plugin-context";

import {
  applyPluginSchemaContributions,
  applyPluginSchemaContributionsDeferred,
  finalizeDeferredExtendTargets,
  resolveBuilderExtends,
} from "./apply-contributions";
import { reconcileBuilderContributions } from "./reconcile-builder-contributions";

// A plugin adding one field to every collection and Single the site defines,
// the way an SEO plugin adds its `seo` group.
const field = (name: string): FieldConfig =>
  ({ name, type: "text" }) as unknown as FieldConfig;
const collWith = (slug: string, ...names: string[]): CollectionConfig =>
  ({ slug, fields: names.map(field) }) as unknown as CollectionConfig;
const singleWith = (slug: string, ...names: string[]): SingleConfig =>
  ({ slug, fields: names.map(field) }) as unknown as SingleConfig;
const groupWith = (slug: string, ...names: string[]): FieldGroupConfig =>
  ({ slug, fields: names.map(field) }) as unknown as FieldGroupConfig;
const cfg = (partial: Partial<NextlyServiceConfig>): NextlyServiceConfig =>
  ({ imageProcessor: {}, ...partial }) as unknown as NextlyServiceConfig;
const plugin = (
  name: string,
  contributes: PluginContributions
): PluginDefinition => ({
  name,
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes,
});
const fieldNames = (
  entity: { fields?: readonly { name?: string }[] } | undefined
): string[] => (entity?.fields ?? []).map(f => f.name ?? "");
const find = <T extends { slug: string }>(
  entities: readonly T[] | undefined,
  slug: string
): T | undefined => (entities ?? []).find(e => e.slug === slug);

const EVERY: ContentTypeScope = { every: ["collection", "single"] };
const seoPlugin = (scope: ContentTypeScope = EVERY): PluginDefinition =>
  plugin("@t/seo", { extend: [{ target: scope, fields: [field("seo")] }] });
const formsPlugin = plugin("@t/forms", {
  collections: [collWith("form-submissions", "data")],
  singles: [singleWith("forms-settings", "sender")],
});

const siteConfig = (): NextlyServiceConfig =>
  cfg({
    collections: [
      collWith("posts", "title"),
      collWith("pages", "title"),
      collWith("users", "name"),
    ],
    singles: [singleWith("homepage", "headline")],
    fieldGroups: [groupWith("hero", "heading")],
  });

describe("extend with a scope — types in the configuration", () => {
  it("adds the field to every collection and Single the site defines", () => {
    const { config } = applyPluginSchemaContributionsDeferred(siteConfig(), [
      seoPlugin(),
    ]);
    expect(fieldNames(find(config.collections, "posts"))).toEqual([
      "title",
      "seo",
    ]);
    expect(fieldNames(find(config.collections, "pages"))).toEqual([
      "title",
      "seo",
    ]);
    expect(fieldNames(find(config.singles, "homepage"))).toEqual([
      "headline",
      "seo",
    ]);
  });

  it("leaves plugins' own types, Nextly's system types and field groups alone", () => {
    const { config } = applyPluginSchemaContributionsDeferred(siteConfig(), [
      formsPlugin,
      seoPlugin(),
    ]);
    expect(fieldNames(find(config.collections, "form-submissions"))).toEqual([
      "data",
    ]);
    expect(fieldNames(find(config.singles, "forms-settings"))).toEqual([
      "sender",
    ]);
    expect(fieldNames(find(config.collections, "users"))).toEqual(["name"]);
    expect(fieldNames(find(config.fieldGroups, "hero"))).toEqual(["heading"]);
    // The same fold did reach the site's own types.
    expect(fieldNames(find(config.collections, "posts"))).toEqual([
      "title",
      "seo",
    ]);
  });

  it("does not reach the plugin's own types either", () => {
    const own = plugin("@t/seo", {
      collections: [collWith("seo-redirects", "from")],
      extend: [{ target: EVERY, fields: [field("seo")] }],
    });
    const { config } = applyPluginSchemaContributionsDeferred(siteConfig(), [
      own,
    ]);
    expect(fieldNames(find(config.collections, "seo-redirects"))).toEqual([
      "from",
    ]);
    expect(fieldNames(find(config.singles, "homepage"))).toEqual([
      "headline",
      "seo",
    ]);
  });

  it("reaches a plugin's collection marked as site content", () => {
    const builder = plugin("@t/builder", {
      collections: [
        {
          ...collWith("landing", "title"),
          siteContent: true,
        } as CollectionConfig,
        collWith("layouts", "regions"),
      ],
    });
    const { config } = applyPluginSchemaContributionsDeferred(siteConfig(), [
      builder,
      seoPlugin(),
    ]);
    expect(fieldNames(find(config.collections, "landing"))).toEqual([
      "title",
      "seo",
    ]);
    // Its other collections, not marked, stay as they are.
    expect(fieldNames(find(config.collections, "layouts"))).toEqual([
      "regions",
    ]);
  });

  it("leaves out a plugin's site-content collection the scope excepts", () => {
    const builder = plugin("@t/builder", {
      collections: [
        {
          ...collWith("landing", "title"),
          siteContent: true,
        } as CollectionConfig,
      ],
    });
    const { config } = applyPluginSchemaContributionsDeferred(siteConfig(), [
      builder,
      seoPlugin({ every: ["collection", "single"], except: ["landing"] }),
    ]);
    expect(fieldNames(find(config.collections, "landing"))).toEqual(["title"]);
  });

  it("leaves out each type the scope excepts", () => {
    const { config } = applyPluginSchemaContributionsDeferred(siteConfig(), [
      seoPlugin({ every: ["collection", "single"], except: ["pages"] }),
    ]);
    expect(fieldNames(find(config.collections, "pages"))).toEqual(["title"]);
    expect(fieldNames(find(config.collections, "posts"))).toEqual([
      "title",
      "seo",
    ]);
  });

  it("leaves a type that already has a field of that name as it is, and lists it", () => {
    const config = cfg({
      collections: [collWith("posts", "title"), collWith("blog", "seo")],
    });
    const result = applyPluginSchemaContributionsDeferred(config, [
      seoPlugin(),
    ]);
    expect(fieldNames(find(result.config.collections, "blog"))).toEqual([
      "seo",
    ]);
    expect(fieldNames(find(result.config.collections, "posts"))).toEqual([
      "title",
      "seo",
    ]);
    expect(result.leftAlone).toEqual([
      { target: "blog", field: "seo", owner: "@t/seo" },
    ]);
  });

  it("applies the same way through the eager fold", () => {
    const config = applyPluginSchemaContributions(siteConfig(), [seoPlugin()]);
    expect(fieldNames(find(config.collections, "posts"))).toEqual([
      "title",
      "seo",
    ]);
    expect(fieldNames(find(config.collections, "users"))).toEqual(["name"]);
  });

  it("still refuses a slug target whose field the type already has", () => {
    expect(() =>
      applyPluginSchemaContributionsDeferred(
        cfg({ collections: [collWith("blog", "seo")] }),
        [
          plugin("@t/seo", {
            extend: [{ target: "blog", fields: [field("seo")] }],
          }),
        ]
      )
    ).toThrow();
  });
});

describe("extend with a scope — who owns what it added", () => {
  it("keeps a field a scope added as the plugin's, where another scope was left alone on the same type", () => {
    // @t/titles' scope collides with every type's `title` and is left alone
    // there; @t/seo's `seo` on the same types is still @t/seo's.
    const titles = plugin("@t/titles", {
      extend: [{ target: EVERY, fields: [field("title")] }],
    });
    // A transform, so the fold records who added which field.
    const noop = plugin("@t/noop", {
      transforms: [{ target: "posts", transform: entity => entity }],
    });
    const { fieldsAddedByPlugins, leftAlone } =
      applyPluginSchemaContributionsDeferred(siteConfig(), [
        seoPlugin(),
        titles,
        noop,
      ]);

    expect(leftAlone).toContainEqual(
      expect.objectContaining({ target: "posts", field: "title" })
    );
    const posts = fieldsAddedByPlugins.get("posts");
    expect(posts?.get("seo")).toBe("@t/seo");
    // The app's own `title`, which @t/titles left alone, is not @t/titles'.
    expect(posts?.has("title")).toBe(false);
  });
});

describe("extend with a scope — a clause left alone whole", () => {
  it("never takes a field from its real owner when a clause of several fields was left alone", () => {
    // @t/both scopes `title` and `seo` together; `title` collides, so the
    // whole clause is left alone, and `seo` stays @t/seo's.
    const both = plugin("@t/both", {
      extend: [{ target: EVERY, fields: [field("title"), field("seo")] }],
    });
    const noop = plugin("@t/noop", {
      transforms: [{ target: "posts", transform: entity => entity }],
    });
    const { fieldsAddedByPlugins } = applyPluginSchemaContributionsDeferred(
      siteConfig(),
      [seoPlugin(), both, noop]
    );

    const posts = fieldsAddedByPlugins.get("posts");
    expect(posts?.get("seo")).toBe("@t/seo");
    expect(posts?.has("title")).toBe(false);
  });
});

describe("extend with a scope — overlapping clauses of one plugin", () => {
  it("keeps a field the first clause added, when the plugin's second clause collides with it", () => {
    // @t/seo scopes `seo` onto every collection, then onto collections and
    // Singles again: on `posts` the second clause meets the first's `seo`.
    const twice = plugin("@t/seo", {
      extend: [
        { target: { every: ["collection"] }, fields: [field("seo")] },
        { target: EVERY, fields: [field("seo")] },
      ],
    });
    const noop = plugin("@t/noop", {
      transforms: [{ target: "posts", transform: entity => entity }],
    });
    const { fieldsAddedByPlugins } = applyPluginSchemaContributionsDeferred(
      siteConfig(),
      [twice, noop]
    );

    expect(fieldsAddedByPlugins.get("posts")?.get("seo")).toBe("@t/seo");
  });
});

describe("extend with a scope — the order clauses apply in", () => {
  it("defers a scope and a later slug target in the plugins' own order", () => {
    // @t/seo's scope comes first, so a Builder type receives it first, as a
    // configured type does, and a later plugin's same-named field meets it.
    const later = plugin("@t/later", {
      extend: [{ target: "articles", fields: [field("seo")] }],
    });
    const { deferredExtends } = applyPluginSchemaContributionsDeferred(
      siteConfig(),
      [seoPlugin(), later]
    );

    expect(deferredExtends.map(clause => clause.owner)).toEqual([
      "@t/seo",
      "@t/later",
    ]);
  });
});

describe("extend with a scope — Schema Builder types", () => {
  const builder = () => ({
    collections: [
      { slug: "case-studies", fields: [field("title")], source: "ui" },
      // The registry also holds the configuration's and plugins' own rows.
      { slug: "posts", fields: [field("title")], source: "code" },
      {
        slug: "old-plugin-items",
        fields: [field("name")],
        source: "plugin:@t/gone",
      },
    ],
    singles: [{ slug: "footer", fields: [field("links")], source: "ui" }],
    components: [{ slug: "card", fields: [field("label")], source: "ui" }],
  });

  it("defers the scope so the Builder's types are reached once they are known", () => {
    const { deferredExtends } = applyPluginSchemaContributionsDeferred(
      siteConfig(),
      [seoPlugin()]
    );
    const out = resolveBuilderExtends(deferredExtends, builder());
    expect(fieldNames(find(out.collections, "case-studies"))).toEqual([
      "title",
      "seo",
    ]);
    expect(fieldNames(find(out.singles, "footer"))).toEqual(["links", "seo"]);
  });

  it("does not reach the configuration's rows, plugins' rows or field groups in the registry", () => {
    const { deferredExtends } = applyPluginSchemaContributionsDeferred(
      siteConfig(),
      [seoPlugin()]
    );
    const out = reconcileBuilderContributions(deferredExtends, builder());
    expect(fieldNames(find(out.entities.collections, "posts"))).toEqual([
      "title",
    ]);
    expect(
      fieldNames(find(out.entities.collections, "old-plugin-items"))
    ).toEqual(["name"]);
    expect(fieldNames(find(out.entities.components, "card"))).toEqual([
      "label",
    ]);
    expect(fieldNames(find(out.entities.collections, "case-studies"))).toEqual([
      "title",
      "seo",
    ]);
    expect(out.unresolved).toEqual([]);
  });

  it("leaves a Builder type that already has the field as it is, and lists it", () => {
    const { deferredExtends } = applyPluginSchemaContributionsDeferred(
      siteConfig(),
      [seoPlugin()]
    );
    const out = reconcileBuilderContributions(deferredExtends, {
      collections: [{ slug: "landing", fields: [field("seo")], source: "ui" }],
      singles: [],
      components: [],
    });
    expect(fieldNames(find(out.entities.collections, "landing"))).toEqual([
      "seo",
    ]);
    expect(out.leftAlone).toEqual([
      { target: "landing", field: "seo", owner: "@t/seo" },
    ]);
  });

  it("leaves out a Builder type the scope excepts", () => {
    const { deferredExtends } = applyPluginSchemaContributionsDeferred(
      siteConfig(),
      [seoPlugin({ every: ["collection", "single"], except: ["footer"] })]
    );
    const out = resolveBuilderExtends(deferredExtends, builder());
    expect(fieldNames(find(out.singles, "footer"))).toEqual(["links"]);
    expect(fieldNames(find(out.collections, "case-studies"))).toEqual([
      "title",
      "seo",
    ]);
  });

  it("is never an unknown target, whatever the Builder holds", () => {
    const { deferredExtends } = applyPluginSchemaContributionsDeferred(
      siteConfig(),
      [seoPlugin()]
    );
    expect(() =>
      finalizeDeferredExtendTargets(deferredExtends, [])
    ).not.toThrow();
    expect(() =>
      resolveBuilderExtends(deferredExtends, {
        collections: [],
        singles: [],
        components: [],
      })
    ).not.toThrow();
  });
});

describe("extend with a scope — what a switched-off type would have had", () => {
  it("holds back each scope's field of one name, the one the fold adds first", async () => {
    const { withheldScopeFieldsOf, publishWithheldScopeFields } = await import(
      "../../domains/schema/pipeline/withheld-scope-fields"
    );
    const off: ContentTypeScope = { ...EVERY, except: ["pages"] };
    const first = plugin("@t/first", {
      extend: [{ target: off, fields: [field("seo")] }],
    });
    const second = plugin("@t/second", {
      extend: [
        {
          target: off,
          fields: [{ name: "SEO", type: "number" } as unknown as FieldConfig],
        },
      ],
    });

    // Switched on, the type has the first scope's field and not the second's.
    const on = applyPluginSchemaContributionsDeferred(siteConfig(), [
      plugin("@t/first", {
        extend: [{ target: EVERY, fields: [field("seo")] }],
      }),
      second,
    ]);
    expect(fieldNames(find(on.config.collections, "pages"))).toEqual([
      "title",
      "seo",
    ]);

    // Both declarations could have made the column, depending on which
    // scopes were off when it was made: the one the type took when on comes
    // first, and the one kept is the one the column matches.
    applyPluginSchemaContributionsDeferred(siteConfig(), [first, second]);
    expect(
      withheldScopeFieldsOf("collection", "pages").map(f => [
        (f as { name?: string }).name,
        (f as { type?: string }).type,
      ])
    ).toEqual([
      ["seo", "text"],
      ["seo", "text"],
      ["SEO", "number"],
    ]);
    publishWithheldScopeFields(new Map());
  });
});

describe("extend with a scope — what a switched-off type would have had, transformed", () => {
  it("holds back a field as the plugin's own transform left it", async () => {
    const { withheldScopeFieldsOf, publishWithheldScopeFields } = await import(
      "../../domains/schema/pipeline/withheld-scope-fields"
    );
    // The plugin renames the field it adds, so its column is `seo_data`.
    const rename = <T extends { fields?: readonly FieldConfig[] }>(entity: T) =>
      ({
        ...entity,
        fields: (entity.fields ?? []).map(f =>
          (f as { name?: string }).name === "seo"
            ? ({ ...f, name: "seo_data" } as FieldConfig)
            : f
        ),
      }) as T;
    const seo = plugin("@t/seo", {
      extend: [
        { target: { ...EVERY, except: ["pages"] }, fields: [field("seo")] },
      ],
      transforms: [
        { target: "posts", kind: "collection", transform: rename },
        { target: "pages", kind: "collection", transform: rename },
      ],
    });

    const { config } = applyPluginSchemaContributionsDeferred(siteConfig(), [
      seo,
    ]);
    expect(fieldNames(find(config.collections, "posts"))).toEqual([
      "title",
      "seo_data",
    ]);
    // The transformed field first; the clause's own `seo` after it is kept
    // only if a column of that name is there, and none is.
    expect(
      withheldScopeFieldsOf("collection", "pages").map(
        f => (f as { name?: string }).name
      )
    ).toEqual(["seo_data", "seo"]);
    publishWithheldScopeFields(new Map());
  });
});

describe("extend with a scope — a switched-off type given the field another way", () => {
  it("folds a type a scope excepts that another clause gives the same field", async () => {
    const { withheldScopeFieldsOf, publishWithheldScopeFields } = await import(
      "../../domains/schema/pipeline/withheld-scope-fields"
    );
    const seo = plugin("@t/seo", {
      extend: [
        { target: { ...EVERY, except: ["pages"] }, fields: [field("seo")] },
        { target: "pages", fields: [field("seo")] },
      ],
    });

    const { config } = applyPluginSchemaContributionsDeferred(siteConfig(), [
      seo,
    ]);
    expect(fieldNames(find(config.collections, "pages"))).toEqual([
      "title",
      "seo",
    ]);
    // The type declares the field itself, so nothing of it is kept apart.
    expect(
      withheldScopeFieldsOf("collection", "pages").filter(
        f => (f as { name?: string }).name !== "seo"
      )
    ).toEqual([]);
    publishWithheldScopeFields(new Map());
  });
});

describe("extend with a scope — an except naming a type the scope never reaches", () => {
  it("holds nothing back from a Single a collections-only scope excepts", async () => {
    const { withheldScopeFieldsOf, publishWithheldScopeFields } = await import(
      "../../domains/schema/pipeline/withheld-scope-fields"
    );
    applyPluginSchemaContributionsDeferred(siteConfig(), [
      seoPlugin({ every: ["collection"], except: ["homepage", "pages"] }),
    ]);

    expect(withheldScopeFieldsOf("single", "homepage")).toEqual([]);
    // A collection it excepts is still held back.
    expect(
      withheldScopeFieldsOf("collection", "pages").map(
        f => (f as { name?: string }).name
      )
    ).toContain("seo");
    publishWithheldScopeFields(new Map());
  });
});

describe("extend — which types each plugin's field was added to", () => {
  it("lists the configured types a scope added the field to, not one it left alone", () => {
    const config = siteConfig();
    config.collections = [
      ...(config.collections ?? []),
      collWith("legacy", "title", "seo"),
    ];
    publishBuilderExtensions(new Map());
    applyPluginSchemaContributionsDeferred(config, [formsPlugin, seoPlugin()]);
    expect(typesExtendedBy("@t/seo", "seo")).toEqual([
      { kind: "collection", slug: "posts" },
      { kind: "collection", slug: "pages" },
      { kind: "single", slug: "homepage" },
    ]);
    // Asked by another plugin's name, or of another field, it lists none.
    expect(typesExtendedBy("@t/forms", "seo")).toEqual([]);
    expect(typesExtendedBy("@t/seo", "title")).toEqual([]);
  });

  it("lists the types a slug target names", () => {
    publishBuilderExtensions(new Map());
    applyPluginSchemaContributionsDeferred(siteConfig(), [
      plugin("@t/notes", {
        extend: [{ target: ["posts", "homepage"], fields: [field("note")] }],
      }),
    ]);
    expect(typesExtendedBy("@t/notes", "note")).toEqual([
      { kind: "collection", slug: "posts" },
      { kind: "single", slug: "homepage" },
    ]);
  });

  it("forgets a type the next fold no longer adds the field to", () => {
    publishBuilderExtensions(new Map());
    applyPluginSchemaContributionsDeferred(siteConfig(), [seoPlugin()]);
    applyPluginSchemaContributionsDeferred(siteConfig(), [
      seoPlugin({ every: ["collection", "single"], except: ["posts"] }),
    ]);
    // The type still reached stays listed, so the absence is posts' own.
    expect(typesExtendedBy("@t/seo", "seo")).toEqual([
      { kind: "collection", slug: "pages" },
      { kind: "single", slug: "homepage" },
    ]);
  });

  it("adds the Builder types the Builder pass gave the field, after the configured ones", () => {
    const { deferredExtends } = applyPluginSchemaContributionsDeferred(
      siteConfig(),
      [seoPlugin()]
    );
    const { entities } = reconcileBuilderContributions(deferredExtends, {
      collections: [
        { slug: "products", fields: [field("name")], source: "ui" },
        { slug: "faq", fields: [field("seo")], source: "ui" },
      ],
      singles: [],
      components: [],
    });
    publishBuilderExtensions(builderExtensionsOf(entities));
    const types = typesExtendedBy("@t/seo", "seo");
    expect(types).toContainEqual({ kind: "collection", slug: "products" });
    // A Builder type with a field of its own by that name was left alone.
    expect(types).not.toContainEqual({ kind: "collection", slug: "faq" });
    expect(types.at(-1)).toEqual({ kind: "collection", slug: "products" });
  });
});
