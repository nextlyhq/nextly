/**
 * The editor's bar outline and the table outline are drawn from the layout
 * sources of the parts they stand in for, so the real parts land where the
 * outline drew them. jsdom lays nothing out, so each is asserted on the classes
 * and attributes that ARE the geometry; the production browser suite
 * (`e2e/tests/loading-frame.spec.ts`) measures the moves themselves.
 *
 * The separating properties:
 *
 * - the bar outline stands in the bar on its own, and the bar's `end` place
 *   gives up its box while it holds only that stand-in. An outline drawn in
 *   the place's box is pushed along by the document's trail when it arrives.
 * - every outline row ends in the row actions' column holding the trigger's
 *   own box, which sets a real row's height, and the pager's frame follows
 *   the rows. Rows of a height of their own, or no pager, leave everything
 *   under the table to move when the rows land.
 */
import { buttonVariants } from "@nextlyhq/ui";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  BAR_ICON_CONTROL,
  PANEL_TOGGLE_RULE,
} from "@admin/components/features/entries/EntryForm/bar-controls";
import { DashboardHeader } from "@admin/components/layout/header/DashboardHeader";
import {
  STAND_IN_ATTRIBUTE,
  STAND_IN_PLACE,
  TopBarPlacesProvider,
} from "@admin/components/layout/header/TopBarPlaces";
import { PAGER_FRAME } from "@admin/components/shared/pagination/pager-layout";
import {
  ROW_ACTIONS_COLUMN,
  ROW_ACTIONS_TRIGGER,
} from "@admin/components/ui/table/data-table/row-actions";

import { EditorOutline, ScreenOutline, TableOutline } from "../outlines";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));

/** The class names of `element`, one by one. */
const classesOf = (element: Element): string[] =>
  element.className.toString().split(/\s+/).filter(Boolean);

/** The editor's outline, drawn in the admin's bar as an editor draws it. */
function drawEditorOutline(creating = false) {
  render(
    <TopBarPlacesProvider>
      <DashboardHeader />
      <EditorOutline creating={creating} />
    </TopBarPlacesProvider>
  );
  const place = document.querySelector('[data-top-bar-place="end"]');
  expect(place, "the bar's end place").not.toBeNull();
  return place as HTMLElement;
}

describe("the editor's bar outline", () => {
  it("stands in the bar on its own, the end place giving up its box while it holds it", () => {
    const place = drawEditorOutline();
    const outline = screen.getByTestId("editor-bar-outline");
    // The outline is the place's own child and carries the mark the place's
    // class looks for, the one that takes the place's box away.
    expect(outline.parentElement).toBe(place);
    expect(outline.hasAttribute(STAND_IN_ATTRIBUTE)).toBe(true);
    expect(classesOf(place)).toContain(STAND_IN_PLACE);
    expect(STAND_IN_PLACE).toContain(`[${STAND_IN_ATTRIBUTE}]`);
  });

  it("draws a saved document's More and panel toggle as the bar draws them", () => {
    drawEditorOutline();
    const outline = screen.getByTestId("editor-bar-outline");
    for (const name of ["More actions", "Document panel"]) {
      const control = within(outline).getByRole("button", { name });
      expect(classesOf(control)).toContain(BAR_ICON_CONTROL.className);
    }
    expect(
      outline.querySelector(`[class="${PANEL_TOGGLE_RULE}"]`)
    ).not.toBeNull();
  });

  it("draws no More or panel toggle for a new document, whose bar has neither", () => {
    drawEditorOutline(true);
    const outline = screen.getByTestId("editor-bar-outline");
    expect(within(outline).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("the table outline", () => {
  it("ends every row in the row actions' column, holding the trigger's own box", () => {
    const { container } = render(<TableOutline headers={["Title", "Slug"]} />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThan(0);
    const trigger = buttonVariants(ROW_ACTIONS_TRIGGER).split(/\s+/);
    for (const row of rows) {
      const last = row.lastElementChild as HTMLElement;
      expect(last.className).toContain(ROW_ACTIONS_COLUMN);
      const box = last.firstElementChild as HTMLElement;
      expect(classesOf(box)).toEqual(expect.arrayContaining(trigger));
    }
    // The head keeps the column too.
    const head = container.querySelector("thead tr")!.lastElementChild!;
    expect(head.className).toContain(ROW_ACTIONS_COLUMN);
  });

  it("follows the rows with the pager's frame, inside the table's card", () => {
    const { container } = render(<TableOutline />);
    const table = container.querySelector("table")!;
    const card = container.firstElementChild as HTMLElement;
    const pager = card.lastElementChild as HTMLElement;
    expect(pager.className).toBe(PAGER_FRAME);
    expect(card.contains(table)).toBe(true);
    expect(
      table.compareDocumentPosition(pager) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

describe("an outline not yet due", () => {
  it("is laid out but not drawn, so it holds its parts' place from the first paint", () => {
    render(
      <ScreenOutline>
        <TableOutline />
      </ScreenOutline>
    );
    const outline = screen.getByTestId("screen-outline");
    // Before 0.4 s: its parts are there, taking their room, and unseen.
    expect(outline.hasAttribute("data-outline-shown")).toBe(false);
    expect(classesOf(outline)).toContain("invisible");
    expect(outline.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
  });
});
