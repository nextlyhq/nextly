import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import type { CollectionConfig } from "../../collections/config/define-collection";
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
