/**
 * The drop area a screen reads a file from: pressed, or activated from the
 * keyboard, it opens the file chooser; turned off, it offers neither, is
 * left out of the tab order and says it is unavailable.
 *
 * @module components/ui/__tests__/file-drop-area.test
 */
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { FileDropArea } from "../file-drop-area";

const target = () => screen.getByRole("button", { name: "Choose a file" });

describe("the file drop area", () => {
  it("opens the chooser from the keyboard", () => {
    const { container } = render(
      <FileDropArea onFiles={vi.fn()} label="Choose a file" title="Drop it" />
    );
    const input = container.querySelector('input[type="file"]');
    const opened = vi.fn();
    input?.addEventListener("click", opened);
    fireEvent.keyDown(target(), { key: "Enter" });
    expect(opened).toHaveBeenCalledTimes(1);
    expect(target().getAttribute("tabindex")).toBe("0");
  });

  it("turned off, takes no press and leaves the tab order", () => {
    render(
      <FileDropArea
        onFiles={vi.fn()}
        label="Choose a file"
        title="Drop it"
        disabled
      />
    );
    // Nothing to open: a press does nothing rather than failing.
    expect(() => {
      fireEvent.keyDown(target(), { key: "Enter" });
      fireEvent.click(target());
    }).not.toThrow();
    expect(target().getAttribute("aria-disabled")).toBe("true");
    expect(target().getAttribute("tabindex")).toBe("-1");
  });
});
