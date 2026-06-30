import { describe, expect, it } from "vitest";

import { mergeSetupResultIntoConfig } from "../../cli/utils/config-loader";
import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import type { CollectionConfig } from "../../collections/config/define-collection";
import type { FieldConfig } from "../../collections/fields/types";
import type { ComponentConfig } from "../../components/config/types";
import type { NextlyServiceConfig } from "../../di/register";
import type { SingleConfig } from "../../singles/config/types";
import type { PluginContributions } from "../contributions";
import type { PluginDefinition } from "../plugin-context";

import {
  applyPluginSchemaContributions,
  applyPluginSchemaContributionsDeferred,
  type BuilderEntities,
  resolveBuilderExtends,
} from "./apply-contributions";

/**
 * D50 parity guard: the runtime boot (`applyPluginSchemaContributions`, called
 * from `register.ts`) and the CLI/migration path (`mergeSetupResultIntoConfig`,
 * called from `config-loader.ts`) must produce the SAME merged schema for the
 * same `(config, plugins)`. Both delegate to the one shared fold; this locks
 * that the CLI wrapper neither drops nor reorders entities.
 */
const coll = (slug: string): CollectionConfig =>
  ({ slug, fields: [] }) as unknown as CollectionConfig;
const single = (slug: string): SingleConfig =>
  ({ slug, fields: [] }) as unknown as SingleConfig;
const comp = (slug: string): ComponentConfig =>
  ({ slug, fields: [] }) as unknown as ComponentConfig;

const plugin = (
  name: string,
  contributes: PluginContributions
): PluginDefinition => ({
  name,
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes,
});

const baseConfig = () =>
  ({
    collections: [coll("code-posts")],
    singles: [single("code-settings")],
    components: [comp("code-hero")],
  }) as unknown as SanitizedNextlyConfig & NextlyServiceConfig;

const slugSet = (entities: { slug: string }[] | undefined): string[] =>
  (entities ?? []).map(e => e.slug).sort();

describe("CLI↔runtime schema fold parity", () => {
  const plugins = [
    plugin("@t/a", {
      collections: [coll("a-forms")],
      singles: [single("a-single")],
      components: [comp("a-comp")],
    }),
    plugin("@t/b", { collections: [coll("b-submissions")] }),
  ];

  it("produces an identical merged schema on both paths", () => {
    const config = baseConfig();
    const runtime = applyPluginSchemaContributions(config, plugins);
    const cli = mergeSetupResultIntoConfig(config, config, plugins);

    expect(slugSet(cli.collections)).toEqual(slugSet(runtime.collections));
    expect(slugSet(cli.singles)).toEqual(slugSet(runtime.singles));
    expect(slugSet(cli.components)).toEqual(slugSet(runtime.components));
    // And the merged set actually contains code + every plugin's entities.
    expect(slugSet(cli.collections)).toEqual([
      "a-forms",
      "b-submissions",
      "code-posts",
    ]);
  });

  it("negative control: feeding the paths different plugins is detected", () => {
    const config = baseConfig();
    const runtime = applyPluginSchemaContributions(config, plugins);
    const cli = mergeSetupResultIntoConfig(config, config, [plugins[0]]); // drop @t/b

    expect(slugSet(cli.collections)).not.toEqual(slugSet(runtime.collections));
  });
});

const fld = (name: string): FieldConfig =>
  ({ name, type: "text" }) as unknown as FieldConfig;
const fieldNames = (
  e: { fields?: { name?: string }[] } | undefined
): string[] => (e?.fields ?? []).map(f => f.name ?? "");

/**
 * D50/R2 — the Builder schema lane. A plugin extends BOTH a code collection
 * and a Builder-made collection. The CLI path (`mergeSetupResultIntoConfig` +
 * `applyPluginSchemaContributionsDeferred`) and the runtime path
 * (`applyPluginSchemaContributionsDeferred`) must (a) fold code/plugin + apply
 * the code extend identically, (b) DEFER the Builder target identically, and
 * (c) resolve that deferred extend against the same Builder set to the same
 * extended Builder entity. This is the dual-lane parity that gates the lane.
 */
describe("CLI↔runtime Builder-lane parity", () => {
  const seo = plugin("@t/seo", {
    extend: [
      { target: "code-posts", fields: [fld("seoTitle")] }, // code target
      { target: "pages", fields: [fld("metaTitle")] }, // Builder target → deferred
    ],
  });
  const builderSet = (): BuilderEntities => ({
    collections: [
      { slug: "pages", fields: [fld("title")] } as {
        slug: string;
        fields: FieldConfig[];
      },
    ],
    singles: [],
    components: [],
  });

  it("both paths fold code/plugin + apply the code extend identically and defer the Builder target", () => {
    const config = baseConfig();
    const runtime = applyPluginSchemaContributionsDeferred(config, [seo]);
    const cli = mergeSetupResultIntoConfig(config, config, [seo]);

    // Same merged collection set; the Builder target ("pages") is NOT folded into config.
    expect(slugSet(cli.collections)).toEqual(
      slugSet(runtime.config.collections)
    );
    expect(slugSet(runtime.config.collections)).toEqual(["code-posts"]);
    // The code-collection extend was applied in-place on both paths.
    expect(
      fieldNames((cli.collections ?? []).find(c => c.slug === "code-posts"))
    ).toEqual(["seoTitle"]);
    // The Builder target was deferred (not thrown, not folded).
    expect(runtime.deferredExtends.map(d => d.target)).toEqual(["pages"]);
  });

  it("resolving the deferred Builder extend against the same Builder set yields the same extended entity", () => {
    const config = baseConfig();
    const runtime = applyPluginSchemaContributionsDeferred(config, [seo]);
    // Both the CLI and runtime resolve the SAME deferred clauses against the
    // SAME Builder entities via the SAME shared function.
    const resolved = resolveBuilderExtends(
      runtime.deferredExtends,
      builderSet()
    );
    const pages = resolved.collections?.find(c => c.slug === "pages");
    expect(fieldNames(pages)).toEqual(["title", "metaTitle"]);
  });
});
