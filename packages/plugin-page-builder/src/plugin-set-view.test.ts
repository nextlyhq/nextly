/**
 * A header & footer set opens in the builder: the plugin declares a view of
 * the sets collection, offered as "Open in builder" where a set opens in its
 * form, at an address of its own beside the blocks field's view, whose path
 * the boot holds unique across every document.
 */
import { describe, expect, it } from "vitest";

import {
  BUILDER_VIEW_PATH,
  OPEN_IN_BUILDER,
  SET_BUILDER_VIEW_COMPONENT,
  SET_BUILDER_VIEW_PATH,
} from "./builder-view";
import { LAYOUTS_SLUG } from "./collections/layouts";
import { pageBuilder } from "./plugin";

describe("the header & footer set's view", () => {
  it("is declared on the sets collection, offered as Open in builder", () => {
    const views = pageBuilder().contributes?.admin?.views ?? {};
    expect(views[LAYOUTS_SLUG]?.documentViews).toEqual([
      {
        path: SET_BUILDER_VIEW_PATH,
        component: SET_BUILDER_VIEW_COMPONENT,
        label: "Page Builder",
        openLabel: OPEN_IN_BUILDER,
      },
    ]);
  });

  it("sits at a path of its own, never the blocks field view's", () => {
    // A view on a slug and a view on a field type that share a path are
    // refused at boot, whatever documents they reach.
    expect(SET_BUILDER_VIEW_PATH).not.toBe(BUILDER_VIEW_PATH);
    const fieldTypeViews =
      pageBuilder().contributes?.admin?.documentViews ?? [];
    expect(fieldTypeViews.map(view => view.path)).not.toContain(
      SET_BUILDER_VIEW_PATH
    );
  });
});
