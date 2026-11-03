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
  {
    writingMode: "horizontal-tb",
    rtl: false,
    flex: true,
    direction: "row",
  }
)!;

function mount(stored?: string, describedBy?: string) {
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
        describedBy={describedBy}
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

  it("shows a stored spelling neither the icons nor the list carry, in More", () => {
    // The engine accepts spellings outside the catalogue's list, "inherit"
    // among them; shown as unset, an active declaration would look absent.
    mount("inherit");

    expect(
      screen.getByLabelText("More Justify content values").textContent
    ).toContain("inherit");
  });

  it("clears from a button at the row's end, only while a value is set", () => {
    const onCommit = mount("safe center");

    fireEvent.click(
      screen.getByRole("button", { name: "Clear Justify content" })
    );
    expect(onCommit).toHaveBeenLastCalledWith(null);

    cleanup();
    mount();
    expect(
      screen.queryByRole("button", { name: "Clear Justify content" })
    ).toBeNull();
  });

  it("marks every control invalid when the last value was refused", () => {
    mount("center", "refusal");

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-invalid")).toBe("true");
    }
    const more = screen.getByLabelText("More Justify content values");
    expect(more.getAttribute("aria-invalid")).toBe("true");
    expect(more.getAttribute("aria-describedby")).toBe("refusal");
  });

  it("draws More as the strip's last segment, not on a line of its own", () => {
    mount();

    const strip = screen
      .getByRole("radiogroup")
      .closest(".nx-icon-choice__strip");
    expect(strip).toBeTruthy();
    expect(
      strip?.contains(screen.getByLabelText("More Justify content values"))
    ).toBe(true);
  });

  it("lets the field's label point at a radio, so clicking it focuses the group", () => {
    // A label's `for` reaches only a labelable element: the group's tab stop.
    mount("end");

    const target = document.getElementById("field");
    expect(target?.getAttribute("role")).toBe("radio");
    expect(target?.getAttribute("aria-label")).toBe("End");
    // The group keeps its name from the label all the same.
    expect(screen.getByRole("radiogroup").getAttribute("aria-labelledby")).toBe(
      "label"
    );
  });
});
