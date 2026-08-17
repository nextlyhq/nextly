import { describe, expect, it } from "vitest";

import { pluginSurfaceSection } from "../section-resolvers";

/**
 * The deferral chain a plugin's page or menu item follows to find its rail
 * entry. Each case names which of the three inputs decides, because the value
 * alone does not say which rule produced it.
 */
describe("pluginSurfaceSection", () => {
  it("uses what the surface itself declared", () => {
    expect(pluginSurfaceSection("settings", undefined, "acme")).toBe(
      "settings"
    );
  });

  it("lets the surface OVERRIDE its plugin's placement", () => {
    // The case that makes this a chain rather than a lookup: a plugin under
    // Settings can still put one page under Media.
    expect(pluginSurfaceSection("media", "settings", "acme")).toBe("media");
  });

  it("defers to the plugin's placement when the surface says nothing", () => {
    expect(pluginSurfaceSection(undefined, "settings", "acme")).toBe(
      "settings"
    );
  });

  it("falls to Plugins when neither declares anything", () => {
    expect(pluginSurfaceSection(undefined, undefined, "acme")).toBe("plugins");
  });

  it.each([
    ["declared on the surface", "standalone", undefined],
    ["inherited from the plugin", undefined, "standalone"],
  ])("resolves standalone to the plugin's own entry (%s)", (_why, a, b) => {
    expect(pluginSurfaceSection(a, b, "acme-helpdesk")).toBe(
      "standalone-acme-helpdesk"
    );
  });

  it("maps 'users' to Settings, where user management is rendered", () => {
    expect(pluginSurfaceSection("users", undefined, "acme")).toBe("settings");
  });

  it("ignores a value that names no rail entry rather than trusting it", () => {
    // Older servers, or a plugin built against a newer vocabulary, can send a
    // section this admin does not know. Landing on Plugins is visible and
    // recoverable; trusting it selects nothing at all.
    expect(pluginSurfaceSection("nonsense", undefined, "acme")).toBe("plugins");
  });

  it("does not treat 'dashboard' as a fallback", () => {
    // Guards the specific failure this whole change removes: an unknown value
    // must not resolve to the section that also means "nothing matched".
    expect(pluginSurfaceSection("nonsense", "nonsense", "acme")).not.toBe(
      "dashboard"
    );
  });
});
