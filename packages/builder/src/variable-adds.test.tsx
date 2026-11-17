// @vitest-environment jsdom

/**
 * Adding happens where the author is: every list ends with its own add row,
 * and pressing it adds the variable as the last row of that group, keeps the
 * search, and opens the new row's editor beside it with its name focused. A
 * new row a search would hide stays shown, marked "New", until its editor
 * closes.
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { TokensPanel } from "./tokens-panel";
import type { VariableGroup } from "./tokens-studio";

afterEach(cleanup);

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => undefined;
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

const SITE: SiteTokenSet = {
  tokens: [
    { name: "color.brand", kind: "color", values: { light: "#1d2b6b" } },
    { name: "color.text", kind: "color", values: { light: "#3b3f46" } },
    { name: "font-size.body", kind: "dimension", values: { light: "16px" } },
    { name: "line-height.body", kind: "number", values: { light: "1.5" } },
    { name: "space.4", kind: "dimension", values: { light: "1rem" } },
    { name: "radius.md", kind: "dimension", values: { light: "8px" } },
    {
      name: "shadow.soft",
      kind: "shadow",
      values: { light: "0 1px 2px rgb(0 0 0 / 0.1)" },
    },
    { name: "font.heading", kind: "fontFamily", values: { light: "serif" } },
    { name: "size.wide", kind: "dimension", values: { light: "72rem" } },
  ],
};

/** The panel under a host that keeps the search and the variables. */
function Host({
  tokens = SITE,
  groups,
  initialSearch = "",
}: {
  tokens?: SiteTokenSet;
  groups?: readonly VariableGroup[];
  initialSearch?: string;
}): React.JSX.Element {
  const [set, setSet] = React.useState(tokens);
  const latest = React.useRef(set);
  const [search] = React.useState(initialSearch);
  return (
    <TokensPanel
      tokens={set}
      currentTokens={() => latest.current}
      onChange={next => {
        latest.current = next;
        setSet(next);
      }}
      search={search}
      {...(groups === undefined ? {} : { groups })}
    />
  );
}

const group = (id: VariableGroup): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-group="${id}"]`);
  if (found === null) throw new Error(`no group ${id}`);
  return found;
};

/** The add rows a group ends with, by their names, in order. */
const addRows = (id: VariableGroup): string[] =>
  [...group(id).querySelectorAll<HTMLElement>(".nx-vars__add-row")].map(
    add => add.getAttribute("aria-label") ?? add.textContent ?? ""
  );

describe("the add rows", () => {
  it("ends each list with its own add row, and the headings have none", () => {
    render(<Host />);
    expect(addRows("colours")).toEqual(["Add colour"]);
    expect(addRows("type")).toEqual(["Add type size"]);
    expect(addRows("spacing")).toEqual([
      "Add spacing",
      "Add radius",
      "Add shadow",
    ]);
    expect(addRows("fonts")).toEqual(["Add font", "Add font weight"]);
    expect(addRows("other")).toEqual(["Add value"]);
    for (const id of [
      "colours",
      "type",
      "spacing",
      "fonts",
      "other",
    ] as const) {
      const head = group(id).querySelector(".nx-vars__group-head");
      expect(head?.querySelector("button[aria-label^='Add']")).toBeNull();
      // After the last row, not before it.
      const list = group(id).querySelector(".nx-vars__list");
      const add = group(id).querySelector(".nx-vars__add-row");
      expect(
        list !== null &&
          add !== null &&
          list.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  });

  it('shows a plus and the words "Add colour"', () => {
    render(<Host />);
    const add = within(group("colours")).getByRole("button", {
      name: "Add colour",
    });
    expect(add.textContent).toBe("Add colour");
    expect(add.querySelector("svg")).not.toBeNull();
  });

  it("offers each other kind from Add value", async () => {
    render(<Host />);
    fireEvent.pointerDown(
      within(group("other")).getByRole("button", { name: "Add value" }),
      { button: 0, ctrlKey: false }
    );
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map(item => item.textContent)
    ).toEqual(["Size", "Number", "Duration", "Custom value"]);
  });

  it("keeps an empty group's line, with its add row under it", () => {
    render(<Host tokens={{ tokens: SITE.tokens.slice(2) }} />);
    const colours = group("colours");
    expect(colours.textContent).toContain("No colours yet.");
    expect(addRows("colours")).toEqual(["Add colour"]);
  });

  it("adds a radius from its own row", async () => {
    render(<Host />);
    fireEvent.click(
      within(group("spacing")).getByRole("button", { name: "Add radius" })
    );
    expect(
      await screen.findByRole("dialog", { name: "Edit New radius" })
    ).toBeDefined();
  });
});

describe("pressing an add row", () => {
  it("adds the colour as the last row of its group and opens it with the name focused", async () => {
    render(<Host />);
    fireEvent.click(
      within(group("colours")).getByRole("button", { name: "Add colour" })
    );
    const editor = await screen.findByRole("dialog", {
      name: "Edit New colour",
    });
    const names = [
      ...group("colours").querySelectorAll(".nx-vars__row .nx-vars__name"),
    ].map(name => name.textContent);
    expect(names).toEqual(["Brand", "Text", "New colour"]);
    const name = within(editor).getByLabelText("Name");
    await waitFor(() => expect(document.activeElement).toBe(name));
  });

  it("keeps the search, and shows the new row marked New while it does not match", async () => {
    render(<Host initialSearch="brand" />);
    fireEvent.click(
      within(group("colours")).getByRole("button", { name: "Add colour" })
    );
    await screen.findByRole("dialog", { name: "Edit New colour" });
    const rows = [...group("colours").querySelectorAll("li")];
    expect(
      rows.map(row => row.querySelector(".nx-vars__name")?.textContent)
    ).toEqual(["Brand", "New colour"]);
    const added = rows[1];
    expect(added?.querySelector(".nx-vars__new")?.textContent).toBe("New");
    expect(rows[0]?.querySelector(".nx-vars__new")).toBeNull();
  });

  it("lets the new row go once its editor closes, where the search does not match it", async () => {
    render(<Host initialSearch="brand" />);
    fireEvent.click(
      within(group("colours")).getByRole("button", { name: "Add colour" })
    );
    const editor = await screen.findByRole("dialog", {
      name: "Edit New colour",
    });
    fireEvent.keyDown(within(editor).getByLabelText("Name"), {
      key: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      [...group("colours").querySelectorAll(".nx-vars__name")].map(
        name => name.textContent
      )
    ).toEqual(["Brand"]);
  });

  it("hands focus back to the add row it came from when a search hides the new row, from a menu too", async () => {
    // "wide" lists the other values, so their add row is drawn; the new
    // size does not match it, so its row goes once its editor closes.
    render(<Host initialSearch="wide" />);
    const addValue = (): HTMLElement =>
      within(group("other")).getByRole("button", { name: "Add value" });
    fireEvent.keyDown(addValue(), { key: "Enter" });
    // Chosen from the keyboard: focus is on the item, which goes with the
    // menu, not on the add row.
    const item = await screen.findByRole("menuitem", { name: "Size" });
    item.focus();
    fireEvent.click(item);
    const editor = await screen.findByRole("dialog", { name: "Edit New size" });
    fireEvent.keyDown(within(editor).getByLabelText("Name"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      document.querySelector('[data-variable-key="size.new-size"]')
    ).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(addValue()));
  });

  it("hands focus back to a one-kind add row the same way", async () => {
    render(<Host initialSearch="brand" />);
    const addColour = (): HTMLElement =>
      within(group("colours")).getByRole("button", { name: "Add colour" });
    fireEvent.click(addColour());
    const editor = await screen.findByRole("dialog", {
      name: "Edit New colour",
    });
    fireEvent.keyDown(within(editor).getByLabelText("Name"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(addColour()));
  });

  it("marks nothing New where the new row matches the search", async () => {
    // "e" matches "Text", so the colours are listed, and "New colour" too.
    render(<Host initialSearch="e" />);
    fireEvent.click(screen.getByRole("button", { name: "Add colour" }));
    await screen.findByRole("dialog", { name: "Edit New colour" });
    expect(document.querySelector(".nx-vars__new")).toBeNull();
  });

  it("hides a group the search empties, its add rows with it, while another group still adds", async () => {
    render(<Host initialSearch="brand" groups={["colours", "spacing"]} />);
    // Spacing matches nothing, so its list and add row are gone with it;
    // the colour group's add still adds where it is.
    expect(document.querySelector('[data-group="spacing"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add colour" }));
    expect(
      await screen.findByRole("dialog", { name: "Edit New colour" })
    ).toBeDefined();
  });
});
