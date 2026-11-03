import { describe, expect, it } from "vitest";

import { panelLabel } from "./editor-rail";
import { EDITOR_WORDS } from "./editor-words";
import { inspectorTabLabels } from "./inspector-panel";
import { RAIL_GROUPS } from "./shell-state";

describe("the editor's words", () => {
  it("names its places with the agreed words, spelled once", () => {
    // The words an author learns the editor by. A rename is one edit here,
    // and this pins the spelling the rest of the editor reads.
    expect(EDITOR_WORDS).toMatchObject({
      add: "Add",
      layers: "Layers",
      pages: "Pages",
      components: "Components",
      design: "Design",
      variables: "Variables",
      sharedStyles: "Shared styles",
      sections: "Sections",
      content: "Content",
      style: "Style",
    });
  });

  it("names every rail panel from the catalogue", () => {
    // Read through the rail's own function, so a label typed beside the
    // catalogue instead of read from it fails here.
    for (const panel of [...RAIL_GROUPS.top, ...RAIL_GROUPS.bottom]) {
      expect(panelLabel(panel)).toBe(EDITOR_WORDS[panel]);
    }
  });

  it("names the inspector's tabs from the catalogue", () => {
    expect(inspectorTabLabels()).toEqual([
      EDITOR_WORDS.content,
      EDITOR_WORDS.style,
    ]);
  });
});
