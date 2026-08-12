import { describe, expect, it } from "vitest";

import { hasPluginsSection } from "../lib/has-plugins-section";

const SETTLED = {
  isPending: false,
  hasVisiblePluginCollection: false,
};

describe("hasPluginsSection", () => {
  /**
   * The case this predicate was extracted for. A fresh project has no plugins
   * and no plugin-owned collections, so every arm below `canManageSettings` is
   * false, so only the `canManageSettings` arm keeps the entry. It has to:
   * `/admin/plugins` lists installed plugins and explains in its empty state
   * that plugins are added through the Nextly config, and the sidebar entry is
   * the only route to it.
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
        SETTLED
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

  /**
   * A failed collections query is not pending. It will never resolve into
   * visible collections, so for this user the panel has no destination and the
   * rail item would open an empty one. The caller passes loading only.
   */
  it("hides it from a collection reader once loading has settled with nothing visible", () => {
    expect(
      hasPluginsSection(
        { canManageSettings: false, canViewCollections: true },
        { isPending: false, hasVisiblePluginCollection: false }
      )
    ).toBe(false);
  });

  it("shows it for a collection reader while data is still pending", () => {
    expect(
      hasPluginsSection(
        { canManageSettings: false, canViewCollections: true },
        { ...SETTLED, isPending: true }
      )
    ).toBe(true);
  });

  /**
   * A collection reader whose plugins own no collection they may see has no
   * reachable destination in the panel: the overview and the per-plugin pages
   * are both manage-settings guarded. The rail item would open an empty panel.
   */
  it("hides it from a collection reader whose plugins expose nothing to them", () => {
    expect(
      hasPluginsSection(
        { canManageSettings: false, canViewCollections: true },
        SETTLED
      )
    ).toBe(false);
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
