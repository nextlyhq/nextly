import { describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
import type { FieldConfig } from "../../collections/fields/types";
import type { NextlyServiceConfig } from "../../di/register";
import type { FieldGroupConfig } from "../../field-groups/config/types";
import type { SingleConfig } from "../../singles/config/types";
import type { ContentTypeScope } from "../content-type-scope";
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
  it("holds back the first of two scopes' fields of one name, as the fold adds only that one", async () => {
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

    applyPluginSchemaContributionsDeferred(siteConfig(), [first, second]);
    expect(withheldScopeFieldsOf("collection", "pages")).toEqual([
      field("seo"),
    ]);
    publishWithheldScopeFields(new Map());
  });
});
