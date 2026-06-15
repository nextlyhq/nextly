import { describe, expect, it } from "vitest";

import { mergeSetupResultIntoConfig } from "../../cli/utils/config-loader";
import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import type { CollectionConfig } from "../../collections/config/define-collection";
import type { ComponentConfig } from "../../components/config/types";
import type { NextlyServiceConfig } from "../../di/register";
import type { SingleConfig } from "../../singles/config/types";
import type { PluginContributions } from "../contributions";
import type { PluginDefinition } from "../plugin-context";

import { applyPluginSchemaContributions } from "./apply-contributions";

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

describe("CLI↔runtime schema fold parity (D50)", () => {
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
