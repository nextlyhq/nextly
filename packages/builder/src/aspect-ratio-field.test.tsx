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

beforeAll(() => {
  // Radix's select measures and scrolls, which jsdom does not do.
  const element = Element.prototype as unknown as Record<string, unknown>;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => {};
});

afterEach(cleanup);

function mount(stored?: string) {
  const onCommit = vi.fn(() => "applied" as const);
  render(
    <>
      <span id="ratio-label">Aspect ratio</span>
      <AspectRatioField
        id="ratio"
        labelledBy="ratio-label"
        stored={stored}
        actionName="Aspect ratio"
        describedBy={undefined}
        onCommit={onCommit}
      />
    </>
  );
  return onCommit;
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
});
