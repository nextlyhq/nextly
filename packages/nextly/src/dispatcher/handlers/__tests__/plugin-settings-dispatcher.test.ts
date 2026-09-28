/**
 * The plugin-settings responses opt out of global date formatting.
 *
 * Settings are configuration a plugin round-trips, not records with
 * timestamps: an ISO-looking string a plugin stored was rewritten by value
 * into the installation's timezone, so the admin was shown — and could write
 * back — a value the plugin never set.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { dispatchPluginSettings } from "../plugin-settings-dispatcher";

// A store holding nothing: the update is accepted and the read answers with
// the schema's defaults. What these tests watch is the response, not storage.
vi.mock("../../../domains/plugins/settings-store", async importOriginal => ({
  ...(await importOriginal<object>()),
  createPluginSettingsStore: () => ({
    read: async () => [],
    mutate: async (
      _owner: string,
      _keys: string[],
      computeRows: (rows: never[]) => Promise<unknown>
    ) => {
      await computeRows([]);
    },
  }),
}));

const container = {
  adapter: { getDrizzle: () => ({}), dialect: "sqlite" },
} as never;
const config = {
  plugins: [
    {
      name: "acme-auth",
      contributes: {
        settings: z.object({ since: z.string().default("") }),
      },
    },
  ],
} as never;

describe("getPluginSettings", () => {
  it("marks the response to skip global date formatting", async () => {
    const response = (await dispatchPluginSettings(
      container,
      config,
      "getPluginSettings",
      { plugin: "acme-auth" },
      null
    )) as Response;

    // The internal marker the global formatter deletes before the response
    // leaves: set here, the settings payload crosses the boundary unchanged.
    expect(response.headers.get("x-nextly-skip-date-formatting")).toBe("1");
    const body = (await response.json()) as { settings: unknown };
    expect(body.settings).toEqual({ since: "" });
  });
});

describe("updatePluginSettings", () => {
  it("marks its response the same way", async () => {
    // The update answers with the resulting settings, which the admin
    // renders and can save again, so it is as exposed as the read.
    const response = (await dispatchPluginSettings(
      container,
      config,
      "updatePluginSettings",
      { plugin: "acme-auth" },
      { since: "2026-01-01T00:00:00.000Z" }
    )) as Response;

    expect(response.headers.get("x-nextly-skip-date-formatting")).toBe("1");
  });
});
