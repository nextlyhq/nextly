/**
 * The settings readers find the SEO settings Single under the name the host
 * gave it, whichever plugin calls them: another plugin's context knows only
 * its own Singles.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

/** The slug each read asked for. */
const asked: string[] = [];

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  getCachedNextly: async () => ({
    findSingle: async ({ slug }: { slug: string }) => {
      asked.push(slug);
      return { siteName: "Acme" };
    },
  }),
}));

import { readSeoRules, rememberSettingsSingle } from "../rules";

/** A plugin context with `name` and its own Singles' registered names. */
const contextOf = (name: string, singles: Record<string, string>) =>
  ({
    self: { name, singles, collections: {} },
    services: { media: { findById: async () => undefined } },
  }) as unknown as PluginContext;

describe("which Single the settings are read from", () => {
  it("is the one the host renamed, read from another plugin's context too", async () => {
    rememberSettingsSingle(
      contextOf("@nextlyhq/plugin-seo", { "seo-settings": "site-seo" })
    );
    asked.length = 0;

    await readSeoRules(contextOf("@acme/brand-card", {}));
    await readSeoRules(
      contextOf("@nextlyhq/plugin-seo", { "seo-settings": "site-seo" })
    );

    expect(asked).toEqual(["site-seo", "site-seo"]);
  });
});
