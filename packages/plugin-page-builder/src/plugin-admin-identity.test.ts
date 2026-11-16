/**
 * How this plugin names itself in the admin.
 *
 * `admin-meta.ts` resolves a plugin's displayed name as
 * `appearance?.label ?? meta.name`, and `meta.name` is the raw package
 * specifier. Without an `appearance` the plugins list and the dashboard show
 * `@nextlyhq/plugin-page-builder` in the place where the form builder shows
 * "Forms" — a difference nothing type-checks and no other test observes,
 * because both branches produce a perfectly valid string.
 */
import { describe, expect, it } from "vitest";

import { pageBuilder } from "./plugin";

describe("page-builder admin identity", () => {
  it("names itself rather than falling back to the package specifier", () => {
    const plugin = pageBuilder();

    expect(plugin.admin).toMatchObject({
      appearance: { icon: "Layout", label: "Page Builder" },
      description:
        "Build pages visually from blocks with drag-and-drop editing",
    });

    // The fallback this exists to avoid. Asserting the label is present would
    // also pass if it were set to the package name, which is the one value that
    // makes the whole field pointless.
    expect(plugin.admin?.appearance?.label).not.toBe(plugin.name);
  });

  it("names itself once in the rail: its menu items move into its own panel", () => {
    const plugin = pageBuilder();
    const menu = plugin.contributes?.admin?.menu ?? [];

    // Placed standalone, the plugin's name is its rail item, and its menu
    // items are listed in that item's panel rather than under a "Page
    // Builder" heading in the Plugins panel, so the name appears once.
    expect(plugin.admin?.placement).toBe("standalone");

    // The pairing is the property: standalone placement only gives the
    // items somewhere else to be when there are items. Which entries those
    // are is asserted in `overview/admin-panel.test.ts`.
    expect(menu.length).toBeGreaterThan(0);
    expect(menu.every(item => item.section === undefined)).toBe(true);
  });
});
