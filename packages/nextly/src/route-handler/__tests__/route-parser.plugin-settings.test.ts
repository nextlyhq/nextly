/**
 * Which plugin a settings request names.
 *
 * The plugin name is the whole path segment for a bare name and TWO segments
 * for a scoped one, which is what this repository's own plugins use. Reading
 * only the first left `@acme` as the plugin and `auth` as a subresource, so
 * the lookup asked for a plugin nothing is called and answered 404.
 */
import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("plugin settings routes", () => {
  it("keeps a scoped plugin name whole", () => {
    expect(
      parseRestRoute(["plugins-settings", "@acme", "auth"], "GET")
    ).toMatchObject({
      service: "pluginSettings",
      method: "getPluginSettings",
      routeParams: { plugin: "@acme/auth" },
    });
  });

  it("keeps a scoped name whole on the write too", () => {
    expect(
      parseRestRoute(["plugins-settings", "@acme", "auth"], "PATCH")
    ).toMatchObject({
      service: "pluginSettings",
      method: "updatePluginSettings",
      routeParams: { plugin: "@acme/auth" },
    });
  });

  it("leaves an unscoped name exactly as it was", () => {
    // The control. Joining unconditionally would turn a bare name followed by
    // any stray segment into a plugin nothing is called — the same failure
    // pointing the other way.
    expect(parseRestRoute(["plugins-settings", "simple"], "GET")).toMatchObject(
      {
        service: "pluginSettings",
        routeParams: { plugin: "simple" },
      }
    );
  });

  it("does not treat a second segment as part of an unscoped name", () => {
    expect(
      parseRestRoute(["plugins-settings", "simple", "extra"], "GET")
    ).toMatchObject({ routeParams: { plugin: "simple" } });
  });
});
