/**
 * Where the entry's Design section is declared: in the side panel of every
 * collection entry's edit page, first, before Status, and above the form on
 * a phone, where the panel opens only from the document's menu.
 */
import { describe, expect, it } from "vitest";

import { ENTRY_DESIGN_SECTION_COMPONENT } from "./builder-view";
import { pageBuilder } from "./plugin";

describe("the entry's Design section", () => {
  it("is placed before Status, and above the form on a phone", () => {
    const contributions = pageBuilder().contributes?.admin?.contributions ?? [];
    const design = contributions.find(
      contribution =>
        contribution.kind === "sidebarSection" &&
        contribution.component === ENTRY_DESIGN_SECTION_COMPONENT
    );
    expect(design).toMatchObject({
      place: "collection.edit",
      label: "Design",
      before: "status",
      narrow: "above-form",
    });
  });
});
