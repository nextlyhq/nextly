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
import { InheritedValue } from "./inherited-value";
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

/** Display as icons, with a stored and an inherited value. */
function mountDisplay(stored?: string, inherited?: string) {
  const onCommit = vi.fn(() => "applied" as const);
  const display = alignmentGroupFor(
    "display",
    ["block", "flex", "grid", "none", "inline", "table"],
    { writingMode: "horizontal-tb", rtl: false, flex: false, direction: "row" }
  )!;
  render(
    <InheritedValue.Provider value={inherited}>
      <span id="display-label">Display</span>
      <IconChoiceField
        id="display"
        labelledBy="display-label"
        group={display}
        stored={stored}
        actionName="Display"
        describedBy={undefined}
        onCommit={onCommit}
      />
    </InheritedValue.Provider>
  );
  return onCommit;
}

function mount(stored?: string, describedBy?: string, inherited?: string) {
  const onCommit = vi.fn(() => "applied" as const);
  render(
    <InheritedValue.Provider value={inherited}>
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
    </InheritedValue.Provider>
  );
  return onCommit;
}

describe("IconChoiceField", () => {
  it("marks the inherited value's icon, without choosing it, while nothing is set here", () => {
    mount(undefined, undefined, "center");
    const marked = screen
      .getAllByRole("radio")
      .filter(radio => radio.hasAttribute("data-inherited"));
    expect(marked.map(radio => radio.getAttribute("aria-label"))).toEqual([
      screen.getByRole("radio", { name: /center/i }).getAttribute("aria-label"),
    ]);
    // Marked, not checked: nothing is stored on this block.
    expect(marked[0]?.getAttribute("aria-checked")).toBe("false");
    // Said as well as drawn: a screen reader otherwise hears every option
    // unchecked and cannot tell which value applies.
    expect(marked[0]?.getAttribute("aria-label")).toBe("Center, inherited");
  });

  it("rings More when the inherited value is one of its values", () => {
    // "normal" has no icon: it lives in More, which then says what applies.
    mount(undefined, undefined, "normal");
    const more = screen.getByLabelText(/^More Justify content values/);
    expect(more.hasAttribute("data-inherited")).toBe(true);
    expect(more.getAttribute("aria-label")).toBe(
      "More Justify content values, showing Default"
    );
    expect(
      screen
        .getAllByRole("radio")
        .some(radio => radio.hasAttribute("data-inherited"))
    ).toBe(false);
  });

  it("marks nothing once a value is set here", () => {
    mount("start", undefined, "center");
    expect(
      screen
        .getAllByRole("radio")
        .some(radio => radio.hasAttribute("data-inherited"))
    ).toBe(false);
  });

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
    expect(more.textContent).toContain("Safe center");
    // No icon is chosen for a value the icons do not draw.
    expect(
      screen
        .getAllByRole("radio")
        .some(radio => radio.getAttribute("aria-checked") === "true")
    ).toBe(false);
  });

  it("names the values in More in words, each CSS spelling in its tooltip", () => {
    mount();
    fireEvent.click(screen.getByLabelText("More Justify content values"));
    const option = screen.getByRole("option", { name: "Default" });
    expect(option.getAttribute("title")).toBe("normal");
    expect(screen.queryByRole("option", { name: "normal" })).toBeNull();
  });

  it("draws Display's own icons, not the stand-in", () => {
    const display = alignmentGroupFor(
      "display",
      ["block", "flex", "grid", "none", "inline"],
      {
        writingMode: "horizontal-tb",
        rtl: false,
        flex: false,
        direction: "row",
      }
    )!;
    render(
      <IconChoiceField
        id="display"
        labelledBy="label"
        group={display}
        stored={undefined}
        actionName="Display"
        describedBy={undefined}
        onCommit={() => "applied"}
      />
    );
    for (const name of ["Block", "Flex", "Grid", "Hidden"]) {
      const radio = screen.getByRole("radio", { name });
      expect(radio.querySelector("svg")?.getAttribute("class")).not.toContain(
        "lucide-circle"
      );
    }
  });

  it("chooses the icon a stored spelling names, as CSS reads a keyword", () => {
    // An imported `FLEX` is the flex the Flex icon stands for: chosen, not a
    // second "Flex" under More, and pressing it clears the value.
    const onCommit = mountDisplay("FLEX");
    const flex = screen.getByRole("radio", { name: "Flex" });
    expect(flex.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByLabelText("More Display values").textContent
    ).not.toContain("Flex");
    fireEvent.click(flex);
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("shows an inherited value no icon or listed value carries, in More", () => {
    // A `table` reaching this block from another tier is live on the canvas,
    // so the field says so rather than showing nothing at all.
    mountDisplay(undefined, "table");
    expect(
      screen.getByLabelText(/^More Display values, showing /)
    ).toBeDefined();
  });

  it("says what the fit that applies does, under the icons", () => {
    const fit = alignmentGroupFor(
      "object-fit",
      ["fill", "contain", "cover", "none", "scale-down"],
      {
        writingMode: "horizontal-tb",
        rtl: false,
        flex: false,
        direction: "row",
      }
    )!;
    const { rerender } = render(
      <IconChoiceField
        id="fit"
        labelledBy="label"
        group={fit}
        stored="cover"
        actionName="Object fit"
        describedBy={undefined}
        onCommit={() => "applied"}
      />
    );
    expect(screen.getByText("Fills the box; edges may be cut.")).toBeDefined();
    // An inherited fit is said too: it is the one the canvas draws.
    rerender(
      <InheritedValue.Provider value="contain">
        <IconChoiceField
          id="fit"
          labelledBy="label"
          group={fit}
          stored={undefined}
          actionName="Object fit"
          describedBy={undefined}
          onCommit={() => "applied"}
        />
      </InheritedValue.Provider>
    );
    expect(screen.queryByText("Fills the box; edges may be cut.")).toBeNull();
    expect(screen.getByText("Shows all of it inside the box.")).toBeDefined();
  });

  it("shows a stored spelling neither the icons nor the list carry, in More", () => {
    // The engine accepts spellings outside the catalogue's list, "inherit"
    // among them; shown as unset, an active declaration would look absent.
    mount("inherit");

    // In words, as every value in More is.
    expect(
      screen.getByLabelText("More Justify content values").textContent
    ).toContain("Inherit");
  });

  it("leaves clearing to the row's reset, with no Clear of its own", () => {
    mount("safe center");

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
