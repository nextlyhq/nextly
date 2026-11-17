// @vitest-environment jsdom

/**
 * The row of preview tags over the canvas.
 *
 * The properties a plausible implementation gets wrong: a second floating
 * tag drawn over the variant's (two rows, or two elements at one corner),
 * a mode tag left standing once the pick is cleared, and a way back that is
 * not a real button.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasPreviewTags } from "./canvas-preview-tags";

afterEach(() => cleanup());

describe("the canvas's preview tags", () => {
  it("draws nothing while the canvas previews neither a variant nor a mode", () => {
    const { container } = render(
      <CanvasPreviewTags
        variant={undefined}
        mode={null}
        onUseDevice={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("says the mode picked and clears it from a real button", () => {
    const onUseDevice = vi.fn();
    const { rerender } = render(
      <CanvasPreviewTags
        variant={undefined}
        mode="dark"
        onUseDevice={onUseDevice}
      />
    );
    expect(screen.getByRole("status").textContent).toBe("Dark preview");
    const clear = screen.getByRole("button", { name: "Use device" });
    expect(clear.getAttribute("type")).toBe("button");
    fireEvent.click(clear);
    expect(onUseDevice).toHaveBeenCalledTimes(1);

    rerender(
      <CanvasPreviewTags
        variant={undefined}
        mode="light"
        onUseDevice={onUseDevice}
      />
    );
    expect(screen.getByRole("status").textContent).toBe("Light preview");

    rerender(
      <CanvasPreviewTags
        variant={undefined}
        mode={null}
        onUseDevice={onUseDevice}
      />
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Use device" })).toBeNull();
  });

  it("puts the variant's tag and the mode's in one row, the variant first", () => {
    const { container } = render(
      <CanvasPreviewTags variant="Night" mode="dark" onUseDevice={vi.fn()} />
    );
    const rows = container.querySelectorAll(".nx-canvas-tags");
    expect(rows).toHaveLength(1);
    const [row] = rows;
    // Both tags are the row's own children, so the row lays them out side by
    // side; neither is drawn anywhere else.
    expect([...(row?.children ?? [])].map(child => child.textContent)).toEqual([
      "Previewing Night",
      "Dark preview·Use device",
    ]);
    expect(container.children).toHaveLength(1);
    expect(
      screen.getAllByRole("status").map(status => status.textContent)
    ).toEqual(["Previewing Night", "Dark preview"]);
  });

  it("keeps the variant's tag in the row alone when no mode is picked", () => {
    const { container } = render(
      <CanvasPreviewTags variant="Night" mode={null} onUseDevice={vi.fn()} />
    );
    const row = container.querySelector(".nx-canvas-tags");
    expect(row?.children).toHaveLength(1);
    expect(row?.textContent).toBe("Previewing Night");
  });
});
