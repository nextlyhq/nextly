// @vitest-environment jsdom

/**
 * The Colours tab's named groups, and moving a colour by its ⋯ menu and by
 * Alt+Up and Alt+Down.
 */
import {
  MAX_TOKEN_LABEL_LENGTH,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { colourGroups } from "./colour-groups";
import { TokensPanel } from "./tokens-panel";

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
    {
      name: "color.brand",
      kind: "color",
      group: "Brand",
      values: { light: "#1d2b6b" },
    },
    {
      name: "color.accent",
      kind: "color",
      group: "Brand",
      values: { light: "#c98a3c" },
    },
    {
      name: "color.text",
      kind: "color",
      group: "Text and surfaces",
      values: { light: "#3b3f46" },
    },
    { name: "color.muted", kind: "color", values: { light: "#6b7280" } },
  ],
};

/** The latest set the panel wrote, by test. */
let saved: SiteTokenSet = SITE;

function Host({ readOnly = false }: { readOnly?: boolean }): React.JSX.Element {
  const [set, setSet] = React.useState(SITE);
  const latest = React.useRef(set);
  return (
    <TokensPanel
      tokens={set}
      currentTokens={() => latest.current}
      readOnly={readOnly}
      groups={["colours"]}
      onChange={next => {
        latest.current = next;
        saved = next;
        setSet(next);
      }}
    />
  );
}

/** The groups as `name: identities`, as the panel lists them. */
const shape = (set: SiteTokenSet) =>
  colourGroups(set).map(
    group => `${group.name}: ${group.identities.join(" ")}`
  );

/** The rows each named group lists, by the name shown. */
function listed(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-colour-group]")].map(
    section =>
      `${section.dataset.colourGroup ?? ""}: ${[
        ...section.querySelectorAll(".nx-vars__row .nx-vars__name"),
      ]
        .map(name => name.textContent)
        .join(", ")}`
  );
}

/** Opens a row's ⋯ menu from the keyboard, as Radix menus open in jsdom. */
async function openMenu(row: string): Promise<HTMLElement> {
  fireEvent.keyDown(
    screen.getByRole("button", { name: `More actions for ${row}` }),
    { key: "Enter" }
  );
  return screen.findByRole("menu");
}

describe("the Colours tab's groups", () => {
  it("lists each colour under its named group, in order", () => {
    render(<Host />);
    expect(listed()).toEqual([
      "Brand: Brand, Accent",
      "Text and surfaces: Text, Muted",
    ]);
  });
});

describe("moving a colour", () => {
  it("moves down by its ⋯ menu, across into the next group at its end", async () => {
    render(<Host />);
    fireEvent.click(
      within(await openMenu("Accent")).getByRole("menuitem", {
        name: "Move down",
      })
    );
    expect(shape(saved)).toEqual([
      "Brand: color.brand",
      "Text and surfaces: color.accent color.text color.muted",
    ]);
  });

  it("moves up by its ⋯ menu, and offers no Move up at the very top", async () => {
    render(<Host />);
    expect(
      within(await openMenu("Brand")).getByRole("menuitem", { name: "Move up" })
    ).toHaveProperty("ariaDisabled", "true");
    cleanup();
    render(<Host />);
    fireEvent.click(
      within(await openMenu("Muted")).getByRole("menuitem", { name: "Move up" })
    );
    expect(shape(saved)).toEqual([
      "Brand: color.brand color.accent",
      "Text and surfaces: color.muted color.text",
    ]);
  });

  it("moves to another group from Move to group…", async () => {
    render(<Host />);
    const menu = await openMenu("Brand");
    fireEvent.keyDown(
      within(menu).getByRole("menuitem", { name: "Move to group…" }),
      {
        key: "ArrowRight",
      }
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Text and surfaces" })
    );
    expect(shape(saved)).toEqual([
      "Brand: color.accent",
      "Text and surfaces: color.text color.muted color.brand",
    ]);
  });

  it("moves with Alt+Up and Alt+Down on its row", () => {
    render(<Host />);
    fireEvent.keyDown(screen.getByRole("button", { name: /^Text,/ }), {
      key: "ArrowUp",
      altKey: true,
    });
    expect(shape(saved)).toEqual([
      "Brand: color.brand color.accent color.text",
      "Text and surfaces: color.muted",
    ]);
  });

  it("offers no moves where the colours are read-only", () => {
    render(<Host readOnly />);
    expect(
      screen.queryByRole("button", { name: /^More actions for Brand/ })
    ).toBeNull();
  });
});

/** Opens a named group's ⋯ menu. */
async function openGroupMenu(group: string): Promise<HTMLElement> {
  fireEvent.keyDown(
    screen.getByRole("button", { name: `More actions for group ${group}` }),
    { key: "Enter" }
  );
  return screen.findByRole("menu");
}

/** A drag's data, as jsdom has none of its own. */
const dataTransfer = () => {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    effectAllowed: "move",
    dropEffect: "move",
  };
};

describe("a group's ⋯ menu", () => {
  it("renames a group in place", async () => {
    render(<Host />);
    fireEvent.click(
      within(await openGroupMenu("Brand")).getByRole("menuitem", {
        name: "Rename group",
      })
    );
    const field = await screen.findByRole("textbox", { name: "Group name" });
    fireEvent.change(field, { target: { value: "Accents" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(shape(saved)).toEqual([
      "Accents: color.brand color.accent",
      "Text and surfaces: color.text color.muted",
    ]);
  });

  it("removes a group, its colours joining the group above", async () => {
    render(<Host />);
    fireEvent.click(
      within(await openGroupMenu("Text and surfaces")).getByRole("menuitem", {
        name: "Remove group",
      })
    );
    expect(shape(saved)).toEqual([
      "Brand: color.brand color.accent color.text color.muted",
    ]);
  });
});

describe("+ New group", () => {
  it("adds a group to name, which a colour then moves into", async () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "New group" }));
    const field = await screen.findByRole("textbox", { name: "Group name" });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "Accents" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(listed()).toEqual([
      "Brand: Brand, Accent",
      "Text and surfaces: Text, Muted",
      "Accents: ",
    ]);
    const menu = await openMenu("Accent");
    fireEvent.keyDown(
      within(menu).getByRole("menuitem", { name: "Move to group…" }),
      { key: "ArrowRight" }
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Accents" }));
    expect(shape(saved)).toEqual([
      "Brand: color.brand",
      "Text and surfaces: color.text color.muted",
      "Accents: color.accent",
    ]);
  });
});

describe("a group's name", () => {
  it("is no longer than a stored label, and a longer one keeps the old name", async () => {
    saved = SITE;
    render(<Host />);
    fireEvent.click(
      within(await openGroupMenu("Brand")).getByRole("menuitem", {
        name: "Rename group",
      })
    );
    const field = await screen.findByRole<HTMLInputElement>("textbox", {
      name: "Group name",
    });
    expect(field.maxLength).toBe(MAX_TOKEN_LABEL_LENGTH);
    fireEvent.change(field, {
      target: { value: "A".repeat(MAX_TOKEN_LABEL_LENGTH + 1) },
    });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(saved).toBe(SITE);
    expect(listed()[0]).toBe("Brand: Brand, Accent");
  });

  it("keeps a new group's draft name where the one typed could not be stored", async () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "New group" }));
    const field = await screen.findByRole("textbox", { name: "Group name" });
    fireEvent.change(field, {
      // A tab: a control character, which a label refuses and a field keeps.
      target: { value: "Tab\there" },
    });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(listed()).toEqual([
      "Brand: Brand, Accent",
      "Text and surfaces: Text, Muted",
      "New group: ",
    ]);
  });
});

describe("a new group a colour has moved into", () => {
  it("does not come back empty once renamed or removed", async () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "New group" }));
    const field = await screen.findByRole("textbox", { name: "Group name" });
    fireEvent.change(field, { target: { value: "Accents" } });
    fireEvent.keyDown(field, { key: "Enter" });
    const menu = await openMenu("Accent");
    fireEvent.keyDown(
      within(menu).getByRole("menuitem", { name: "Move to group…" }),
      { key: "ArrowRight" }
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Accents" }));
    fireEvent.click(
      within(await openGroupMenu("Accents")).getByRole("menuitem", {
        name: "Rename group",
      })
    );
    const rename = await screen.findByRole("textbox", { name: "Group name" });
    fireEvent.change(rename, { target: { value: "Highlights" } });
    fireEvent.keyDown(rename, { key: "Enter" });
    expect(listed()).toEqual([
      "Brand: Brand",
      "Text and surfaces: Text, Muted",
      "Highlights: Accent",
    ]);
    fireEvent.click(
      within(await openGroupMenu("Highlights")).getByRole("menuitem", {
        name: "Remove group",
      })
    );
    expect(listed()).toEqual([
      "Brand: Brand",
      "Text and surfaces: Text, Muted, Accent",
    ]);
  });
});

describe("dragging a colour", () => {
  const item = (name: string): HTMLElement => {
    const row = screen.getByRole("button", { name: new RegExp(`^${name},`) });
    const li = row.closest("li");
    if (li === null) throw new Error(`no row for ${name}`);
    return li;
  };

  it("drops before the row it is dropped on", () => {
    render(<Host />);
    const drag = dataTransfer();
    fireEvent.dragStart(item("Muted"), { dataTransfer: drag });
    fireEvent.dragOver(item("Accent"), { dataTransfer: drag });
    fireEvent.drop(item("Accent"), { dataTransfer: drag });
    expect(shape(saved)).toEqual([
      "Brand: color.brand color.muted color.accent",
      "Text and surfaces: color.text",
    ]);
  });

  it("drops at the end of a group dropped on its heading", () => {
    render(<Host />);
    const drag = dataTransfer();
    const heading = document.querySelector<HTMLElement>(
      '[data-colour-group="Text and surfaces"] .nx-vars__group-head'
    );
    if (heading === null) throw new Error("no heading");
    fireEvent.dragStart(item("Brand"), { dataTransfer: drag });
    fireEvent.dragOver(heading, { dataTransfer: drag });
    fireEvent.drop(heading, { dataTransfer: drag });
    expect(shape(saved)).toEqual([
      "Brand: color.accent",
      "Text and surfaces: color.text color.muted color.brand",
    ]);
  });
});
