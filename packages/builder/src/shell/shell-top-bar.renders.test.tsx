// @vitest-environment jsdom

/**
 * How often the shell's top bar is drawn: again only when something it shows
 * changes, never for a render of the shell that changed nothing in it, such
 * as a selection redrawing the inspector beside it. The bar is counted by the
 * hook that measures it for room, which runs once per draw.
 *
 * @module shell-top-bar.renders.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MIN_SHELL_WIDTH, type PreferenceStore } from "../shell-state";
import { BuilderShell } from "./builder-shell";

/** The bar's draws, counted through the hook each draw runs. */
const counted = vi.hoisted(() => ({ barDraws: 0 }));

vi.mock("./top-bar-room", async importOriginal => {
  const real = await importOriginal<typeof import("./top-bar-room")>();
  return {
    ...real,
    useTopBarRoom: (...args: Parameters<typeof real.useTopBarRoom>) => {
      counted.barDraws += 1;
      return real.useTopBarRoom(...args);
    },
  };
});

/** Every observed element as wide as the whole shell needs, so it is drawn. */
class WideResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    const width = MIN_SHELL_WIDTH + 160;
    this.callback(
      [
        {
          target,
          borderBoxSize: [{ inlineSize: width, blockSize: 900 }],
          contentRect: { width, height: 900 },
        } as unknown as ResizeObserverEntry,
      ],
      this as never
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

function memoryStore(): PreferenceStore {
  let value: string | null = null;
  return {
    read: () => value,
    write: next => {
      value = next;
    },
    remove: () => {
      value = null;
    },
  } as PreferenceStore;
}

beforeEach(() => {
  counted.barDraws = 0;
  vi.stubGlobal("ResizeObserver", WideResizeObserver);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The host's three columns, kept as one value as a memoising host keeps them. */
const COLUMNS = {
  topBar: <span>Page title</span>,
  topBarCenter: <span>Devices</span>,
  topBarEnd: <span>Publish</span>,
};

describe("the shell's top bar, drawn again only for what it shows", () => {
  it("is not drawn again when the shell renders for something beside it", () => {
    const store = memoryStore();
    const shell = (selected: string, onExit: () => void) => (
      <BuilderShell
        store={store}
        // A new handler on every render, as a host's inline one is.
        onExit={onExit}
        {...COLUMNS}
        inspector={<p>{selected} selected</p>}
      />
    );
    const { rerender } = render(shell("Alpha", () => {}));
    expect(screen.getByText("Page title")).toBeTruthy();
    const drawn = counted.barDraws;
    // The control: the counter sees the bar drawn.
    expect(drawn).toBeGreaterThan(0);

    rerender(shell("Beta", () => {}));
    rerender(shell("Gamma", () => {}));

    // The control: the shell itself rendered what changed beside the bar.
    expect(screen.getByText("Gamma selected")).toBeTruthy();
    expect(counted.barDraws).toBe(drawn);
  });

  it("calls the newest exit the host handed it, though the bar was not drawn again", () => {
    const store = memoryStore();
    const first = vi.fn();
    const newest = vi.fn();
    const shell = (onExit: () => void) => (
      <BuilderShell store={store} onExit={onExit} {...COLUMNS} />
    );
    const { rerender } = render(shell(first));
    rerender(shell(newest));

    fireEvent.click(screen.getByRole("button", { name: "Exit editor" }));

    expect(newest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("is drawn again with what changed: a column, or an exit there no longer is", () => {
    const store = memoryStore();
    const { rerender } = render(
      <BuilderShell store={store} onExit={() => {}} {...COLUMNS} />
    );
    const drawn = counted.barDraws;

    rerender(
      <BuilderShell
        store={store}
        onExit={() => {}}
        {...COLUMNS}
        topBar={<span>Renamed page</span>}
      />
    );
    expect(counted.barDraws).toBeGreaterThan(drawn);
    expect(screen.getByText("Renamed page")).toBeTruthy();

    rerender(<BuilderShell store={store} {...COLUMNS} />);
    expect(screen.queryByRole("button", { name: "Exit editor" })).toBeNull();
  });
});
