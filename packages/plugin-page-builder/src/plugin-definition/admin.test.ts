/**
 * The builder's document view as the plugin declares it: the view a
 * collection whose main field is a blocks field opens in first, and the words
 * the admin offers it by where a document opens elsewhere.
 *
 * Read from the plugin the factory returns, which is what the admin's
 * metadata publishes, so a declaration that drops either key, or a second
 * view that takes them, fails here rather than as pages quietly opening as
 * forms again.
 */
import { describe, expect, it } from "vitest";

import { BUILDER_VIEW_PATH } from "../builder-view";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";

describe("the builder's document view", () => {
  const views = pageBuilder().contributes?.admin?.documentViews ?? [];

  it("opens first on a collection whose main field is a blocks field, worded 'Open in builder' elsewhere", () => {
    // Exactly one view, so "the builder" names one address and one label.
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      path: BUILDER_VIEW_PATH,
      fieldType: BLOCKS_TYPE,
      opensFirst: "mainField",
      openLabel: "Open in builder",
    });
  });

  it("opens the New page dialog from '+ New' on such a collection's list", () => {
    expect(views[0]?.createDialog).toBe(
      "@nextlyhq/plugin-page-builder/admin#NewPageCreateDialog"
    );
  });
});
