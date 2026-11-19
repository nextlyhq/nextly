// @vitest-environment jsdom
/**
 * A set's screen, by what is edited: on its placeholder, no page add
 * controls and the set's own settings with nothing selected; while its
 * header or footer is edited in place, that component's add controls and
 * its own settings, never the set's around it.
 */
import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./set-settings-panel", () => ({
  SetSettingsPanel: () => null,
}));

const { editsPlaceholder } = await import("./editor-canvas-region");
const { setSettingsOf } = await import("./editor-inspector");
const { SetSettingsPanel } = await import("./set-settings-panel");

const onPage = { target: { kind: "page" } } as never;
const inRegion = { target: { kind: "region", area: "header" } } as never;
const SET = { id: "main" };

describe("a set's screen, by what is edited", () => {
  it("offers no page add controls on the placeholder, and them again in an edited header", () => {
    expect(editsPlaceholder({ set: SET, editing: onPage })).toBe(true);
    expect(editsPlaceholder({ set: SET, editing: inRegion })).toBe(false);
    // A page is never a placeholder.
    expect(editsPlaceholder({ set: undefined, editing: onPage })).toBe(false);
  });

  it("shows the set's settings with nothing selected on the placeholder", () => {
    const drawn = setSettingsOf(
      { regionEditing: { area: undefined } } as never,
      SET,
      "the header's own",
      {} as never
    );
    expect(isValidElement(drawn) && drawn.type === SetSettingsPanel).toBe(true);
  });

  it("shows the edited header's own settings, not the set's, while it is edited", () => {
    const drawn = setSettingsOf(
      { regionEditing: { area: "header" } } as never,
      SET,
      "the header's own",
      {} as never
    );
    expect(drawn).toBe("the header's own");
  });
});
