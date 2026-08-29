// @vitest-environment jsdom

/**
 * The control that chooses which interaction state the Style tab edits.
 *
 * What is only true here is the marker: which states it reports as carrying
 * values, and — the half a key test would miss — which it reports as empty.
 * The switching itself is a radio group, and the cases below drive it through
 * the keyboard as well as the pointer because selection follows focus.
 *
 * @module state-switcher.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

import type { NodeStyles } from "@nextlyhq/blocks-engine";

import { StateSwitcher, stateHasOwnValues } from "./state-switcher";

afterEach(cleanup);

const marked = (): string[] =>
  screen
    .getAllByRole("radio")
    .filter(el => el.querySelector("[data-nx-state-marked]") !== null)
    .map(el => el.textContent ?? "");

describe("which states report that they carry values", () => {
  it("marks a state holding a declaration, and not one holding none", () => {
    /*
     * Both halves in one case, because the marker's whole job is to
     * discriminate: a component that marked everything would satisfy the
     * positive half alone, and that is the shape this control must not have.
     */
    const styles = {
      hover: { base: { color: "#000001" } },
      focus: {},
    } as unknown as NodeStyles;

    render(<StateSwitcher state="base" onSelect={vi.fn()} styles={styles} />);

    expect(marked()).toEqual(["Hover"]);
  });

  it("does NOT mark a state whose breakpoint holds an empty value set", () => {
    /*
     * The separating case. Both levels of `NodeStyles` are sparse and either
     * can survive empty — a state whose last declaration was cleared leaves the
     * keys behind — so a key test reports it as styled while it carries
     * nothing, which is the false reassurance this marker exists to remove.
     */
    const styles = {
      active: { base: {} },
    } as unknown as NodeStyles;

    render(<StateSwitcher state="base" onSelect={vi.fn()} styles={styles} />);

    expect(marked()).toEqual([]);
    expect(stateHasOwnValues(styles, "active")).toBe(false);
  });

  it("leaves the base state unmarked even when it carries values", () => {
    // It carries values on almost every block, so a dot there is on
    // permanently — and a marker that is always lit costs the other three the
    // meaning they depend on.
    const styles = {
      base: { base: { color: "#000001" } },
      hover: { base: { color: "#000002" } },
    } as unknown as NodeStyles;

    render(<StateSwitcher state="base" onSelect={vi.fn()} styles={styles} />);

    expect(marked()).toEqual(["Hover"]);
  });

  it("marks nothing when the host supplies no styles at all", () => {
    // Absent styles is "the question was not asked", which must not read as
    // "every state is unstyled" the way an empty object would.
    render(<StateSwitcher state="base" onSelect={vi.fn()} />);

    expect(marked()).toEqual([]);
  });

  it("says in the ACCESSIBLE NAME that a state has styles", () => {
    // The one piece of information this control adds beyond its labels; a
    // purely visual form withholds it from the people who can least afford to
    // click through four states to find out.
    const styles = { hover: { base: { color: "#000001" } } } as NodeStyles;

    render(<StateSwitcher state="base" onSelect={vi.fn()} styles={styles} />);

    expect(
      screen.getByRole("radio", { name: /Hover.*has styles/ })
    ).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /Focused.*has styles/ })).toBe(
      null
    );
  });
});

describe("choosing a state", () => {
  it("reports the state the author picked", () => {
    const onSelect = vi.fn();
    render(<StateSwitcher state="base" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("radio", { name: /^Hover/ }));

    expect(onSelect).toHaveBeenCalledWith("hover");
  });

  it("uses the product's words, not the engine's identifiers", () => {
    /*
     * `active` is the most misread term in CSS — authors take it to mean
     * "current" rather than "being pressed" — so the label is asserted rather
     * than left to follow whatever the engine happens to call the state.
     */
    render(<StateSwitcher state="base" onSelect={vi.fn()} />);

    expect(screen.getAllByRole("radio").map(el => el.textContent)).toEqual([
      "None",
      "Hover",
      "Focused",
      "Pressed",
    ]);
  });

  it("moves through the states with the arrow keys, selection following focus", () => {
    // The APG radio-group behaviour, and right here: choosing a state is free
    // and reversible, and seeing the canvas change while arrowing is the point.
    const onSelect = vi.fn();
    render(<StateSwitcher state="hover" onSelect={onSelect} />);

    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith("focus");

    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenLastCalledWith("base");
  });

  it("wraps at both ends rather than stopping", () => {
    // A radio group is a ring; stopping at the end makes the fourth state cost
    // three presses from the first and reads as the control being stuck.
    const onSelect = vi.fn();
    render(<StateSwitcher state="base" onSelect={onSelect} />);

    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowLeft" });

    expect(onSelect).toHaveBeenLastCalledWith("active");
  });

  it("keeps ONE tab stop, on the selected state", () => {
    // A group that put every option in the tab order costs a keyboard user one
    // Tab per state to cross a control they may not be using.
    render(<StateSwitcher state="focus" onSelect={vi.fn()} />);

    const stops = screen
      .getAllByRole("radio")
      .filter(el => el.getAttribute("tabindex") === "0");

    expect(stops).toHaveLength(1);
    expect(stops[0]?.textContent).toBe("Focused");
  });
});
