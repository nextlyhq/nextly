/**
 * The design level of a page asked outside a request: what the Page Builder
 * says the design drawing the page offers, where the Page Builder is
 * installed, and nothing where it is not or no design draws the page.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { designLevelOf } from "../design-level";

/** A context whose installed plugins offer `plugins`. */
function contextWith(plugins: Record<string, Record<string, unknown>>) {
  return { services: { plugins } } as unknown as PluginContext;
}

const ENTRY = { id: "p1", title: "Hello" };

describe("the design level of a page", () => {
  it("is what the Page Builder's design service answers for the entry, in its language", async () => {
    const valuesFor = vi.fn(async () => ({ title: "Hello | Blog" }));
    const ctx = contextWith({
      "@nextlyhq/plugin-page-builder": { designSeo: { valuesFor } },
    });

    await expect(
      designLevelOf(
        ctx,
        { kind: "entry", collection: "posts", entry: ENTRY },
        "de"
      )
    ).resolves.toEqual({ title: "Hello | Blog" });
    expect(valuesFor).toHaveBeenCalledWith({
      collection: "posts",
      entry: ENTRY,
      locale: "de",
    });
  });

  it("is nothing where the service says no design draws the page", async () => {
    const ctx = contextWith({
      "@nextlyhq/plugin-page-builder": {
        designSeo: { valuesFor: async () => undefined },
      },
    });
    await expect(
      designLevelOf(ctx, { kind: "entry", collection: "posts", entry: ENTRY })
    ).resolves.toEqual({});
  });

  it("is nothing where the Page Builder is not installed", async () => {
    await expect(
      designLevelOf(contextWith({}), {
        kind: "entry",
        collection: "posts",
        entry: ENTRY,
      })
    ).resolves.toEqual({});
  });

  it("is nothing for a Single, which the service does not draw", async () => {
    const valuesFor = vi.fn(async () => ({ title: "x" }));
    const ctx = contextWith({
      "@nextlyhq/plugin-page-builder": { designSeo: { valuesFor } },
    });
    await expect(
      designLevelOf(ctx, { kind: "single", slug: "home", document: {} })
    ).resolves.toEqual({});
    expect(valuesFor).not.toHaveBeenCalled();
  });
});
