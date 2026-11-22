// @vitest-environment jsdom

/**
 * The top bar's light and dark preview switch.
 *
 * The properties a plausible implementation gets wrong: a name that changes
 * with the state (so a screen reader hears "Preview in light mode" and cannot
 * tell what pressing does), two buttons where the state is one pressed
 * control, a press that hands back the mode already shown, and a tooltip
 * missing for keyboard focus, where the control has no visible words.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DarkPreviewSwitch } from "./dark-preview-switch";

afterEach(cleanup);

function renderSwitch(mode: "light" | "dark"): {
  onMode: ReturnType<typeof vi.fn>;
  rerender: (next: "light" | "dark") => void;
} {
  const onMode = vi.fn();
  // No provider around it: the switch brings its own, so a host may place
  // it anywhere.
  const tree = (current: "light" | "dark") => (
    <DarkPreviewSwitch mode={current} onMode={onMode} />
  );
  const { rerender } = render(tree(mode));
  return { onMode, rerender: next => rerender(tree(next)) };
}

describe("the dark preview switch", () => {
  it("is one button named for dark mode, pressed only while the preview is dark", () => {
    const { rerender } = renderSwitch("light");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    const button = screen.getByRole("button", {
      name: "Preview in dark mode",
    });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-pressed")).toBe("false");

    rerender("dark");

    // The same name in both states: the pressed state says which it is.
    expect(
      screen
        .getByRole("button", { name: "Preview in dark mode" })
        .getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("asks for the other mode when pressed", () => {
    const { onMode, rerender } = renderSwitch("light");
    fireEvent.click(screen.getByRole("button"));
    expect(onMode).toHaveBeenLastCalledWith("dark");

    rerender("dark");
    fireEvent.click(screen.getByRole("button"));
    expect(onMode).toHaveBeenLastCalledWith("light");
  });

  it("marks the sun or the moon as the mode shown", () => {
    const { rerender } = renderSwitch("light");
    const sides = () =>
      [...document.querySelectorAll("[data-side]")].map(side => [
        side.getAttribute("data-side"),
        side.getAttribute("data-on"),
      ]);
    expect(sides()).toEqual([
      ["light", "true"],
      ["dark", "false"],
    ]);
    rerender("dark");
    expect(sides()).toEqual([
      ["light", "false"],
      ["dark", "true"],
    ]);
  });

  it.each([
    [
      "on hover",
      (button: HTMLElement) =>
        fireEvent.pointerMove(button, { pointerType: "mouse" }),
    ],
    ["on keyboard focus", (button: HTMLElement) => button.focus()],
  ])("says it is a preview only, %s", (_, reach) => {
    vi.useFakeTimers();
    try {
      renderSwitch("light");
      expect(screen.queryByRole("tooltip")).toBeNull();
      act(() => reach(screen.getByRole("button")));
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByRole("tooltip").textContent).toBe(
        "Preview only. Visitors see what their own device is set to."
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
