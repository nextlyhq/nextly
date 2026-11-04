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

function mount(stored?: string) {
  const onCommit = vi.fn(() => "applied" as const);
  render(
    <>
      <span id="decoration-label">Decoration</span>
      <DecorationField
        id="decoration"
        labelledBy="decoration-label"
        stored={stored}
        actionName="Decoration"
        describedBy={undefined}
        onCommit={onCommit}
      />
    </>
  );
  return onCommit;
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
  });

  it("leaves to the text field a value the icons cannot draw", () => {
    // Two lines at once, no line at all, two of one part, or a variable that
    // could stand for any of them.
    expect(parseDecoration("underline overline")).toBeUndefined();
    expect(parseDecoration("red")).toBeUndefined();
    expect(parseDecoration("underline dotted dashed")).toBeUndefined();
    expect(parseDecoration("underline var(--site-line)")).toBeUndefined();
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
    mount();
    expect(
      screen
        .getByRole("button", { name: "Decoration style" })
        .hasAttribute("disabled")
    ).toBe(true);
    cleanup();
    mount("none");
    expect(
      screen
        .getByRole("button", { name: "Decoration style" })
        .hasAttribute("disabled")
    ).toBe(true);
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
    expect(onCommit).toHaveBeenLastCalledWith("underline 2px");

    const colour = screen.getByRole("textbox", { name: "Line colour" });
    fireEvent.change(colour, { target: { value: "red" } });
    fireEvent.blur(colour);
    expect(onCommit).toHaveBeenLastCalledWith("underline red");
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
