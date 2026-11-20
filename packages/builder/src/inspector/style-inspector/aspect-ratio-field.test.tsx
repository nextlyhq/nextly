// @vitest-environment jsdom

/**
 * An aspect ratio chosen from the ratios an author reaches for, or typed as
 * width and height, and stored as the CSS ratio.
 *
 * @module aspect-ratio-field.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import { AspectRatioField, aspectRatioChoice } from "./aspect-ratio-field";
import { InheritedValue } from "./inherited-value";

beforeAll(() => {
  // Radix's select measures and scrolls, which jsdom does not do.
  const element = Element.prototype as unknown as Record<string, unknown>;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => {};
});

afterEach(cleanup);

function field(
  stored: string | undefined,
  onCommit: () => "applied",
  options: { inherited?: string; describedBy?: string } = {}
) {
  return (
    <InheritedValue.Provider value={options.inherited}>
      <span id="ratio-label">Aspect ratio</span>
      <AspectRatioField
        id="ratio"
        labelledBy="ratio-label"
        stored={stored}
        actionName="Aspect ratio"
        describedBy={options.describedBy}
        onCommit={onCommit}
      />
    </InheritedValue.Provider>
  );
}

function mount(
  stored?: string,
  options: { inherited?: string; describedBy?: string } = {}
) {
  const onCommit = vi.fn(() => "applied" as const);
  const view = render(field(stored, onCommit, options));
  return Object.assign(onCommit, {
    rerender: (next: string | undefined) =>
      view.rerender(field(next, onCommit, options)),
  });
}

describe("aspectRatioChoice", () => {
  it("reads a stored ratio as the preset it is, however it is spaced", () => {
    expect(aspectRatioChoice("16 / 9")).toEqual({
      kind: "preset",
      value: "16 / 9",
    });
    expect(aspectRatioChoice("16/9")).toEqual({
      kind: "preset",
      value: "16 / 9",
    });
    expect(aspectRatioChoice("auto")).toEqual({
      kind: "preset",
      value: "auto",
    });
    expect(aspectRatioChoice("1")).toEqual({ kind: "preset", value: "1 / 1" });
  });

  it("reads another simple ratio as a custom width and height", () => {
    expect(aspectRatioChoice("5 / 4")).toEqual({
      kind: "custom",
      width: 5,
      height: 4,
    });
  });

  it("leaves a ratio it cannot draw to the text field", () => {
    expect(aspectRatioChoice("auto 4 / 3")).toBeUndefined();
    expect(aspectRatioChoice("calc(1 + 1)")).toBeUndefined();
    expect(aspectRatioChoice("0 / 1")).toBeUndefined();
  });
});

describe("AspectRatioField", () => {
  it("shows a stored ratio by its name", () => {
    mount("16 / 9");
    expect(
      screen.getByRole("combobox", { name: "Aspect ratio" }).textContent
    ).toBe("16:9");
  });

  it("stores a preset as the CSS ratio", () => {
    const onCommit = mount();
    fireEvent.click(screen.getByRole("combobox", { name: "Aspect ratio" }));
    fireEvent.click(screen.getByRole("option", { name: "Square 1:1" }));
    expect(onCommit).toHaveBeenCalledWith("1 / 1");
  });

  it("asks for a width and a height for a custom ratio, and stores them", () => {
    const onCommit = mount();
    fireEvent.click(screen.getByRole("combobox", { name: "Aspect ratio" }));
    fireEvent.click(screen.getByRole("option", { name: "Custom…" }));
    const width = screen.getByRole("textbox", { name: "Aspect ratio width" });
    const height = screen.getByRole("textbox", { name: "Aspect ratio height" });
    fireEvent.change(width, { target: { value: "5" } });
    fireEvent.change(height, { target: { value: "4" } });
    fireEvent.blur(height);
    expect(onCommit).toHaveBeenLastCalledWith("5 / 4");
  });

  it("opens a stored custom ratio on its width and height", () => {
    mount("5 / 4");
    expect(
      (
        screen.getByRole("textbox", {
          name: "Aspect ratio width",
        }) as HTMLInputElement
      ).value
    ).toBe("5");
    expect(
      screen.getByRole("combobox", { name: "Aspect ratio" }).textContent
    ).toBe("Custom…");
  });

  it("writes nothing for a width or a height that is not a positive number", () => {
    const onCommit = mount("5 / 4");
    const height = screen.getByRole("textbox", { name: "Aspect ratio height" });
    fireEvent.change(height, { target: { value: "0" } });
    fireEvent.blur(height);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("shows the ratio a stored change brings, not the numbers it opened on", () => {
    // An undo or a shared style's update moves one custom ratio to another
    // while the field stays mounted; blurring stale numbers would write the
    // old ratio back.
    const onCommit = mount("5 / 4");
    onCommit.rerender("8 / 3");
    const width = screen.getByRole("textbox", { name: "Aspect ratio width" });
    expect((width as HTMLInputElement).value).toBe("8");
    fireEvent.blur(width);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("refuses a number CSS does not read, rather than storing another one", () => {
    // `Number("0x10")` is 16; CSS reads no hex number.
    const onCommit = mount("5 / 4");
    const width = screen.getByRole("textbox", { name: "Aspect ratio width" });
    fireEvent.change(width, { target: { value: "0x10" } });
    fireEvent.blur(width);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("shows an inherited ratio in place of Not set, marked as inherited", () => {
    mount(undefined, { inherited: "16 / 9" });
    const trigger = screen.getByRole("combobox", { name: "Aspect ratio" });
    expect(trigger.textContent).toBe("16:9");
    expect(trigger.hasAttribute("data-inherited")).toBe(true);
  });

  it("points a custom ratio's width and height at a refusal", () => {
    mount("5 / 4", { describedBy: "ratio-error" });
    for (const name of ["Aspect ratio width", "Aspect ratio height"]) {
      const input = screen.getByRole("textbox", { name });
      expect(input.getAttribute("aria-describedby")).toBe("ratio-error");
      expect(input.getAttribute("aria-invalid")).toBe("true");
    }
  });

  it("writes any ratio CSS takes as text, for one the menu has no words for", () => {
    const onCommit = mount();
    fireEvent.click(screen.getByRole("combobox", { name: "Aspect ratio" }));
    fireEvent.click(screen.getByRole("option", { name: "Write as CSS…" }));
    const css = screen.getByRole("textbox", { name: "Aspect ratio as CSS" });
    fireEvent.change(css, { target: { value: "auto 4 / 3" } });
    fireEvent.blur(css);
    expect(onCommit).toHaveBeenCalledWith("auto 4 / 3");
  });

  it("shows a stored ratio once one arrives, closing the CSS it was written in", () => {
    const onCommit = mount();
    fireEvent.click(screen.getByRole("combobox", { name: "Aspect ratio" }));
    fireEvent.click(screen.getByRole("option", { name: "Write as CSS…" }));
    onCommit.rerender("16 / 9");
    expect(
      screen.getByRole("combobox", { name: "Aspect ratio" }).textContent
    ).toBe("16:9");
    expect(
      screen.queryByRole("textbox", { name: "Aspect ratio as CSS" })
    ).toBeNull();
  });

  it("shows an inherited ratio the menu has no words for, as it is written", () => {
    mount(undefined, { inherited: "auto 4 / 3" });
    const trigger = screen.getByRole("combobox", { name: "Aspect ratio" });
    expect(trigger.textContent).toBe("auto 4 / 3");
    expect(trigger.hasAttribute("data-inherited")).toBe(true);
  });

  it("commits on Enter without submitting the entry it is mounted inside", () => {
    // The builder mounts inside the entry's form, where an unprevented Enter
    // saves or publishes the whole entry.
    const submitted = vi.fn((event: React.FormEvent) => event.preventDefault());
    const onCommit = vi.fn(() => "applied" as const);
    render(
      <form onSubmit={submitted}>
        <AspectRatioField
          id="ratio"
          labelledBy="ratio"
          stored="5 / 4"
          actionName="Aspect ratio"
          describedBy={undefined}
          onCommit={onCommit}
        />
      </form>
    );
    const width = screen.getByRole("textbox", { name: "Aspect ratio width" });
    fireEvent.change(width, { target: { value: "6" } });
    const enter = fireEvent.keyDown(width, { key: "Enter" });
    expect(enter).toBe(false);
    expect(onCommit).toHaveBeenCalledWith("6 / 4");
  });

  it("commits a ratio written as CSS on Enter without submitting the entry", () => {
    const submitted = vi.fn((event: React.FormEvent) => event.preventDefault());
    const onCommit = vi.fn(() => "applied" as const);
    render(
      <form onSubmit={submitted}>
        <AspectRatioField
          id="ratio"
          labelledBy="ratio"
          stored={undefined}
          actionName="Aspect ratio"
          describedBy={undefined}
          onCommit={onCommit}
        />
      </form>
    );
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Write as CSS…" }));
    const css = screen.getByRole("textbox", { name: "Aspect ratio as CSS" });
    fireEvent.change(css, { target: { value: "auto 4 / 3" } });
    expect(fireEvent.keyDown(css, { key: "Enter" })).toBe(false);
    expect(onCommit).toHaveBeenCalledWith("auto 4 / 3");
  });
});
