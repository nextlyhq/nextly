// @vitest-environment jsdom

/**
 * The class selector, driven as an author drives it.
 *
 * `class-library.test.ts` asserts the rules against the compiled stylesheet and
 * establishes what one keystroke resolves to. What is only true HERE is the
 * wiring: that Enter takes the row the author can SEE highlighted, that
 * creating reports the intent the host can act on rather than a node write it
 * cannot, that removing a chip touches only that class, and that a library
 * still loading is not drawn as a library with nothing in it.
 *
 * @module class-selector.test
 */
import type { NamedClass } from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClassSelector, type ClassSelectorProps } from "./class-selector";

afterEach(cleanup);

const cls = (id: string, slug: string, orderIndex: number): NamedClass => ({
  id,
  slug,
  orderIndex,
  styles: {},
});

/** Stored out of precedence order, so a pass cannot come from reading it raw. */
const LIBRARY: NamedClass[] = [
  cls("id-card", "card", 2),
  cls("id-hero", "hero", 0),
  cls("id-badge", "badge", 1),
];

function draw(overrides: Partial<ClassSelectorProps> = {}): {
  onNodeClassesChange: ReturnType<typeof vi.fn>;
  onCreateClass: ReturnType<typeof vi.fn>;
} {
  const onNodeClassesChange = vi.fn();
  const onCreateClass = vi.fn();
  render(
    <ClassSelector
      library={LIBRARY}
      nodeClassIds={[]}
      onNodeClassesChange={onNodeClassesChange}
      onCreateClass={onCreateClass}
      {...overrides}
    />
  );
  return { onNodeClassesChange, onCreateClass };
}

const field = (): HTMLElement => screen.getByRole("combobox");

const type = (value: string): void => {
  fireEvent.change(field(), { target: { value } });
};

describe("a library that has not been read yet", () => {
  it("says it is loading rather than drawing an empty library", () => {
    // A site that has stored nothing legitimately has no classes. Drawing the
    // two the same way invites a create into a library about to be replaced.
    render(
      <ClassSelector
        library={undefined}
        nodeClassIds={[]}
        onNodeClassesChange={vi.fn()}
        onCreateClass={vi.fn()}
      />
    );
    expect(screen.getByText(/loading classes/i)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("the classes already on the node", () => {
  it("lists them in library order, not the order the node stored them", () => {
    // Two nodes listing the same classes differently resolve identically, so
    // the stored order would imply a precedence the renderer ignores.
    draw({ nodeClassIds: ["id-card", "id-hero"] });
    const chips = screen
      .getAllByRole("listitem")
      .map(item => item.textContent ?? "");
    expect(chips[0]).toContain("hero");
    expect(chips[1]).toContain("card");
  });

  it("removes only the chip that was clicked", () => {
    const { onNodeClassesChange } = draw({
      nodeClassIds: ["id-hero", "id-card"],
    });
    fireEvent.click(
      screen.getByRole("button", { name: /remove hero from this element/i })
    );
    expect(onNodeClassesChange).toHaveBeenCalledWith(["id-card"]);
  });

  it("says so when the node carries none", () => {
    draw();
    expect(screen.getByText(/no classes on this element/i)).toBeTruthy();
  });
});

describe("what Enter does", () => {
  it("applies the highlighted row, appending rather than replacing", () => {
    const { onNodeClassesChange } = draw({ nodeClassIds: ["id-hero"] });
    type("car");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onNodeClassesChange).toHaveBeenCalledWith(["id-hero", "id-card"]);
  });

  it("takes the row the author moved to, not the first one", () => {
    /*
     * The discriminating case for the highlight. `a` matches badge and card, so
     * a single-row query could not tell "applied the highlighted row" from
     * "applied the first row" — both would pass. Arrowing down once has to
     * change the answer.
     */
    const { onNodeClassesChange } = draw();
    type("a");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onNodeClassesChange).toHaveBeenCalledWith(["id-card"]);
  });

  it("reports a creation as an intent, not as a node write", () => {
    // The class has no id until the host has stored it, so a node write here
    // would have to invent one.
    const { onCreateClass, onNodeClassesChange } = draw();
    type("call-to-action");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onCreateClass).toHaveBeenCalledWith("call-to-action");
    expect(onNodeClassesChange).not.toHaveBeenCalled();
  });

  it("applies an exact match rather than creating beside it", () => {
    // Create sits last precisely so this keystroke does not make a duplicate.
    const { onCreateClass, onNodeClassesChange } = draw();
    type("hero");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onNodeClassesChange).toHaveBeenCalledWith(["id-hero"]);
    expect(onCreateClass).not.toHaveBeenCalled();
  });

  it("does nothing when the query resolves to no row at all", () => {
    // A name the engine's grammar rejects matches nothing and cannot be
    // created, so the keystroke must be inert rather than committing anything.
    const { onCreateClass, onNodeClassesChange } = draw();
    type("Not A Slug");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onCreateClass).not.toHaveBeenCalled();
    expect(onNodeClassesChange).not.toHaveBeenCalled();
  });
});

describe("the list of options", () => {
  it("offers creation last, after the matches", () => {
    draw();
    type("ca");
    const rows = screen
      .getAllByRole("option")
      .map(row => row.textContent ?? "");
    expect(rows[0]).toContain("card");
    expect(rows[rows.length - 1]).toContain("Create");
  });

  it("marks exactly one row selected, and moves it with the arrow keys", () => {
    draw();
    type("a");
    const selected = (): string =>
      screen
        .getAllByRole("option")
        .find(row => row.getAttribute("aria-selected") === "true")
        ?.textContent ?? "";
    expect(selected()).toContain("badge");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(selected()).toContain("card");
  });

  it("wraps from the last row back to the first", () => {
    // The create row is at the bottom; wrapping is what makes it and the first
    // match one keystroke apart rather than a list's length apart.
    draw();
    type("a");
    const rows = screen.getAllByRole("option").length;
    for (let index = 0; index < rows; index += 1) {
      fireEvent.keyDown(field(), { key: "ArrowUp" });
    }
    expect(
      screen.getAllByRole("option")[0]?.getAttribute("aria-selected")
    ).toBe("true");
  });

  it("clears the field after a commit, ready for the next class", () => {
    draw();
    type("card");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect((field() as HTMLInputElement).value).toBe("");
  });

  it("offers no row for a class the node already carries", () => {
    draw({ nodeClassIds: ["id-hero"] });
    type("hero");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("applies the row that was clicked", () => {
    const { onNodeClassesChange } = draw();
    type("badge");
    fireEvent.click(screen.getByRole("option").querySelector("button")!);
    expect(onNodeClassesChange).toHaveBeenCalledWith(["id-badge"]);
  });
});
