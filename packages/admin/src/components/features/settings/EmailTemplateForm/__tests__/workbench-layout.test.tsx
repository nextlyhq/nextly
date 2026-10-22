/**
 * The workbench at each width: which regions are on screen, and that the side
 * sheet never takes the preview's place.
 *
 * The width is the workbench's own, so these set it through the measured box
 * rather than the window.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WorkbenchLayout,
  type RevealRequest,
  type SheetPanel,
} from "../WorkbenchLayout";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function atWidth(width: number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height: 800,
    top: 0,
    left: 0,
    right: width,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

function mount({
  sheet = null,
  data = <p>sample data</p>,
}: {
  sheet?: SheetPanel | null;
  data?: React.ReactNode | null;
}) {
  const onSheetChange = vi.fn();
  const header = vi.fn(tier => <h1>header at {tier}</h1>);
  const layout = (revealRequest: RevealRequest) => (
    <WorkbenchLayout
      revealRequest={revealRequest}
      splitLabel="Editor and preview"
      header={header}
      content={<p>the content</p>}
      preview={<p>the preview</p>}
      data={data}
      details={<p>the details</p>}
      sheet={sheet}
      onSheetChange={onSheetChange}
      phoneBar={<button type="button">Save</button>}
    />
  );
  const { rerender } = render(layout({ panel: "edit", seq: 0 }));
  return {
    onSheetChange,
    header,
    reveal: (panel: RevealRequest["panel"], seq: number) =>
      rerender(layout({ panel, seq })),
  };
}

describe("on a desktop", () => {
  it("puts the content beside the preview, and the sheet beside both", () => {
    atWidth(1440);
    mount({ sheet: "details" });
    expect(screen.getByText("header at desktop")).toBeDefined();
    expect(screen.getByText("the content")).toBeDefined();
    expect(screen.getByText("the preview")).toBeDefined();
    expect(screen.getByText("the details")).toBeDefined();
    // The sheet is a column of its own, outside the preview's pane.
    const preview = screen.getByTestId("workbench-preview");
    const sheet = screen.getByTestId("workbench-sheet");
    expect(preview.contains(sheet)).toBe(false);
    expect(screen.getByRole("separator")).toBeDefined();
  });

  it("shows no sheet until one is asked for", () => {
    atWidth(1280);
    mount({ sheet: null });
    expect(screen.queryByTestId("workbench-sheet")).toBeNull();
    expect(screen.getByText("the content")).toBeDefined();
  });

  it("switches the sheet between Test data and Details, and closes it", () => {
    atWidth(1440);
    const { onSheetChange } = mount({ sheet: "data" });
    expect(screen.getByText("sample data")).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(onSheetChange).toHaveBeenLastCalledWith("details");
    fireEvent.click(
      screen.getByRole("button", { name: "Close the side sheet" })
    );
    expect(onSheetChange).toHaveBeenLastCalledWith(null);
  });
});

describe("on a tablet", () => {
  it("gives the content's pane to an open sheet, keeping the preview", () => {
    atWidth(768);
    mount({ sheet: "details" });
    expect(screen.getByText("header at tablet")).toBeDefined();
    expect(screen.getByText("the details")).toBeDefined();
    expect(screen.getByText("the preview")).toBeDefined();
    expect(screen.queryByText("the content")).toBeNull();
    // Two equal panes: nothing to drag.
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("closes its sheet when a refused save's message is in the editor", () => {
    atWidth(768);
    const { onSheetChange, reveal } = mount({ sheet: "details" });
    expect(onSheetChange).not.toHaveBeenCalled();
    reveal("edit", 1);
    expect(onSheetChange).toHaveBeenCalledWith(null);
  });

  it("shows content and preview side by side with the sheet closed", () => {
    atWidth(1024);
    mount({ sheet: null });
    expect(screen.getByText("the content")).toBeDefined();
    expect(screen.getByText("the preview")).toBeDefined();
  });
});

describe("on a phone", () => {
  it("shows one pane at a time behind four tabs, with the actions in a fixed bar", () => {
    atWidth(390);
    mount({});
    expect(screen.getByText("header at phone")).toBeDefined();
    const tabs = screen.getAllByRole("tab").map(tab => tab.textContent);
    expect(tabs).toEqual(["Edit", "Preview", "Data", "Details"]);
    expect(screen.getByText("the content")).toBeDefined();
    expect(screen.queryByText("the preview")).toBeNull();
    expect(
      screen.getByTestId("workbench-phone-bar").className.includes("fixed")
    ).toBe(true);

    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByText("the preview")).toBeDefined();
    expect(screen.queryByText("the content")).toBeNull();
  });

  it("switches to Details when a refused save's message is there", () => {
    atWidth(390);
    const { reveal } = mount({});
    expect(screen.getByText("the content")).toBeDefined();
    reveal("details", 1);
    expect(
      screen.getByRole("tab", { name: "Details" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(screen.getByText("the details")).toBeDefined();

    // Asked again after the person went back to Edit: it switches again.
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    reveal("details", 2);
    expect(screen.getByText("the details")).toBeDefined();
  });

  it("switches back to Edit when a refused save's message is in the editor", () => {
    atWidth(390);
    const { reveal } = mount({});
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.queryByText("the content")).toBeNull();
    reveal("edit", 1);
    expect(screen.getByText("the content")).toBeDefined();
  });

  it("has no Data tab where there's no test data (a layout)", () => {
    atWidth(390);
    mount({ data: null });
    const tabs = screen.getAllByRole("tab").map(tab => tab.textContent);
    expect(tabs).toEqual(["Edit", "Preview", "Details"]);
  });
});
