// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { TooltipProvider } from "@nextlyhq/ui";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FIT_ZOOM } from "../canvas-zoom";
import { ShellTopBar } from "./shell-top-bar";

/**
 * The top bar's side-panel toggles say what pressing them does: the icon is
 * the panel closing or opening, the tooltip says "Hide" or "Show", and the
 * button is filled while its panel shows. Pressed state alone, told by the
 * colour of the icon, was how they read before, and it left an author
 * guessing which way a press would go.
 *
 * @module shell-top-bar.test
 */
afterEach(cleanup);

function renderBar({
  leftShown,
  inspectorShown,
}: {
  leftShown: boolean;
  inspectorShown: boolean;
}): { onLeft: () => void; onInspector: () => void } {
  const onLeft = vi.fn();
  const onInspector = vi.fn();
  render(
    <TooltipProvider delayDuration={0}>
      <ShellTopBar
        headerRef={() => {}}
        onExit={undefined}
        title={undefined}
        topBar={undefined}
        topBarCenter={undefined}
        topBarEnd={undefined}
        zoom={FIT_ZOOM}
        appliedScale={1}
        onZoomPick={undefined}
        leftShown={leftShown}
        inspectorShown={inspectorShown}
        onLeft={onLeft}
        onInspector={onInspector}
      />
    </TooltipProvider>
  );
  return { onLeft, onInspector };
}

const toggle = (name: string): HTMLElement =>
  screen.getByRole("button", { name });

/** The Lucide icon the toggle draws, by the class Lucide gives each icon. */
function iconOf(button: HTMLElement): string {
  const svg = button.querySelector("svg");
  if (svg === null) throw new Error("the toggle draws no icon");
  const names = Array.from(svg.classList).filter(
    name => name.startsWith("lucide-") && name !== "lucide-icon"
  );
  return names.join(" ");
}

async function tooltipOf(button: HTMLElement): Promise<string> {
  act(() => button.focus());
  const tip = await screen.findByRole("tooltip");
  return tip.textContent ?? "";
}

describe("side-panel toggles", () => {
  it("draws the close icon, a fill and 'Hide the …' while each panel shows", async () => {
    renderBar({ leftShown: true, inspectorShown: true });
    const left = toggle("Left panel");
    const right = toggle("Inspector");

    expect(left.getAttribute("aria-pressed")).toBe("true");
    expect(right.getAttribute("aria-pressed")).toBe("true");
    expect(iconOf(left)).toMatch(/panel-left-close/);
    expect(iconOf(right)).toMatch(/panel-right-close/);
    expect(left.getAttribute("data-shown")).toBe("true");
    expect(right.getAttribute("data-shown")).toBe("true");
    expect(left.className).toContain("nx-builder-panel-toggle");

    expect(await tooltipOf(left)).toBe("Hide the left panel");
  });

  it("tells the right panel's state in its own tooltip", async () => {
    renderBar({ leftShown: true, inspectorShown: true });
    expect(await tooltipOf(toggle("Inspector"))).toBe("Hide the right panel");
  });

  it("draws the open icon, no fill and 'Show the …' while each panel is hidden", async () => {
    renderBar({ leftShown: false, inspectorShown: false });
    const left = toggle("Left panel");
    const right = toggle("Inspector");

    expect(left.getAttribute("aria-pressed")).toBe("false");
    expect(right.getAttribute("aria-pressed")).toBe("false");
    expect(iconOf(left)).toMatch(/panel-left-open/);
    expect(iconOf(right)).toMatch(/panel-right-open/);
    expect(left.getAttribute("data-shown")).toBe("false");
    expect(right.getAttribute("data-shown")).toBe("false");

    expect(await tooltipOf(left)).toBe("Show the left panel");
  });

  it("says 'Show the right panel' while the inspector is hidden", async () => {
    renderBar({ leftShown: true, inspectorShown: false });
    expect(await tooltipOf(toggle("Inspector"))).toBe("Show the right panel");
  });

  it("keeps each toggle's name while its state changes, and presses through", () => {
    const { onLeft, onInspector } = renderBar({
      leftShown: true,
      inspectorShown: false,
    });
    // A toggle's name stays put and its pressed state says which way it is,
    // so a screen reader hears "Left panel, pressed" rather than a new name.
    fireEvent.click(toggle("Left panel"));
    fireEvent.click(toggle("Inspector"));
    expect(onLeft).toHaveBeenCalledTimes(1);
    expect(onInspector).toHaveBeenCalledTimes(1);
  });
});
