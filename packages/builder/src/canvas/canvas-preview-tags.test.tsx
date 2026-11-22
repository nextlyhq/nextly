// @vitest-environment jsdom

/**
 * The row of preview tags over the canvas.
 *
 * The properties a plausible implementation gets wrong: a row left standing
 * with nothing in it, and a second floating tag drawn beside the row. The
 * site's light or dark preview has no tag here: the top bar's switch says
 * which mode the canvas shows.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CanvasPreviewTags } from "./canvas-preview-tags";

afterEach(() => cleanup());

describe("the canvas's preview tags", () => {
  it("draws nothing while the canvas previews no variant", () => {
    const { container } = render(<CanvasPreviewTags variant={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("draws the variant's tag in the one row, and nothing else", () => {
    const { container } = render(<CanvasPreviewTags variant="Night" />);
    const rows = container.querySelectorAll(".nx-canvas-tags");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.children).toHaveLength(1);
    expect(container.children).toHaveLength(1);
    expect(
      screen.getAllByRole("status").map(status => status.textContent)
    ).toEqual(["Previewing Night"]);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
