// @vitest-environment jsdom

/**
 * Text decoration as icons, with its line's style, thickness and colour in a
 * popover, read from and written as the CSS shorthand.
 *
 * @module decoration-field.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  DecorationField,
  composeDecoration,
  parseDecoration,
} from "./decoration-field";
import { InheritedValue } from "./inherited-value";
import { SectionHeld } from "./section-held";

beforeAll(() => {
  // Radix's select and popover measure and scroll, which jsdom does not do.
  const element = Element.prototype as unknown as Record<string, unknown>;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

afterEach(cleanup);

function field(
  stored: string | undefined,
  onCommit: () => "applied",
  describedBy?: string
) {
  return (
    <>
      <span id="decoration-label">Decoration</span>
      <DecorationField
        id="decoration"
        labelledBy="decoration-label"
        stored={stored}
        actionName="Decoration"
        describedBy={describedBy}
        onCommit={onCommit}
      />
    </>
  );
}

function mount(stored?: string, describedBy?: string) {
  const onCommit = vi.fn(() => "applied" as const);
  const view = render(field(stored, onCommit, describedBy));
  return Object.assign(onCommit, {
    rerender: (next: string | undefined) =>
      view.rerender(field(next, onCommit, describedBy)),
  });
}

function openStyle(): void {
  fireEvent.click(screen.getByRole("button", { name: "Decoration style" }));
}

describe("parseDecoration", () => {
  it("reads the line and, in any order, its style, thickness and colour", () => {
    expect(parseDecoration("underline")).toEqual({ line: "underline" });
    expect(parseDecoration("none")).toEqual({ line: "none" });
    expect(parseDecoration("red 2px dotted underline")).toEqual({
      line: "underline",
      style: "dotted",
      thickness: "2px",
      color: "red",
    });
    expect(parseDecoration("line-through wavy rgb(255 0 0)")).toEqual({
      line: "line-through",
      style: "wavy",
      color: "rgb(255 0 0)",
    });
    expect(parseDecoration("overline from-font")).toEqual({
      line: "overline",
      thickness: "from-font",
    });
    // A thickness CSS computes is still a thickness, not a colour.
    expect(parseDecoration("underline calc(1px + 0.1em)")).toEqual({
      line: "underline",
      thickness: "calc(1px + 0.1em)",
    });
    expect(parseDecoration("underline max(1px, 0.1em) red")).toEqual({
      line: "underline",
      thickness: "max(1px, 0.1em)",
      color: "red",
    });
    // Any length CSS reads, not only a short list of units.
    for (const thickness of ["1vw", "0.2lh", "1cm"]) {
      expect(parseDecoration(`underline ${thickness}`)).toEqual({
        line: "underline",
        thickness,
      });
    }
  });

  it("leaves to the text field a value the icons cannot draw", () => {
    // Two lines at once, no line at all, two of one part, or a variable that
    // could stand for any of them.
    expect(parseDecoration("underline overline")).toBeUndefined();
    expect(parseDecoration("red")).toBeUndefined();
    expect(parseDecoration("underline dotted dashed")).toBeUndefined();
    expect(parseDecoration("underline var(--site-line)")).toBeUndefined();
    // A word that is no colour is not read as one.
    expect(parseDecoration("underline banana")).toBeUndefined();
    expect(parseDecoration("underline attr(data-x)")).toBeUndefined();
    // A bare number is no length, and a CSS-wide keyword voids a shorthand
    // it stands in.
    expect(parseDecoration("underline 2")).toBeUndefined();
    expect(parseDecoration("underline inherit")).toBeUndefined();
    expect(parseDecoration("underline unset")).toBeUndefined();
    expect(parseDecoration("")).toBeUndefined();
  });
});

describe("composeDecoration", () => {
  it("writes the line alone, or the line with what is set beside it", () => {
    expect(composeDecoration({ line: "underline" })).toBe("underline");
    expect(
      composeDecoration({
        line: "underline",
        style: "wavy",
        thickness: "2px",
        color: "red",
      })
    ).toBe("underline wavy 2px red");
  });
});

describe("DecorationField", () => {
  it("draws the line as icons, None, Underline, Strikethrough and Overline", () => {
    mount("underline");
    const names = screen
      .getAllByRole("radio")
      .map(radio => radio.getAttribute("aria-label"));
    expect(names).toEqual(["None", "Underline", "Strikethrough", "Overline"]);
    expect(
      screen
        .getByRole("radio", { name: "Underline" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  it("changes the line and keeps its style, thickness and colour", () => {
    const onCommit = mount("underline dotted red");
    fireEvent.click(screen.getByRole("radio", { name: "Overline" }));
    expect(onCommit).toHaveBeenCalledWith("overline dotted red");
  });

  it("clears the decoration when the chosen line is pressed again", () => {
    const onCommit = mount("underline dotted red");
    fireEvent.click(screen.getByRole("radio", { name: "Underline" }));
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("offers the line's style only once there is a line to style", () => {
    // The popover itself stays reachable, for the decoration written as CSS.
    for (const stored of [undefined, "none"]) {
      mount(stored);
      openStyle();
      expect(
        screen
          .getByRole("combobox", { name: "Line style" })
          .hasAttribute("disabled")
      ).toBe(true);
      expect(
        screen
          .getByRole("textbox", { name: "Thickness" })
          .hasAttribute("disabled")
      ).toBe(true);
      expect(
        screen
          .getByRole("textbox", { name: "Line colour" })
          .hasAttribute("disabled")
      ).toBe(true);
      cleanup();
    }
  });

  it("writes a decoration the icons cannot draw as CSS, from its popover", () => {
    const onCommit = mount();
    openStyle();
    const css = screen.getByRole("textbox", { name: "Decoration as CSS" });
    fireEvent.change(css, { target: { value: "underline overline" } });
    fireEvent.blur(css);
    expect(onCommit).toHaveBeenCalledWith("underline overline");
  });

  it("keeps the inherited style, thickness and colour when the line changes here", () => {
    const onCommit = vi.fn(() => "applied" as const);
    render(
      <InheritedValue.Provider value="underline wavy 2px red">
        {field(undefined, onCommit)}
      </InheritedValue.Provider>
    );
    // The inherited line is the one the icons mark.
    expect(
      screen
        .getByRole("radio", { name: "Underline, inherited" })
        .getAttribute("aria-checked")
    ).toBe("false");
    expect(
      screen
        .getByRole("button", { name: "Decoration style" })
        .hasAttribute("disabled")
    ).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "Overline" }));
    expect(onCommit).toHaveBeenCalledWith("overline wavy 2px red");
  });

  it("moves the popover's thickness and colour with a stored change", () => {
    const onCommit = mount("underline 2px red");
    openStyle();
    onCommit.rerender("underline 3px blue");
    const thickness = screen.getByRole("textbox", { name: "Thickness" });
    const colour = screen.getByRole("textbox", { name: "Line colour" });
    expect((thickness as HTMLInputElement).value).toBe("3px");
    expect((colour as HTMLInputElement).value).toBe("blue");
    fireEvent.blur(thickness);
    fireEvent.blur(colour);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("writes any thickness CSS reads, and no colour a shorthand cannot hold", () => {
    const onCommit = mount("underline");
    openStyle();
    const thickness = screen.getByRole("textbox", { name: "Thickness" });
    fireEvent.change(thickness, { target: { value: "2" } });
    fireEvent.blur(thickness);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(thickness, { target: { value: "1vw" } });
    fireEvent.blur(thickness);
    expect(onCommit).toHaveBeenLastCalledWith("underline 1vw");

    onCommit.mockClear();
    const colour = screen.getByRole("textbox", { name: "Line colour" });
    fireEvent.change(colour, { target: { value: "inherit" } });
    fireEvent.blur(colour);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps a part changed before the stored value catches up", () => {
    // A shared style's write lands later: the stored value is still the old
    // one when the next part changes.
    const onCommit = mount("underline");
    openStyle();
    fireEvent.click(screen.getByRole("combobox", { name: "Line style" }));
    fireEvent.click(screen.getByRole("option", { name: "Wavy" }));
    expect(onCommit).toHaveBeenLastCalledWith("underline wavy");
    const thickness = screen.getByRole("textbox", { name: "Thickness" });
    fireEvent.change(thickness, { target: { value: "2px" } });
    fireEvent.blur(thickness);
    expect(onCommit).toHaveBeenLastCalledWith("underline wavy 2px");

    // The write arriving, and then a change from elsewhere (an undo): the
    // next part starts from what is stored, not from the queue.
    onCommit.rerender("underline wavy");
    onCommit.rerender("overline");
    const colour = screen.getByRole("textbox", { name: "Line colour" });
    fireEvent.change(colour, { target: { value: "red" } });
    fireEvent.blur(colour);
    expect(onCommit).toHaveBeenLastCalledWith("overline red");
  });

  it("returns a styled line to its default style", () => {
    const onCommit = mount("underline wavy");
    openStyle();
    fireEvent.click(screen.getByRole("combobox", { name: "Line style" }));
    fireEvent.click(screen.getByRole("option", { name: "Default" }));
    expect(onCommit).toHaveBeenLastCalledWith("underline");
  });

  it("keeps a value written as CSS when a part changes before it is stored", () => {
    const onCommit = mount("underline");
    openStyle();
    const css = screen.getByRole("textbox", { name: "Decoration as CSS" });
    fireEvent.change(css, { target: { value: "underline wavy" } });
    fireEvent.blur(css);
    expect(onCommit).toHaveBeenLastCalledWith("underline wavy");
    fireEvent.click(screen.getByRole("radio", { name: "Overline" }));
    expect(onCommit).toHaveBeenLastCalledWith("overline wavy");
  });

  it("starts the next part from the stored value after a refused write", () => {
    const onCommit = vi.fn(
      (): "applied" | "refused" => "refused"
    ) as unknown as () => "applied";
    render(field("underline", onCommit));
    openStyle();
    fireEvent.click(screen.getByRole("combobox", { name: "Line style" }));
    fireEvent.click(screen.getByRole("option", { name: "Wavy" }));
    const thickness = screen.getByRole("textbox", { name: "Thickness" });
    fireEvent.change(thickness, { target: { value: "2px" } });
    fireEvent.blur(thickness);
    expect(onCommit).toHaveBeenLastCalledWith("underline 2px");
  });

  it("draws the line just chosen while its write is on its way", () => {
    // A shared style's write lands later: the icons follow what was chosen,
    // so pressing it again clears it rather than choosing it twice.
    const onCommit = mount("underline");
    fireEvent.click(screen.getByRole("radio", { name: "Overline" }));
    expect(onCommit).toHaveBeenLastCalledWith("overline");
    expect(
      screen
        .getByRole("radio", { name: "Overline" })
        .getAttribute("aria-checked")
    ).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Overline" }));
    expect(onCommit).toHaveBeenLastCalledWith(null);
  });

  it("goes back to the stored line when the write is refused later", () => {
    // A shared style's write can be refused after the click that sent it; the
    // refusal arrives as the field's problem, and the icons then show what the
    // document still holds rather than the line it refused.
    const onCommit = vi.fn(() => "applied" as const);
    const view = render(field("underline", onCommit));
    fireEvent.click(screen.getByRole("radio", { name: "Overline" }));
    expect(
      screen
        .getByRole("radio", { name: "Overline" })
        .getAttribute("aria-checked")
    ).toBe("true");
    view.rerender(field("underline", onCommit, "decoration-error"));
    expect(
      screen
        .getByRole("radio", { name: "Underline" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  it("holds the popover's controls when the section is held while it is open", () => {
    // The popover is drawn outside the section, where the section's disabled
    // fieldset does not reach.
    const onCommit = vi.fn(() => "applied" as const);
    const view = render(
      <SectionHeld.Provider value={false}>
        {field("underline", onCommit)}
      </SectionHeld.Provider>
    );
    openStyle();
    view.rerender(
      <SectionHeld.Provider value={true}>
        {field("underline", onCommit)}
      </SectionHeld.Provider>
    );
    for (const control of [
      screen.getByRole("combobox", { name: "Line style" }),
      screen.getByRole("textbox", { name: "Thickness" }),
      screen.getByRole("textbox", { name: "Line colour" }),
      screen.getByRole("textbox", { name: "Decoration as CSS" }),
    ]) {
      expect(control.hasAttribute("disabled")).toBe(true);
    }
  });

  it("writes CSS as typed, and leaves an unchanged value alone", () => {
    // Legal CSS whitespace around a stored value is not an edit; a no-break
    // space is not CSS whitespace, so it is written for the field to judge
    // rather than read as empty and clearing the decoration.
    const onCommit = mount(" underline ");
    openStyle();
    const css = screen.getByRole("textbox", { name: "Decoration as CSS" });
    fireEvent.blur(css);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(css, { target: { value: "\u00a0" } });
    fireEvent.blur(css);
    expect(onCommit).toHaveBeenLastCalledWith("\u00a0");
  });

  it("points the popover's controls at a refusal", () => {
    mount("underline", "decoration-error");
    openStyle();
    for (const control of [
      screen.getByRole("combobox", { name: "Line style" }),
      screen.getByRole("textbox", { name: "Thickness" }),
      screen.getByRole("textbox", { name: "Line colour" }),
      screen.getByRole("textbox", { name: "Decoration as CSS" }),
    ]) {
      expect(control.getAttribute("aria-describedby")).toBe("decoration-error");
      expect(control.getAttribute("aria-invalid")).toBe("true");
    }
  });

  it("sets the line's style, thickness and colour in its popover", () => {
    const onCommit = mount("underline");
    fireEvent.click(screen.getByRole("button", { name: "Decoration style" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Line style" }));
    fireEvent.click(screen.getByRole("option", { name: "Wavy" }));
    expect(onCommit).toHaveBeenLastCalledWith("underline wavy");

    const thickness = screen.getByRole("textbox", { name: "Thickness" });
    fireEvent.change(thickness, { target: { value: "2px" } });
    fireEvent.blur(thickness);
    expect(onCommit).toHaveBeenLastCalledWith("underline wavy 2px");

    const colour = screen.getByRole("textbox", { name: "Line colour" });
    fireEvent.change(colour, { target: { value: "red" } });
    fireEvent.blur(colour);
    expect(onCommit).toHaveBeenLastCalledWith("underline wavy 2px red");
  });

  it("commits a thickness on Enter without submitting the entry it is mounted inside", () => {
    // The builder mounts inside the entry's form, where an unprevented Enter
    // saves or publishes the whole entry.
    const submitted = vi.fn((event: React.FormEvent) => event.preventDefault());
    const onCommit = vi.fn(() => "applied" as const);
    render(
      <form onSubmit={submitted}>
        <DecorationField
          id="decoration"
          labelledBy="decoration"
          stored="underline"
          actionName="Decoration"
          describedBy={undefined}
          onCommit={onCommit}
        />
      </form>
    );
    fireEvent.click(screen.getByRole("button", { name: "Decoration style" }));
    const thickness = screen.getByRole("textbox", { name: "Thickness" });
    fireEvent.change(thickness, { target: { value: "2px" } });
    expect(fireEvent.keyDown(thickness, { key: "Enter" })).toBe(false);
    expect(onCommit).toHaveBeenCalledWith("underline 2px");
  });
});
