import { describe, expect, it } from "vitest";

import { hasPluginsSection } from "../lib/has-plugins-section";

const SETTLED = {
  isPending: false,
  hasVisiblePluginCollection: false,
  installedPluginCount: 0,
};

describe("hasPluginsSection", () => {
  /**
   * The case this predicate was extracted for. A fresh project has no plugins
   * and no plugin-owned collections, so every arm below `canManageSettings` is
   * false. Before this rule the entry disappeared once loading settled, which
   * left no route to the page that installs a plugin.
   */
  it("shows the entry on a fresh project once loading has settled", () => {
    expect(
      hasPluginsSection(
        { canManageSettings: true, canViewCollections: true },
        SETTLED
      )
    ).toBe(true);
  });

  it("shows it for a settings manager who cannot view collections", () => {
    expect(
      hasPluginsSection(
        { canManageSettings: true, canViewCollections: false },
        SETTLED
      )
    ).toBe(true);
  });

  it("hides it from a user with neither capability", () => {
    expect(
      hasPluginsSection(
        { canManageSettings: false, canViewCollections: false },
        { ...SETTLED, installedPluginCount: 3 }
      )
    ).toBe(false);
  });

  /**
   * The collections arm. This user cannot open /admin/plugins, and
   * resolve-item-href keeps their icon a sub-sidebar opener, but the entry has
   * to exist for them to reach the plugin-owned collection underneath it.
   */
  it("shows it for a collection reader with a visible plugin collection", () => {
    expect(
      hasPluginsSection(
        { canManageSettings: false, canViewCollections: true },
        { ...SETTLED, hasVisiblePluginCollection: true }
      )
    ).toBe(true);
  });

  it("shows it for a collection reader while data is still pending", () => {
    expect(
      hasPluginsSection(
        { canManageSettings: false, canViewCollections: true },
        { ...SETTLED, isPending: true }
      )
    ).toBe(true);
  });

  it("shows it for a collection reader when plugins are installed", () => {
    expect(
      hasPluginsSection(
        { canManageSettings: false, canViewCollections: true },
        { ...SETTLED, installedPluginCount: 1 }
      )
    ).toBe(true);
  });

  /**
   * The separating case. Without this, a predicate that simply returned `true`
   * would satisfy every assertion above, and the fresh-project test would read
   * as coverage while proving nothing.
   */
  it("hides it from a collection reader with no plugins and nothing pending", () => {
    expect(
      hasPluginsSection(
        { canManageSettings: false, canViewCollections: true },
        SETTLED
      )
    ).toBe(false);
  });
});
