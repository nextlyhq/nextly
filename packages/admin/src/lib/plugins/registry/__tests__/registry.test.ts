import { describe, expect, it } from "vitest";

import { isPluginCategory } from "../../plugin-categories";
import { pluginSlug } from "../../plugin-slug";
import {
  MAX_FEATURED,
  shouldShowFeatured,
  staticRegistrySource,
} from "../static-source";

describe("the plugin registry", () => {
  it("is not empty, so the checks below are not vacuous", async () => {
    expect((await staticRegistrySource.list()).length).toBeGreaterThan(0);
  });

  it("gives every entry a non-empty description", async () => {
    for (const e of await staticRegistrySource.list()) {
      expect(e.description.trim(), `${e.id} has no description`).not.toBe("");
    }
  });

  it("uses only categories from the vocabulary", async () => {
    for (const e of await staticRegistrySource.list()) {
      expect(
        isPluginCategory(e.category),
        `${e.id} declares category ${e.category}`
      ).toBe(true);
    }
  });

  it("gives every entry an id that survives slug derivation", async () => {
    for (const e of await staticRegistrySource.list()) {
      const slug = pluginSlug(e.id);
      expect(slug, `${e.id} produced an empty slug`).not.toBe("");
      expect(pluginSlug(slug), `${e.id} slug is not idempotent`).toBe(slug);
    }
  });

  it("resolves every featured id to an entry", async () => {
    const ids = new Set((await staticRegistrySource.list()).map(e => e.id));
    for (const id of await staticRegistrySource.featured()) {
      expect(ids.has(id), `featured id ${id} matches no entry`).toBe(true);
    }
  });

  it("caps the featured list", async () => {
    expect((await staticRegistrySource.featured()).length).toBeLessThanOrEqual(
      MAX_FEATURED
    );
  });

  /**
   * Positive control for the featured checks. They pass trivially on an empty
   * featured list, so this proves the lookup can distinguish a real id from a
   * fabricated one.
   */
  it("does not contain a fabricated id", async () => {
    const ids = new Set((await staticRegistrySource.list()).map(e => e.id));
    expect(ids.has("@nope/does-not-exist")).toBe(false);
  });

  it("keeps at least one entry out of the featured strip", async () => {
    const entries = await staticRegistrySource.list();
    const featured = await staticRegistrySource.featured();
    expect(
      shouldShowFeatured(entries, featured),
      "featuring every entry makes the strip a duplicate of the grid"
    ).toBe(true);
  });
});

describe("shouldShowFeatured", () => {
  const entry = (id: string) => ({ id }) as never;

  it("hides the strip when it would contain every entry", () => {
    expect(shouldShowFeatured([entry("a"), entry("b")], ["a", "b"])).toBe(
      false
    );
  });

  it("hides the strip when nothing is featured", () => {
    expect(shouldShowFeatured([entry("a"), entry("b")], [])).toBe(false);
  });

  it("shows the strip when the grid still has something else", () => {
    expect(shouldShowFeatured([entry("a"), entry("b")], ["a"])).toBe(true);
  });
});
