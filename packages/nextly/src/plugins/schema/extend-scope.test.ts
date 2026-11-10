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
