/**
 * The plugin-settings read opts out of global date formatting.
 *
 * Settings are configuration a plugin round-trips, not records with
 * timestamps: an ISO-looking string a plugin stored was rewritten by value
 * into the installation's timezone, so the admin was shown — and could write
 * back — a value the plugin never set.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { dispatchPluginSettings } from "../plugin-settings-dispatcher";

describe("getPluginSettings", () => {
  it("marks the response to skip global date formatting", async () => {
    const container = {
      adapter: {
        getDrizzle: () => ({
          select: () => ({
            from: () => ({
              where: async () => [],
            }),
          }),
        }),
        dialect: "sqlite",
      },
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
