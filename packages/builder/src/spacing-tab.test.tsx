// @vitest-environment jsdom

/**
 * Design's Spacing tab: Spacing, Radius, Shadows, Content width and Other
 * values as separate groups; the built-in spacing in plain words with its
 * description in the popup; and a preview on every row: a bar at the
 * spacing, a square with the radius, a card wearing the shadow.
 */
import { defaultSiteTokens, type SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { TokensPanel } from "./tokens-panel";
import { DESIGN_TAB_GROUPS } from "./tokens-studio";

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
    ...defaultSiteTokens(),
    { name: "radius.md", kind: "dimension", values: { light: "8px" } },
    {
      name: "shadow.soft",
      kind: "shadow",
      values: { light: "0 1px 2px rgb(0 0 0 / 0.1)" },
    },
  ],
};

function SpacingTab({
  tokens = SITE,
}: {
  tokens?: SiteTokenSet;
}): React.JSX.Element {
  const [set, setSet] = React.useState(tokens);
  const latest = React.useRef(set);
  return (
    <TokensPanel
      tokens={set}
      currentTokens={() => latest.current}
      onChange={next => {
        latest.current = next;
        setSet(next);
      }}
      groups={DESIGN_TAB_GROUPS.spacing}
    />
  );
}

const headings = (): string[] =>
  screen.getAllByRole("heading", { level: 3 }).map(h => h.textContent ?? "");

/** The names listed in one group, by its heading. */
const namesIn = (heading: string): string[] => {
  const region = screen.getByRole("region", { name: heading });
  return [...region.querySelectorAll(".nx-vars__row .nx-vars__name")].map(
    name => name.textContent ?? ""
  );
};

describe("the Spacing tab's groups", () => {
  it("lists Spacing, Radius, Shadows and Content width, with Other values hidden while empty", () => {
    render(<SpacingTab />);
    expect(headings()).toEqual([
      "Spacing",
      "Radius",
      "Shadows",
      "Content width",
    ]);
  });

  it("puts every built-in spacing and the button paddings under Spacing, in plain words", () => {
    render(<SpacingTab />);
    expect(namesIn("Spacing")).toEqual(
      expect.arrayContaining([
        "Space between blocks",
        "Section padding (top and bottom)",
        "Section padding (sides)",
        "Space between columns",
        "Card padding",
        "Space between paragraphs",
        "Button padding (top and bottom)",
        "Button padding (sides)",
      ])
    );
    expect(namesIn("Radius")).toEqual(["Md"]);
    expect(namesIn("Shadows")).toEqual(["Soft"]);
    expect(namesIn("Content width")).toEqual(["Content width"]);
  });

  it("adds each kind to its own group, and other values to Other values", async () => {
    render(<SpacingTab />);
    fireEvent.click(screen.getByRole("button", { name: "Add radius" }));
    await screen.findByRole("dialog", { name: "Edit New radius" });
    expect(
      document.querySelector(
        '[data-group="radius"] [data-variable-key="radius.new-radius"]'
      )
    ).not.toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  });
});

describe("a built-in spacing's description", () => {
  it("is said in its popup", async () => {
    render(<SpacingTab />);
    fireEvent.click(
      screen.getByRole("button", { name: /^Space between blocks,/ })
    );
    const editor = await screen.findByRole("dialog");
    expect(
      within(editor).getByText(
        "The space a container puts between the blocks it holds."
      )
    ).toBeDefined();
  });
});

describe("each row's preview", () => {
  const rowOf = (name: RegExp): HTMLElement => {
    const row = screen.getByRole("button", { name });
    return row;
  };

  it("draws a spacing as a bar at its desktop value, and says a fluid one's range", () => {
    render(<SpacingTab />);
    // clamp(1rem, 0.875rem + 0.5vw, 1.25rem): 20px at the desktop width.
    const stack = rowOf(/^Space between blocks,/);
    const bar = stack.querySelector<HTMLElement>(".nx-vars__bar");
    expect(bar?.style.width).toBe("20px");
    expect(stack.textContent).toContain("Fluid · 16–20px");
    // A fixed length: its own width, and the value said.
    const paragraph = rowOf(/^Button padding \(sides\),/);
    expect(
      paragraph.querySelector<HTMLElement>(".nx-vars__bar")?.style.width
    ).toBe("20px");
  });

  it("draws a radius as a square with the radius on its corners", () => {
    render(<SpacingTab />);
    const square = rowOf(/^Md,/).querySelector<HTMLElement>(".nx-vars__radius");
    expect(square?.style.borderRadius).toBe("8px");
  });

  it("draws a shadow on a small card", () => {
    render(<SpacingTab />);
    const card = rowOf(/^Soft,/).querySelector<HTMLElement>(".nx-vars__shadow");
    expect(card?.style.boxShadow).toContain("rgb(0 0 0 / 0.1)");
  });

  it("says the content width in px", () => {
    render(<SpacingTab />);
    const width = rowOf(/^Content width,/);
    expect(width.querySelector(".nx-vars__chip")?.textContent).toBe("1152px");
  });
});
