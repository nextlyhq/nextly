/**
 * Delete component follows the component store wherever it is: the plugin's
 * own collection, or the host's collection `componentReadiness.collection`
 * names. The store's document Delete is replaced by Delete component and its
 * list gets the delete tools; the plugin's own collection, when it is not the
 * store, keeps its ordinary delete and gets neither.
 *
 * The property that separates this from a plausible broken wiring is that
 * the override is keyed by the store's slug: one keyed by the literal
 * `components` would pass the first case and act on the wrong collection in
 * the second.
 */
import { describe, expect, it } from "vitest";

import {
  COMPONENT_STORE_DELETE_HOST_COMPONENT,
  COMPONENT_LIST_TOOLS_COMPONENT,
  DELETE_COMPONENT_REPLACEMENT_COMPONENT,
} from "./builder-view";
import { COMPONENTS_SLUG } from "./collections/components";
import { PATTERNS_SLUG } from "./collections/patterns";
import { pageBuilder } from "./plugin";
import { TRANSFER_IMPORT_COMPONENT } from "./transfer/transfer-contract";

/** The plugin's own components collection's admin options. */
function ownComponentsAdmin(plugin: ReturnType<typeof pageBuilder>) {
  const own = (plugin.contributes?.collections ?? []).find(
    collection => collection.slug === COMPONENTS_SLUG
  );
  return own?.admin as
    | { disableDelete?: boolean; components?: { BeforeListTable?: string } }
    | undefined;
}

const REPLACED = {
  delete: {
    component: DELETE_COMPONENT_REPLACEMENT_COMPONENT,
    label: "Delete component…",
  },
};

describe("Delete component's admin wiring", () => {
  it("replaces the plugin's own Components Delete when it is the store", () => {
    const plugin = pageBuilder();

    expect(plugin.contributes?.admin?.views).toEqual({
      [COMPONENTS_SLUG]: { documentActions: REPLACED },
    });
    // The plugin's own list draws the tools itself: no header tools.
    expect(plugin.contributes?.admin?.header).toBeUndefined();
    expect(plugin.contributes?.admin?.clientConfig).not.toHaveProperty(
      "componentStore"
    );
    expect(ownComponentsAdmin(plugin)).toMatchObject({
      disableDelete: true,
      components: { BeforeListTable: COMPONENT_LIST_TOOLS_COMPONENT },
    });
  });

  it("replaces the host store's Delete and draws its list's tools outside the slot above its list, and leaves the plugin's own collection alone", () => {
    const plugin = pageBuilder({
      componentReadiness: { collection: "site-components" },
    });

    // No `beforeList`: that slot is the host's to fill, and a host's own
    // would drop it. The tools are drawn in the header, told the store.
    expect(plugin.contributes?.admin?.views).toEqual({
      "site-components": { documentActions: REPLACED },
    });
    expect(plugin.contributes?.admin?.header).toEqual({
      slot: COMPONENT_STORE_DELETE_HOST_COMPONENT,
    });
    expect(plugin.contributes?.admin?.clientConfig).toMatchObject({
      componentStore: "site-components",
    });
    // Not the store: its own Delete stays, with no delete tools.
    expect(ownComponentsAdmin(plugin)).toMatchObject({
      disableDelete: false,
      components: { BeforeListTable: TRANSFER_IMPORT_COMPONENT },
    });
  });

  it("refuses a host store that shares a slug with a collection the plugin declares", () => {
    // Keyed by that slug, the delete's surfaces would land on the plugin's
    // own Patterns rather than on the host's store.
    expect(() =>
      pageBuilder({ componentReadiness: { collection: PATTERNS_SLUG } })
    ).toThrow(
      /componentReadiness\.collection names "patterns", which is also a collection the Page Builder declares/
    );
    // Naming the plugin's own Components is not a host store, and stands.
    expect(() =>
      pageBuilder({ componentReadiness: { collection: COMPONENTS_SLUG } })
    ).not.toThrow();
  });

  it("refuses naming `components` as the store once the plugin's own Components is renamed", () => {
    const plugin = pageBuilder({
      componentReadiness: { collection: COMPONENTS_SLUG },
    });
    // Judged first in init, before anything reads the rest of the context.
    const ctx = {
      self: { collections: { [COMPONENTS_SLUG]: "site-components" } },
    };
    expect(() => plugin.init?.(ctx as never)).toThrow(
      /Components collection is renamed to "site-components"/
    );
  });
});
