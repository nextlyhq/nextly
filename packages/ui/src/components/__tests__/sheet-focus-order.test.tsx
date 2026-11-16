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

afterEach(cleanup);

function renderBesidePage(modal: boolean) {
  render(
    <>
      <button type="button">In the page</button>
      <button type="button">Further down the page</button>
      <Sheet open modal={modal}>
        <SheetContent side="right">
          <SheetTitle>History</SheetTitle>
          <SheetDescription>Versions</SheetDescription>
          <button type="button">First in the sheet</button>
          <button type="button">Last in the sheet</button>
        </SheetContent>
      </Sheet>
    </>
  );
}

const button = (name: string) => screen.getByRole("button", { name });

describe("a sheet that is not modal", () => {
  it("lets Tab leave from its last control", () => {
    renderBesidePage(false);
    const last = button("Last in the sheet");
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(button("In the page"));
  });

  it("lets Shift+Tab go back into the page from its first control", () => {
    renderBesidePage(false);
    const first = button("First in the sheet");
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(button("Further down the page"));
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
