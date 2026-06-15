import { describe, expect, it } from "vitest";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import type { CollectionConfig } from "../../collections/config/define-collection";
import type { ComponentConfig } from "../../components/config/types";
import type { PluginDefinition } from "../../plugins/plugin-context";
import type { SingleConfig } from "../../singles/config/types";

import {
  mergeSetupResultIntoConfig,
  orderConfigPlugins,
} from "./config-loader";

const plugin = (
  name: string,
  extra: Partial<PluginDefinition> = {}
): PluginDefinition => ({
  name,
  version: "1.0.0",
  nextly: ">=0.0.0",
  ...extra,
});

describe("orderConfigPlugins (CLI resolution — D5/D6/D7)", () => {
  it("returns plugins in dependency (topo) order, not array order", () => {
    const a = plugin("@t/a");
    const b = plugin("@t/b", { dependsOn: { "@t/a": ">=1.0.0" } });

    const ordered = orderConfigPlugins([b, a]); // declared b-first
    expect(ordered.map(p => p.name)).toEqual(["@t/a", "@t/b"]);
  });

  it("fails fast on an incompatible core version", () => {
    const bad = plugin("@t/bad", { nextly: "^99.0.0" });
    try {
      orderConfigPlugins([bad]);
      throw new Error("expected orderConfigPlugins to throw");
    } catch (err) {
      expect(
        (err as { logContext?: { reason?: string } }).logContext?.reason
      ).toBe("core-incompatible");
    }
  });

  it("fails fast on a missing required dependency", () => {
    const needsMissing = plugin("@t/needs", {
      dependsOn: { "@t/absent": ">=1.0.0" },
    });
    try {
      orderConfigPlugins([needsMissing]);
      throw new Error("expected orderConfigPlugins to throw");
    } catch (err) {
      expect(
        (err as { logContext?: { reason?: string } }).logContext?.reason
      ).toBe("missing-dependency");
    }
  });

  it("returns an empty array unchanged", () => {
    expect(orderConfigPlugins([])).toEqual([]);
  });
});

describe("mergeSetupResultIntoConfig (CLI fold — D3/D12/D50)", () => {
  const coll = (slug: string) =>
    ({ slug, fields: [] }) as unknown as CollectionConfig;
  const single = (slug: string) =>
    ({ slug, fields: [] }) as unknown as SingleConfig;
  const comp = (slug: string) =>
    ({ slug, fields: [] }) as unknown as ComponentConfig;
  const base = (): SanitizedNextlyConfig =>
    ({
      collections: [],
      singles: [],
      components: [],
    }) as unknown as SanitizedNextlyConfig;

  it("folds plugin contributes.{collections,singles,components} into the config (components threaded)", () => {
    const plugins = [
      plugin("@t/p", {
        contributes: {
          collections: [coll("p-coll")],
          singles: [single("p-single")],
          components: [comp("p-comp")],
        },
      }),
    ];
    const transformed = { ...base(), plugins } as SanitizedNextlyConfig;

    const result = mergeSetupResultIntoConfig(base(), transformed, plugins);

    expect((result.collections ?? []).map(c => c.slug)).toContain("p-coll");
    expect((result.singles ?? []).map(s => s.slug)).toContain("p-single");
    // components were dropped by the old whitelist merge-back — must survive now.
    expect((result.components ?? []).map(c => c.slug)).toContain("p-comp");
  });
});
