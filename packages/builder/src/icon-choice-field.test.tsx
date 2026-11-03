// @vitest-environment jsdom

/**
 * Alignment and direction as a radio group of icons.
 *
 * @module icon-choice-field.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

import { IconChoiceField } from "./icon-choice-field";
import { alignmentGroupFor } from "./style-alignment-icons";

afterEach(cleanup);

const group = alignmentGroupFor(
  "justify-content",
  ["normal", "start", "center", "end", "space-between", "safe center"],
  { axis: "row", reversed: false, rtl: false }
)!;

function mount(stored?: string) {
  const onCommit = vi.fn(() => "applied" as const);
  render(
    <>
      <span id="label">Justify content</span>
      <IconChoiceField
        id="field"
        labelledBy="label"
        group={group}
        stored={stored}
        actionName="Justify content"
        describedBy={undefined}
        onCommit={onCommit}
      />
    </>
  );
  return onCommit;
}

describe("IconChoiceField", () => {
  it("is one radio group named by its label, each icon named in words", () => {
    mount("center");

    const radios = screen.getAllByRole("radio");
    expect(
      screen.getByRole("radiogroup", { name: "Justify content" })
    ).toBeDefined();
    expect(radios.map(radio => radio.getAttribute("aria-label"))).toEqual([
      "Start",
      "Center",
      "End",
      "Space between",
    ]);
    expect(
      screen.getByRole("radio", { name: "Center" }).getAttribute("aria-checked")
    ).toBe("true");
  });

  it("keeps the group to one tab stop, on the chosen value", () => {
    mount("end");

    const reachable = screen
      .getAllByRole("radio")
      .filter(radio => radio.tabIndex === 0);
    expect(reachable.map(radio => radio.getAttribute("aria-label"))).toEqual([
      "End",
    ]);
  });

  it("moves and chooses with the arrow keys, wrapping at the ends", () => {
    const onCommit = mount("start");

    fireEvent.keyDown(screen.getByRole("radio", { name: "Start" }), {
      key: "ArrowRight",
    });
    expect(onCommit).toHaveBeenLastCalledWith("center");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Start" }), {
      key: "ArrowLeft",
    });
    expect(onCommit).toHaveBeenLastCalledWith("space-between");
  });

  it("clears when the chosen value is pressed again", () => {
    const onCommit = mount("center");

    fireEvent.click(screen.getByRole("radio", { name: "Center" }));
    expect(onCommit).toHaveBeenLastCalledWith(null);
  });

  it("keeps the values without an icon in a list beside the group, showing a stored one", () => {
    mount("safe center");

    const more = screen.getByLabelText("More Justify content values");
    expect(more.textContent).toContain("safe center");
    // No icon is chosen for a value the icons do not draw.
    expect(
      screen
        .getAllByRole("radio")
        .some(radio => radio.getAttribute("aria-checked") === "true")
    ).toBe(false);
  });
});
