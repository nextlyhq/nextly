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
  COMPONENT_DELETE_LIST_TOOLS_COMPONENT,
  COMPONENT_LIST_TOOLS_COMPONENT,
  DELETE_COMPONENT_REPLACEMENT_COMPONENT,
} from "./builder-view";
import { COMPONENTS_SLUG } from "./collections/components";
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
    expect(ownComponentsAdmin(plugin)).toMatchObject({
      disableDelete: true,
      components: { BeforeListTable: COMPONENT_LIST_TOOLS_COMPONENT },
    });
  });

  it("replaces the host store's Delete and draws its list's tools, and leaves the plugin's own collection alone", () => {
    const plugin = pageBuilder({
      componentReadiness: { collection: "site-components" },
    });

    expect(plugin.contributes?.admin?.views).toEqual({
      "site-components": {
        documentActions: REPLACED,
        beforeList: COMPONENT_DELETE_LIST_TOOLS_COMPONENT,
      },
    });
    // Not the store: its own Delete stays, with no delete tools.
    expect(ownComponentsAdmin(plugin)).toMatchObject({
      disableDelete: false,
      components: { BeforeListTable: TRANSFER_IMPORT_COMPONENT },
    });
  });
});
