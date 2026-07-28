import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import type { NextlyServiceConfig } from "../../../di/register";
import type { PluginDefinition } from "../../types";
import { applyPluginSchemaContributions } from "../apply-contributions";

const field = { type: "text" as const, name: "title" };

const cfg = (partial: Partial<NextlyServiceConfig>): NextlyServiceConfig =>
  ({ imageProcessor: {}, ...partial }) as unknown as NextlyServiceConfig;

const plugin = (name: string, contributes: unknown): PluginDefinition =>
  ({ name, contributes }) as unknown as PluginDefinition;

const entity = (slug: string, dbName?: string) => ({
  slug,
  label: { singular: slug, plural: slug },
  ...(dbName === undefined ? {} : { dbName }),
  fields: [field],
});

// A plugin's entities never pass through defineConfig, so the guards that
// protect the app's own config have to run again once contributions are folded
// in — otherwise a plugin is simply exempt from them.
describe("plugin fold guards", () => {
  describe("reserved field-group table prefix", () => {
    it("rejects a plugin-contributed collection claiming the prefix", () => {
      expect(() =>
        applyPluginSchemaContributions(cfg({ collections: [] }), [
          plugin("@t/p", { collections: [entity("widgets", "fg_widgets")] }),
        ])
      ).toThrow(NextlyError);
    });

    it("rejects a plugin-contributed single claiming the prefix", () => {
      expect(() =>
        applyPluginSchemaContributions(cfg({ singles: [] }), [
          plugin("@t/p", { singles: [entity("settings", "fg_settings")] }),
        ])
      ).toThrow(NextlyError);
    });

    it("records that the claim came from a plugin", () => {
      try {
        applyPluginSchemaContributions(cfg({ collections: [] }), [
          plugin("@t/p", { collections: [entity("widgets", "fg_widgets")] }),
        ]);
        expect.unreachable("expected a reserved-prefix failure");
      } catch (error) {
        expect(JSON.stringify(error)).toContain("fg_widgets");
      }
    });

    it("allows a plugin-contributed entity with an unrelated dbName", () => {
      expect(() =>
        applyPluginSchemaContributions(cfg({ collections: [] }), [
          plugin("@t/p", { collections: [entity("widgets", "dc_widgets")] }),
        ])
      ).not.toThrow();
    });
  });

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
