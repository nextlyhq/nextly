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

  it("stays in the plugins section, so its own name is not a second main-rail item", () => {
    const plugin = pageBuilder();
    const menu = plugin.contributes?.admin?.menu ?? [];

    // The neighbouring case, and the reason the form builder carries a similar
    // assertion: it takes `placement: "standalone"` and contributes NO menu
    // item, so "Forms" appears exactly once. This plugin does the opposite — it
    // contributes its own menu entries — so taking standalone placement too
    // would put "Page Builder" in the main rail beside the entries it already
    // puts there, as two names for one feature.
    expect(plugin.admin?.placement).toBeUndefined();

    // The pairing is the property, so the menu being non-empty is what makes
    // the placement assertion above mean anything: standalone placement is
    // only a duplication when something is already listed. Which entries
    // those are is not this test's question — asserting the whole list here
    // made adding a screen look like a change to the plugin's identity, and a
    // line naming one of them did the same thing more quietly. Which sources
    // offer which screen is asserted in `composition-stores.test.ts`, where
    // the navigation reasoning lives.
    expect(menu.length).toBeGreaterThan(0);
  });
});
