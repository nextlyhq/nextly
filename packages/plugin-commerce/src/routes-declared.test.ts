/**
 * Every route this plugin contributes declares what reaching it takes: a
 * permission, `public`, a `principal`, `checksAccess: true` or `siteWide: false`.
 * An undeclared route is refused for every caller, so one added without a
 * declaration fails here rather than on every request.
 */
import { undeclaredPluginRoutes } from "@nextlyhq/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { commerce } from "./plugin";

describe("the plugin's routes", () => {
  it("each declare what reaching them takes, for a store", () => {
    expect(undeclaredPluginRoutes(commerce({ currency: "USD" }))).toEqual([]);
  });
});
