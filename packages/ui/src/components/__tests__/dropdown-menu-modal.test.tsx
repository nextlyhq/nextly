// @vitest-environment jsdom
/**
 * An open menu leaves the page around it in the accessibility tree. A modal
 * menu marked every control beside it `aria-hidden` while they stayed
 * focusable, which hid the page from a screen reader without taking it out
 * of reach (axe: `aria-hidden-focus`). A caller that needs a menu to hold
 * the page still asks for it with `modal`.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../dropdown-menu";

afterEach(cleanup);

function openMenu(modal?: boolean): HTMLElement {
  render(
    <div>
      <button type="button">Beside the menu</button>
      <DropdownMenu open {...(modal === undefined ? {} : { modal })}>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Open as form</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
  expect(screen.getByRole("menu")).toBeTruthy();
  // The control beside the menu, found whether or not it is hidden.
  const beside = document.querySelector("button");
  if (beside === null) throw new Error("the control beside the menu is gone");
  return beside;
}

/** Whether an element, or anything around it, is hidden from assistive technology. */
function hiddenFromReaders(element: Element): boolean {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    if (at.getAttribute("aria-hidden") === "true") return true;
  }
  return false;
}

describe("DropdownMenu", () => {
  it("leaves the page beside an open menu to screen readers by default", () => {
    expect(hiddenFromReaders(openMenu())).toBe(false);
  });

  it("still hides the page when a caller asks for a modal menu", () => {
    expect(hiddenFromReaders(openMenu(true))).toBe(true);
  });
});
