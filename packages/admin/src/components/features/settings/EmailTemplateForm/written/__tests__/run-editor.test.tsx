/**
 * The editor of a written block's text: it stops taking input the moment the
 * email turns read-only (as during a save), and it shows a chip's marks.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RunEditor } from "../RunEditor";

describe("a written block's text editor", () => {
  it("stops taking input when the email turns read-only", () => {
    const { rerender } = render(
      <RunEditor label="Heading" value={[]} onChange={() => {}} />
    );
    expect(
      screen
        .getByRole("textbox", { name: "Heading" })
        .getAttribute("contenteditable")
    ).toBe("true");
    rerender(
      <RunEditor label="Heading" value={[]} onChange={() => {}} readOnly />
    );
    expect(
      screen
        .getByRole("textbox", { name: "Heading" })
        .getAttribute("contenteditable")
    ).toBe("false");
  });

  it("shows a chip in bold or italic when it is stored so", () => {
    const { container } = render(
      <RunEditor
        rich
        label="Text"
        value={[{ type: "chip", variable: "name", bold: true, italic: true }]}
        onChange={() => {}}
      />
    );
    const chip = container.querySelector('[data-variable="name"]');
    expect(chip?.className).toContain("font-semibold");
    expect(chip?.className).toContain("italic");
  });
});
