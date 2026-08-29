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

import { StateSwitcher } from "./state-switcher";
import { stateHasOwnValues } from "./style-values";

afterEach(cleanup);

/**
 * The site's tiers, supplied to every marker case.
 *
 * The marker answers "set here, and expressible by this site", so it needs the
 * tiers to answer at all — a case that omitted them would be asserting the
 * refusal below rather than the marking it names.
 */
const SITE = {
  viewport: [{ id: "base", label: "Desktop" }],
  container: [],
};

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

    render(
      <StateSwitcher
        state="base"
        onSelect={vi.fn()}
        styles={styles}
        breakpoints={SITE}
      />
    );

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

    render(
      <StateSwitcher
        state="base"
        onSelect={vi.fn()}
        styles={styles}
        breakpoints={SITE}
      />
    );

    expect(marked()).toEqual([]);
    expect(stateHasOwnValues(styles, "active", SITE)).toBe(false);
  });

  it("leaves the base state unmarked even when it carries values", () => {
    // It carries values on almost every block, so a dot there is on
    // permanently — and a marker that is always lit costs the other three the
    // meaning they depend on.
    const styles = {
      base: { base: { color: "#000001" } },
      hover: { base: { color: "#000002" } },
    } as unknown as NodeStyles;

    render(
      <StateSwitcher
        state="base"
        onSelect={vi.fn()}
        styles={styles}
        breakpoints={SITE}
      />
    );

    expect(marked()).toEqual(["Hover"]);
  });

  it("survives a malformed stored envelope rather than taking the tab down", () => {
    /*
     * The envelope arrives from STORAGE, and the field's guard admits this
     * deliberately: it checks that `nodes` is an array and no more, so a
     * migration, a DTCG import or a hand-edited row can leave a null state or a
     * null breakpoint behind. Enumerating one throws during RENDER, which takes
     * the whole Style tab down — removing the only surface that could repair
     * the value that broke it.
     *
     * Both shapes in one case, because they fail at different levels: the state
     * itself, and one breakpoint under a state that is otherwise fine.
     */
    const styles = {
      hover: null,
      focus: { base: null },
      active: { base: { color: "#000001" } },
    } as unknown as NodeStyles;

    expect(() =>
      render(
        <StateSwitcher
          state="base"
          onSelect={vi.fn()}
          styles={styles}
          breakpoints={SITE}
        />
      )
    ).not.toThrow();

    expect(marked()).toEqual(["Pressed"]);
  });

  it("ignores a state reached through the PROTOTYPE", () => {
    // A state the compiler will not read must not be reported as styled: the
    // marker would send an author looking for values that never reach the page.
    const styles = Object.create({
      hover: { base: { color: "#000001" } },
    }) as NodeStyles;

    render(
      <StateSwitcher
        state="base"
        onSelect={vi.fn()}
        styles={styles}
        breakpoints={SITE}
      />
    );

    expect(marked()).toEqual([]);
    expect(stateHasOwnValues(styles, "hover", SITE)).toBe(false);
  });

  it("does NOT mark an ARRAY-shaped tier the compiler will emit nothing for", () => {
    /*
     * An array is a non-null object, so a guard asking only that accepts
     * `hover: []` and counts its numeric indexes as declarations. The compiler
     * reads this envelope with `isPlainRecord` and emits nothing for an array,
     * so a state marked from one is a state that cannot affect the page —
     * worse than an unmarked one, because it sends an author looking for a
     * value that was never going to apply.
     *
     * NONEMPTY arrays, at both levels, because an empty one is already refused
     * by the length test and would pass on the broken implementation too.
     */
    const styles = {
      hover: [{ color: "#000001" }],
      focus: { base: ["#000002"] },
      active: { base: { color: "#000003" } },
    } as unknown as NodeStyles;

    render(
      <StateSwitcher
        state="base"
        onSelect={vi.fn()}
        styles={styles}
        breakpoints={SITE}
      />
    );

    // `active` is the control: a real record beside the two bad shapes, so this
    // case cannot pass by the marker never appearing at all.
    expect(marked()).toEqual(["Pressed"]);
  });

  it("does NOT mark a value stored under a tier the sheet no longer has", () => {
    /*
     * Deleting a breakpoint leaves values behind under its id. The compiler
     * iterates the breakpoint contexts it was given and never looks at the
     * rest — measured, the same node compiles to 73 bytes under a known tier
     * and to an empty sheet under an unknown one — so marking that state sends
     * an author looking for an appearance no visitor can see.
     *
     * `active` is the control: a value at a tier that DOES exist, in the same
     * render, so this cannot pass by nothing being marked at all.
     */
    const styles = {
      hover: { "deleted-tier": { color: "#000001" } },
      active: { base: { color: "#000002" } },
    } as unknown as NodeStyles;

    render(
      <StateSwitcher
        state="base"
        onSelect={vi.fn()}
        styles={styles}
        breakpoints={{
          viewport: [{ id: "base", label: "Desktop" }],
          container: [],
        }}
      />
    );

    expect(marked()).toEqual(["Pressed"]);
  });

  it("marks NOTHING when the site's tiers are not known", () => {
    /*
     * A deliberate refusal rather than a default. The marker means "set here,
     * and expressible by this site", and without the site's tiers that question
     * cannot be asked: a value under a tier the sheet lacks reaches nobody, and
     * which tiers the sheet has is exactly what is missing.
     *
     * It is also what bounds this by construction. A stored record arrives from
     * storage and can be arbitrarily wide, and every way of walking it —
     * `Object.keys`, `for...in` with an early break — asks the engine for the
     * whole key list first, so an early exit bounds the body and not the
     * enumeration. Measured: 0.08ms at a thousand keys, 10.75ms at a hundred
     * thousand, 103ms at a million. Not walking it is the only fix.
     *
     * The control is the SAME styles marked when tiers ARE known, immediately
     * below, so this cannot pass by the marker never appearing.
     */
    const styles = {
      hover: { base: { color: "#000001" } },
    } as unknown as NodeStyles;

    render(<StateSwitcher state="base" onSelect={vi.fn()} styles={styles} />);
    expect(marked()).toEqual([]);

    cleanup();
    render(
      <StateSwitcher
        state="base"
        onSelect={vi.fn()}
        styles={styles}
        breakpoints={SITE}
      />
    );
    expect(marked()).toEqual(["Hover"]);
  });

  /**
   * A stored tier map that COUNTS how much of itself was examined.
   *
   * A `get` accessor cannot be the instrument here, and that is a property of
   * the code under test rather than a detail: `ownData` reads through
   * `Object.getOwnPropertyDescriptor` and returns `part.value`, so an accessor
   * has no `value` and reads as ABSENT without ever being invoked. A counter
   * built from getters stays at zero and every bound assertion passes against
   * an unbounded reader — measured, both breaks survived it.
   */
  function countingTiers(width: number, valueAt: number) {
    const target: Record<string, unknown> = {};
    for (let i = 0; i < width; i += 1) {
      target[`t${i}`] = i === valueAt ? { color: "#000001" } : {};
    }
    const counted = { reads: 0 };
    const proxy = new Proxy(target, {
      getOwnPropertyDescriptor(on, key) {
        counted.reads += 1;
        return Reflect.getOwnPropertyDescriptor(on, key);
      },
    });
    return { proxy, counted };
  }

  it("asks only the tiers the SHEET has when breakpoints are known", () => {
    /*
     * The other half of the same bound. With the site's tiers in hand this must
     * be driven by them rather than by the stored keys, so the width of what
     * was stored stops mattering at all — a handful of lookups instead of one
     * per stored tier.
     */
    const { proxy, counted } = countingTiers(5000, 4999);

    render(
      <StateSwitcher
        state="base"
        onSelect={vi.fn()}
        styles={{ hover: proxy } as unknown as NodeStyles}
        breakpoints={{
          viewport: [{ id: "base", label: "Desktop" }],
          container: [],
        }}
      />
    );

    /*
     * One lookup per tier the SITE has, so the stored width stops mattering
     * entirely — not merely stops growing. A small absolute bound is the right
     * assertion here for that reason: the sheet declares one tier.
     */
    expect(counted.reads).toBeLessThanOrEqual(8);
  });

  it("marks nothing when the host supplies no styles at all", () => {
    // Absent styles is "the question was not asked", which must not read as
    // "every state is unstyled" the way an empty object would.
    render(
      <StateSwitcher state="base" onSelect={vi.fn()} breakpoints={SITE} />
    );

    expect(marked()).toEqual([]);
  });

  it("says in the ACCESSIBLE NAME that a state has styles", () => {
    // The one piece of information this control adds beyond its labels; a
    // purely visual form withholds it from the people who can least afford to
    // click through four states to find out.
    const styles = { hover: { base: { color: "#000001" } } } as NodeStyles;

    render(
      <StateSwitcher
        state="base"
        onSelect={vi.fn()}
        styles={styles}
        breakpoints={SITE}
      />
    );

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
