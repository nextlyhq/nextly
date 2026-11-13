// @vitest-environment jsdom
/**
 * The editor's outline draws its side column by the editor's own rule: where
 * the editor docks its panel (1000 px of editor, by the frame's container),
 * and not where this reader folded the panel away.
 */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorOutline } from "@admin/components/shared/loading-frame/outlines";
import {
  confirmLabels,
  rememberPreference,
  resetDeviceMemoryForTests,
} from "@admin/lib/device-memory/device-memory";

import {
  DOCKED_PANEL_COLUMN,
  DOCKED_PANEL_ROW,
  PANEL_FLOATS_BELOW,
} from "../document-panel-mode";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
  useBrandingStatus: () => ({ isPending: false, isUnavailable: false }),
}));

afterEach(() => {
  window.localStorage.clear();
  resetDeviceMemoryForTests();
});

/** The outline's side column, by its class. */
function sideColumn(container: HTMLElement): Element | null {
  return container.querySelector('[style*="--editor-side-width"]');
}

describe("the editor's outline and its side column", () => {
  it("writes the docking width in its classes as the editor's rule has it", () => {
    for (const rule of [DOCKED_PANEL_ROW, DOCKED_PANEL_COLUMN]) {
      expect(rule).toContain(`@[${PANEL_FLOATS_BELOW}px]/editor:`);
    }
  });

  it("draws the column by the editor frame's width, not the window's", () => {
    const { container } = render(<EditorOutline />);
    const column = sideColumn(container);
    expect(column?.className).toContain(`@[${PANEL_FLOATS_BELOW}px]/editor:flex`);
    expect(column?.className.split(/\s+/)).not.toContain("lg:flex");
    expect(container.querySelector(".\\@container\\/editor")).not.toBeNull();
  });

  it("draws no column where the reader folded the panel away", () => {
    confirmLabels({ user: "u", schemaVersion: "1", permissionVersion: "p" });
    rememberPreference("nextly:admin:entry-rail-collapsed", "1");
    const { container } = render(<EditorOutline />);
    expect(sideColumn(container)).toBeNull();
  });
});
