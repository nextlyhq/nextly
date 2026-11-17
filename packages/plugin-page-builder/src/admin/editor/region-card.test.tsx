// @vitest-environment jsdom

/**
 * The sidebar's card for a header or footer selected on the canvas: what it
 * is, which set it comes from, how many pages show it, and how to change it.
 *
 * @module admin/editor/region-card.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RegionCardFacts } from "../page-layout";

import { RegionCard, regionRefusal } from "./region-card";

afterEach(cleanup);

const header: RegionCardFacts = {
  area: "header",
  componentId: "h",
  setTitle: "Main",
  starter: false,
};

function card(
  props: Partial<React.ComponentProps<typeof RegionCard>> = {}
): HTMLElement {
  render(
    <RegionCard
      facts={header}
      pages={{ count: 11, complete: true }}
      onEdit={vi.fn()}
      onOpenSettings={vi.fn()}
      {...props}
    />
  );
  return screen.getByRole("region", { name: "Site header" });
}

describe("the selected header's card", () => {
  it("says what it is, where it comes from and how many pages show it", () => {
    const shown = card();
    expect(
      screen.getByRole("heading", { level: 2, name: "Site header" })
    ).toBeTruthy();
    expect(shown.textContent).toContain(
      "From the Main header & footer. It shows on 11 pages, so changes here change all of them."
    );
    expect(shown.textContent).toContain(
      "To use a different header on this page, change it in Page settings."
    );
  });

  it("offers Edit header, and Page settings as a link that opens them", () => {
    const onEdit = vi.fn();
    const onOpenSettings = vi.fn();
    card({ onEdit, onOpenSettings });
    fireEvent.click(screen.getByRole("button", { name: "Edit header" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Page settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("says the same for a footer, in its own words", () => {
    render(
      <RegionCard
        facts={{ ...header, area: "footer", componentId: "f" }}
        pages={{ count: 1, complete: true }}
        onEdit={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );
    const shown = screen.getByRole("region", { name: "Site footer" });
    expect(shown.textContent).toContain(
      "From the Main header & footer. It shows on 1 page, so changes here change all of them."
    );
    expect(shown.textContent).toContain(
      "To use a different footer on this page, change it in Page settings."
    );
    expect(screen.getByRole("button", { name: "Edit footer" })).toBeTruthy();
  });

  it("says at least N where the count is a floor, and no number until it is known", () => {
    card({ pages: { count: 40, complete: false } });
    expect(screen.getByRole("region").textContent).toContain(
      "It shows on at least 40 pages, so changes here change all of them."
    );
    cleanup();
    card({ pages: undefined });
    const shown = screen.getByRole("region").textContent ?? "";
    expect(shown).toContain(
      "From the Main header & footer. Changes here change every page that shows it."
    );
    expect(shown).not.toMatch(/\d/);
  });

  it("shows no Edit header to someone who may not edit components, and says who can", () => {
    const shown = card({ onEdit: undefined });
    expect(screen.queryByRole("button", { name: "Edit header" })).toBeNull();
    expect(shown.textContent).toContain(
      "You can't change the site header. Ask someone who can edit components."
    );
    // The rest of the card is the same.
    expect(shown.textContent).toContain("It shows on 11 pages");
    expect(screen.getByRole("button", { name: "Page settings" })).toBeTruthy();
  });

  it("says which part has changes a visitor does not see yet", () => {
    card({
      facts: { ...header, note: "Draft changes not live: header component" },
    });
    expect(screen.getByRole("region").textContent).toContain(
      "Draft changes not live: header component"
    );
  });
});

describe("Delete on a selected header or footer", () => {
  it("is refused in words that say where it is changed", () => {
    expect(regionRefusal("header")).toBe(
      "The site header isn't part of this page. Change it in Page settings."
    );
    expect(regionRefusal("footer")).toBe(
      "The site footer isn't part of this page. Change it in Page settings."
    );
  });
});
