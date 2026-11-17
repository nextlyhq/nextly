// @vitest-environment jsdom

/**
 * The Colours tab's named groups, and moving a colour by its ⋯ menu and by
 * Alt+Up and Alt+Down.
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
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
