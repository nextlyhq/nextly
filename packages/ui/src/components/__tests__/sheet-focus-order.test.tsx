// @vitest-environment jsdom
/**
 * Where Tab goes at a sheet's edges. A modal sheet holds focus: Tab from its last control goes
 * round to its first. A sheet that is not modal sits beside the page, so the keyboard moves
 * between the two: Tab from its last control leaves it, and Shift+Tab from its first goes back
 * into the page, as they would for any other part of the page.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../sheet";

afterEach(() => {
  cleanup();
  document.getElementById("after-the-sheet")?.remove();
});

function renderBesidePage(modal: boolean) {
  render(
    <>
      <button type="button">In the page</button>
      <button type="button">Further down the page</button>
      <Sheet open modal={modal}>
        <SheetContent side="right">
          <SheetTitle>History</SheetTitle>
          <SheetDescription>Versions</SheetDescription>
          {/* Not drawn at this width: no stop for the keyboard, nor an edge. */}
          <button type="button" style={{ display: "none" }}>
            Only on a phone
          </button>
          <button type="button">First in the sheet</button>
          <button type="button">Last in the sheet</button>
        </SheetContent>
      </Sheet>
    </>
  );
  // Something drawn after the sheet in the document, as another popup's portal is.
  const after = document.createElement("button");
  after.id = "after-the-sheet";
  after.type = "button";
  after.textContent = "After the sheet";
  document.body.appendChild(after);
}

const button = (name: string) => screen.getByRole("button", { name });

describe("a sheet that is not modal", () => {
  it("lets Tab leave from its last control, to what follows the sheet", () => {
    renderBesidePage(false);
    const last = button("Last in the sheet");
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(button("After the sheet"));
  });

  it("lets Shift+Tab go back from its first control, to what comes before the sheet", () => {
    renderBesidePage(false);
    const first = button("First in the sheet");
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(button("Further down the page"));
  });
});

describe("a sheet that is not modal and holds nothing to focus", () => {
  it("lets Tab leave from the sheet itself", () => {
    render(
      <>
        <button type="button">In the page</button>
        <Sheet open modal={false}>
          <SheetContent side="right">
            <SheetTitle>History</SheetTitle>
            <SheetDescription>Loading…</SheetDescription>
          </SheetContent>
        </Sheet>
      </>
    );
    const after = document.createElement("button");
    after.id = "after-the-sheet";
    after.type = "button";
    after.textContent = "After the sheet";
    document.body.appendChild(after);
    // With nothing inside to focus, the sheet itself holds focus.
    const sheet = screen.getByRole("dialog");
    sheet.focus();
    fireEvent.keyDown(sheet, { key: "Tab" });
    expect(document.activeElement).toBe(after);
  });
});

describe("a modal sheet", () => {
  it("keeps focus inside: Tab from its last control goes round to its first", () => {
    renderBesidePage(true);
    const last = screen.getByRole("button", {
      name: "Last in the sheet",
      hidden: true,
    });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "First in the sheet", hidden: true })
    );
  });
});
