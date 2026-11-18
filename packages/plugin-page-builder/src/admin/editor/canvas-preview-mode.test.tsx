// @vitest-environment jsdom

/**
 * The canvas's light and dark preview: when the top bar's switch is offered,
 * what the canvas is drawn in, and what is kept.
 *
 * The properties a plausible implementation gets wrong: a switch offered on
 * a site whose variables have no dark value, or hidden on one where only a
 * built-in colour has one; a preview that follows the author's device rather
 * than starting light; a pick lost when the editor opens another page, or
 * kept into a new session; and a canvas left dark once the last dark value
 * is removed.
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import { TooltipProvider } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import {
  CanvasModeSwitch,
  previewedCanvas,
  useCanvasPreviewMode,
} from "./canvas-preview-mode";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

/** Every built-in colour stated without a dark value, as a site may. */
const NO_DARK: SiteTokenSet = {
  tokens: [
    "color.primary",
    "color.text",
    "color.background",
    "color.surface",
    "color.border",
    "color.border-strong",
    "color.muted",
  ].map(name => ({ name, kind: "color", values: { light: "#777777" } })),
};

/** The same site with one colour of its own given a dark value. */
const ONE_DARK: SiteTokenSet = {
  tokens: [
    ...NO_DARK.tokens,
    {
      name: "color.sea",
      kind: "color",
      values: { light: "#1b7f5c", dark: "#8fe3c0" },
    },
  ],
};

/** The top bar's switch and what the canvas is drawn in, as the editor wires them. */
function Editor({
  tokens,
}: {
  tokens: SiteTokenSet | undefined;
}): React.JSX.Element {
  const preview = useCanvasPreviewMode(tokens);
  const canvas = previewedCanvas(preview, undefined);
  return (
    <TooltipProvider>
      <CanvasModeSwitch preview={preview} />
      <output data-testid="canvas-theme">{canvas.theme}</output>
    </TooltipProvider>
  );
}

const darkSwitch = (): HTMLElement | null =>
  screen.queryByRole("button", { name: "Preview in dark mode" });

const canvasTheme = (): string | null =>
  screen.getByTestId("canvas-theme").textContent;

describe("the canvas's light and dark preview", () => {
  it("offers the switch only while some variable has a dark value", () => {
    const { rerender } = render(<Editor tokens={NO_DARK} />);
    expect(darkSwitch()).toBeNull();
    rerender(<Editor tokens={ONE_DARK} />);
    expect(darkSwitch()).not.toBeNull();
    rerender(<Editor tokens={NO_DARK} />);
    expect(darkSwitch()).toBeNull();
  });

  it("counts the built-in colours' dark values, which the canvas draws with", () => {
    // A site stating nothing still has the engine's own colours, dark values
    // included, under its own.
    render(<Editor tokens={{ tokens: [] }} />);
    expect(darkSwitch()).not.toBeNull();
  });

  it("starts light, even on a device that prefers dark, and draws dark once pressed", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    onTestFinished(() => {
      window.matchMedia = original;
    });
    expect(window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(
      true
    );
    render(<Editor tokens={ONE_DARK} />);
    expect(canvasTheme()).toBe("light");
    expect(darkSwitch()?.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(darkSwitch() as HTMLElement);

    expect(canvasTheme()).toBe("dark");
    expect(darkSwitch()?.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(darkSwitch() as HTMLElement);
    expect(canvasTheme()).toBe("light");
  });

  it("keeps the pick when the editor opens another page in the same session, and a new session starts light", () => {
    const first = render(<Editor tokens={ONE_DARK} />);
    fireEvent.click(darkSwitch() as HTMLElement);
    first.unmount();

    // Another page: a new editor in the same session.
    const second = render(<Editor tokens={ONE_DARK} />);
    expect(canvasTheme()).toBe("dark");
    expect(darkSwitch()?.getAttribute("aria-pressed")).toBe("true");
    second.unmount();

    // A new session: its session storage starts empty.
    sessionStorage.clear();
    render(<Editor tokens={ONE_DARK} />);
    expect(canvasTheme()).toBe("light");
  });

  it("hides the switch and returns the canvas to light when the last dark value is removed while previewing dark", () => {
    const { rerender } = render(<Editor tokens={ONE_DARK} />);
    fireEvent.click(darkSwitch() as HTMLElement);
    expect(canvasTheme()).toBe("dark");

    rerender(<Editor tokens={NO_DARK} />);

    expect(darkSwitch()).toBeNull();
    expect(canvasTheme()).toBe("light");
    // A dark value added afterwards starts the preview light again.
    rerender(<Editor tokens={ONE_DARK} />);
    expect(darkSwitch()?.getAttribute("aria-pressed")).toBe("false");
    expect(canvasTheme()).toBe("light");
  });

  it("keeps the pick while the site's variables are still being read", () => {
    const { rerender } = render(<Editor tokens={ONE_DARK} />);
    fireEvent.click(darkSwitch() as HTMLElement);
    rerender(<Editor tokens={undefined} />);
    expect(canvasTheme()).toBe("dark");
    rerender(<Editor tokens={ONE_DARK} />);
    expect(canvasTheme()).toBe("dark");
  });

  it("still switches where the browser refuses session storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("refused", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("refused", "SecurityError");
    });
    render(<Editor tokens={ONE_DARK} />);
    // Held for the page's lifetime instead, so which mode it holds depends
    // on the presses earlier in this file; each press must still flip it.
    const before = canvasTheme();
    act(() => {
      fireEvent.click(darkSwitch() as HTMLElement);
    });
    const after = canvasTheme();
    expect(after).not.toBe(before);
    act(() => {
      fireEvent.click(darkSwitch() as HTMLElement);
    });
    expect(canvasTheme()).toBe(before);
  });

  it("still switches where the browser reads session storage but refuses a write", () => {
    // A full storage: reads answer, writes throw.
    sessionStorage.setItem("nextly:page-builder:canvas-preview-mode", "light");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    render(<Editor tokens={ONE_DARK} />);
    // Which mode it starts in depends on the presses earlier in this file,
    // as above; each press must still flip it.
    const before = canvasTheme();
    act(() => {
      fireEvent.click(darkSwitch() as HTMLElement);
    });
    expect(canvasTheme()).not.toBe(before);
    act(() => {
      fireEvent.click(darkSwitch() as HTMLElement);
    });
    expect(canvasTheme()).toBe(before);
  });

  it("stores nothing but the session's pick", () => {
    render(<Editor tokens={ONE_DARK} />);
    fireEvent.click(darkSwitch() as HTMLElement);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(1);
  });
});
