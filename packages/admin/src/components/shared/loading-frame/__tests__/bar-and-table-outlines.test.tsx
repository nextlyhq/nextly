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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  FIXED_LAYOUT_TABLE,
  ROW_ACTIONS_COLUMN,
  ROW_ACTIONS_TRIGGER,
  SELECTION_COLUMN,
} from "@admin/components/ui/table/data-table/row-actions";
import {
  LIST_TOOLBAR_CONTROLS,
  LIST_TOOLBAR_ROW,
  LIST_TOOLBAR_SEARCH,
} from "@admin/components/ui/table/list-view/toolbar-layout";
import { DataTableView } from "@admin/components/ui/table/data-table";
import {
  confirmLabels,
  recallLayout,
  rememberLayout,
  resetDeviceMemoryForTests,
} from "@admin/lib/device-memory/device-memory";

import { FIRST_GUESS_ROWS, outlineRowsFor } from "../list-rows";
import {
  EditorOutline,
  ListToolbarOutline,
  ScreenOutline,
  TableOutline,
} from "../outlines";

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

describe("how many rows a list's outline draws", () => {
  it("draws the rows it is given", () => {
    const { container } = render(<TableOutline rows={10} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
  });

  it("guesses five for a list never opened here, else draws as many as it last drew", () => {
    window.localStorage.clear();
    resetDeviceMemoryForTests();
    confirmLabels({ user: "u", schemaVersion: "1", permissionVersion: "p" });
    expect(outlineRowsFor("posts")).toBe(FIRST_GUESS_ROWS);
    rememberLayout("list-rows:posts", 10);
    expect(outlineRowsFor("posts")).toBe(10);
    // A list that drew none drew its empty state, which says nothing of the
    // rows it will draw once it has some.
    rememberLayout("list-rows:posts", 0);
    expect(outlineRowsFor("posts")).toBe(FIRST_GUESS_ROWS);
    expect(outlineRowsFor(undefined)).toBe(FIRST_GUESS_ROWS);
  });
});

describe("a table outline of a list laid out by its columns' widths", () => {
  it("lays its columns out by the same widths, after the selection boxes' column", () => {
    const { container } = render(
      <TableOutline
        selection
        headers={["Name", "Role"]}
        columnWidths={[280, 160]}
      />
    );
    const table = container.querySelector("table")!;
    expect(classesOf(table)).toContain(FIXED_LAYOUT_TABLE);
    const heads = container.querySelectorAll("thead th");
    expect(heads[0].className).toContain(SELECTION_COLUMN);
    expect((heads[1] as HTMLElement).style.width).toBe("280px");
    expect((heads[2] as HTMLElement).style.width).toBe("160px");
    for (const row of container.querySelectorAll("tbody tr")) {
      expect(row.firstElementChild!.className).toContain(SELECTION_COLUMN);
    }
  });

  it("lays its columns out by their content where any width is missing", () => {
    const { container } = render(
      <TableOutline
        headers={["Name", "Role"]}
        columnWidths={[280, undefined]}
      />
    );
    expect(classesOf(container.querySelector("table")!)).not.toContain(
      FIXED_LAYOUT_TABLE
    );
  });
});

describe("a list's toolbar outline", () => {
  it("is laid out by the toolbar's own classes", () => {
    const { container } = render(<ListToolbarOutline />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toBe(LIST_TOOLBAR_ROW);
    expect((row.children[0] as HTMLElement).className).toBe(
      LIST_TOOLBAR_SEARCH
    );
    expect((row.children[1] as HTMLElement).className).toBe(
      LIST_TOOLBAR_CONTROLS
    );
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

describe("how tall a list's pager outline stands", () => {
  /** Every element drawn `width` wide and `height` tall. */
  function drawnAt(width: number, height: number) {
    return vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width, height }));
  }

  beforeEach(() => {
    window.localStorage.clear();
    resetDeviceMemoryForTests();
    confirmLabels({ user: "u", schemaVersion: "1", permissionVersion: "p" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("stands as tall as the list's pager last stood at its width", () => {
    // A pager of several pages, drawn 630 px wide, stood 133 px tall.
    rememberLayout("list-pager:users:20", 133);
    drawnAt(630, 117);
    const { container } = render(<TableOutline list="users" />);
    const pager = container.querySelector('[data-frame-part="list-pager"]');
    expect((pager as HTMLElement).style.height).toBe("133px");
  });

  it("draws one page's pager where none was kept at that width", () => {
    rememberLayout("list-pager:users:20", 133);
    drawnAt(1000, 72);
    const { container } = render(<TableOutline list="users" />);
    const pager = container.querySelector('[data-frame-part="list-pager"]');
    expect((pager as HTMLElement).style.height).toBe("");
  });

  it("keeps how tall the table's pager stood, at its width, for the outline", () => {
    drawnAt(630, 133);
    render(
      <DataTableView
        columns={[{ name: "name", header: "Name" }]}
        rows={[{ id: "1", name: "Ada" }]}
        registryKey="users"
        pagination={{
          currentPage: 0,
          totalPages: 3,
          pageSize: 10,
          onPageChange: () => {},
        }}
      />
    );
    expect(recallLayout("list-pager:users:20")).toBe(133);
  });
});
