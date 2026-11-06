// @vitest-environment jsdom

/**
 * The picker that applies an existing shared style to a block: what it lists,
 * what Enter does, and the refusals it reports for the block in hand.
 */
import { MAX_CLASSES_PER_NODE, type NamedClass } from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClassSelector, type ClassSelectorProps } from "./class-selector";

afterEach(cleanup);

const cls = (
  id: string,
  slug: string,
  orderIndex: number,
  label?: string
): NamedClass => ({
  id,
  slug,
  orderIndex,
  styles: {},
  ...(label === undefined ? {} : { label }),
});

/** Stored out of precedence order, so a pass cannot come from reading it raw. */
const LIBRARY: NamedClass[] = [
  cls("id-card", "card", 2, "Card"),
  cls("id-hero", "hero", 0),
  cls("id-badge", "badge", 1),
];

function draw(overrides: Partial<ClassSelectorProps> = {}): {
  onNodeClassesChange: ReturnType<typeof vi.fn>;
} {
  // Answers the contract: a bare `vi.fn()` returns undefined, which reads as
  // success without being one.
  const onNodeClassesChange = vi.fn(() => "applied" as const);
  render(
    <ClassSelector
      nodeId="node-a"
      library={LIBRARY}
      nodeClassIds={[]}
      onNodeClassesChange={onNodeClassesChange}
      {...overrides}
    />
  );
  return { onNodeClassesChange };
}

const field = (): HTMLElement => screen.getByRole("combobox");
const type = (value: string): void => {
  fireEvent.change(field(), { target: { value } });
};
const press = (key: string): void => {
  fireEvent.keyDown(field(), { key });
};
const full = Array.from({ length: MAX_CLASSES_PER_NODE }, (_, i) => `x-${i}`);

describe("a library that is not there", () => {
  it("says it is loading while the read is in flight", () => {
    draw({ library: undefined });
    expect(screen.getByText("Loading shared styles…")).toBeDefined();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("says the read failed when it did", () => {
    draw({ library: undefined, libraryAbsence: "failed" });
    expect(
      screen.getByText("This site's shared styles could not be read.")
    ).toBeDefined();
  });
});

describe("what it lists", () => {
  it("lists the styles the block does not wear, in library order, by name", () => {
    draw({ nodeClassIds: ["id-badge"] });
    expect(
      screen.getAllByRole("option").map(option => option.textContent)
    ).toEqual(["hero.nx-c-hero", "Card.nx-c-card"]);
  });

  it("offers no look: a look is picked from the block's own tiles", () => {
    const outline = {
      ...cls("look:core/button:outline", "button-outline", 0, "Outline"),
      blockType: "core/button",
    };
    draw({ library: [...LIBRARY, outline] });
    expect(
      screen.getAllByRole("option").map(option => option.textContent)
    ).toEqual(["hero.nx-c-hero", "badge.nx-c-badge", "Card.nx-c-card"]);
  });

  it("cuts a long name or class name short rather than breaking it, the whole of it in a tooltip", () => {
    draw();
    const option = screen.getAllByRole("option")[2] as HTMLElement;
    expect(
      option.querySelector(".nx-classes__option-name")?.getAttribute("title")
    ).toBe("Card");
    expect(
      option.querySelector(".nx-classes__option-class")?.getAttribute("title")
    ).toBe(".nx-c-card");
  });

  it("finds a style by its name as written, spaces and case aside, as the Shared styles tab does", () => {
    draw({
      library: [...LIBRARY, cls("id-promo", "promo-card", 3, "Promo Card")],
    });
    type("promo card");
    expect(screen.getAllByRole("option").map(o => o.textContent)).toEqual([
      "Promo Card.nx-c-promo-card",
    ]);
    // In any case, as the tab's search is.
    type("PROMO");
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("never offers to make a new, empty style from what is typed", () => {
    draw();
    type("brand-new");
    expect(screen.queryAllByRole("option")).toEqual([]);
    expect(screen.getByText("No shared style matches.")).toBeDefined();
    press("Enter");
  });
});

describe("what Enter does", () => {
  it("applies the highlighted row, appending rather than replacing", () => {
    const { onNodeClassesChange } = draw({ nodeClassIds: ["id-badge"] });
    press("Enter");
    expect(onNodeClassesChange).toHaveBeenCalledWith(["id-badge", "id-hero"]);
  });

  it("takes the row the author moved to, and names it to assistive technology", () => {
    const { onNodeClassesChange } = draw();
    press("ArrowDown");
    const active = field().getAttribute("aria-activedescendant");
    expect(document.getElementById(active ?? "")?.textContent).toContain(
      "badge"
    );
    press("Enter");
    expect(onNodeClassesChange).toHaveBeenCalledWith(["id-badge"]);
  });

  it("clears the query once the write lands", () => {
    draw();
    type("ca");
    press("Enter");
    expect((field() as HTMLInputElement).value).toBe("");
  });
});

describe("a write that does not land", () => {
  it("keeps the query and says the document refused it", () => {
    draw({ onNodeClassesChange: vi.fn(() => "refused" as const) });
    type("ca");
    press("Enter");
    expect((field() as HTMLInputElement).value).toBe("ca");
    expect(screen.getByRole("alert").textContent).toBe(
      "This change could not be applied to the document."
    );
  });

  it("refuses a block already listing as many as the page applies", () => {
    const { onNodeClassesChange } = draw({ nodeClassIds: full });
    press("Enter");
    expect(onNodeClassesChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "This block already lists as many shared styles as the page applies."
    );
  });

  it("drops a refusal once it no longer describes the block in hand", () => {
    const refusing = vi.fn(() => "refused" as const);
    const view = render(
      <ClassSelector
        nodeId="node-a"
        library={LIBRARY}
        nodeClassIds={[]}
        onNodeClassesChange={refusing}
      />
    );
    press("Enter");
    expect(screen.getByRole("alert")).toBeDefined();
    // Another block, whose class list looks the same.
    view.rerender(
      <ClassSelector
        nodeId="node-b"
        library={LIBRARY}
        nodeClassIds={[]}
        onNodeClassesChange={refusing}
      />
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a refusal across a re-render that only reallocates the id list", () => {
    const refusing = vi.fn(() => "refused" as const);
    const view = render(
      <ClassSelector
        nodeId="node-a"
        library={LIBRARY}
        nodeClassIds={["id-badge"]}
        onNodeClassesChange={refusing}
      />
    );
    press("Enter");
    view.rerender(
      <ClassSelector
        nodeId="node-a"
        library={LIBRARY}
        nodeClassIds={["id-badge"]}
        onNodeClassesChange={refusing}
      />
    );
    expect(screen.getByRole("alert")).toBeDefined();
  });
});

describe("a block the page cannot fully apply", () => {
  it("says how many stored styles style nothing", () => {
    draw({ nodeClassIds: [...full, "y-1", "y-2"] });
    expect(screen.getByRole("status").textContent).toMatch(
      /^This block lists 2 more shared styles than the page applies/
    );
  });
});
