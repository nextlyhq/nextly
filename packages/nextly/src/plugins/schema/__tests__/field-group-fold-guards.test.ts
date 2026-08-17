import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import type { NextlyServiceConfig } from "../../../di/register";
// `plugin-context` declares `PluginDefinition`; the sibling plugin suites
// import it from there too.
import type { PluginDefinition } from "../../plugin-context";
import { applyPluginSchemaContributions } from "../apply-contributions";

const field = { type: "text" as const, name: "title" };

const cfg = (partial: Partial<NextlyServiceConfig>): NextlyServiceConfig =>
  ({ imageProcessor: {}, ...partial }) as unknown as NextlyServiceConfig;

const plugin = (name: string, contributes: unknown): PluginDefinition =>
  ({ name, contributes }) as unknown as PluginDefinition;

const entity = (slug: string) => ({
  slug,
  label: { singular: slug, plural: slug },
  fields: [field],
});

// The contribution key was renamed rather than aliased, so a plugin built
// against the old name must fail rather than load with its schema dropped.
describe("plugin fold guards", () => {
  describe("legacy contribution key", () => {
    it("fails instead of silently dropping entities under the old key", () => {
      // The key was renamed rather than aliased. A plugin built against the old
      // name would otherwise load and lose its schema without a word.
      expect(() =>
        applyPluginSchemaContributions(cfg({ collections: [] }), [
          plugin("@t/legacy", { components: [entity("seo")] }),
        ])
      ).toThrow(NextlyError);
    });

    it("names the offending plugin and both key spellings", () => {
      try {
        applyPluginSchemaContributions(cfg({ collections: [] }), [
          plugin("@t/legacy", { components: [entity("seo")] }),
        ]);
        expect.unreachable("expected a legacy-key failure");
      } catch (error) {
        const detail = JSON.stringify(error);
        expect(detail).toContain("@t/legacy");
        expect(detail).toContain("PLUGIN_CONTRIBUTES_RENAMED");
      }
    });

    it("accepts the current key", () => {
      const result = applyPluginSchemaContributions(cfg({ collections: [] }), [
        plugin("@t/p", { fieldGroups: [entity("seo")] }),
      ]);
      expect((result.fieldGroups ?? []).map(e => e.slug)).toEqual(["seo"]);
    });
  });
});
