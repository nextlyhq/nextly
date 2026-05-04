// Why: EditorAlert is the single quiet replacement for all the amber
// AlertTriangle panels and the bg-primary/5 "Tip" boxes in per-type
// field editors. Lock the structure (Info icon + bordered box +
// muted text) so future drift is caught.
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { EditorAlert } from "../EditorAlert";

describe("EditorAlert", () => {
  it("renders the children inside a bordered box", () => {
    const { container } = render(
      <EditorAlert>No media collection selected.</EditorAlert>
    );
    expect(
      screen.getByText("No media collection selected.")
    ).toBeInTheDocument();
    // The box itself has border + muted bg classes -- assert on the
    // outer wrapper.
    const box = container.firstChild as HTMLElement;
    expect(box.className).toMatch(/border/);
    expect(box.className).toMatch(/bg-muted/);
  });

  it("renders an Info icon (Lucide svg) at the start", () => {
    const { container } = render(<EditorAlert>Hello</EditorAlert>);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("does NOT use amber/yellow/red colors anywhere", () => {
    const { container } = render(<EditorAlert>Hello</EditorAlert>);
    const html = container.innerHTML;
    expect(html).not.toMatch(/amber/);
    expect(html).not.toMatch(/yellow/);
    expect(html).not.toMatch(/red-/);
    expect(html).not.toMatch(/destructive/);
  });
});
