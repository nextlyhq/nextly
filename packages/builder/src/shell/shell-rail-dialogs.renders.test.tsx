// @vitest-environment jsdom

/**
 * How often the rail, Help and the host's Settings are drawn: again only when
 * something each shows changes, never for a render of the shell that changed
 * nothing in them, such as a selection redrawing the inspector beside them.
 *
 * The rail and Help are counted through their own components, each wrapped by
 * a counter; Settings through the host's own `renderSettings`, which the shell
 * calls once per draw.
 *
 * @module shell-rail-dialogs.renders.test
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MIN_SHELL_WIDTH, type PreferenceStore } from "../shell-state";
import { BuilderShell } from "./builder-shell";
import type { SettingsDialogState } from "./shell-props";

/** Each surface's draws, counted through the component each draw runs. */
const counted = vi.hoisted(() => ({ rail: 0, help: 0 }));

vi.mock("./editor-rail", async importOriginal => {
  const real = await importOriginal<typeof import("./editor-rail")>();
  return {
    ...real,
    EditorRail: (props: Parameters<typeof real.EditorRail>[0]) => {
      counted.rail += 1;
      return real.EditorRail(props);
    },
  };
});

vi.mock("./help-dialog", async importOriginal => {
  const real = await importOriginal<typeof import("./help-dialog")>();
  return {
    ...real,
    HelpDialog: (props: Parameters<typeof real.HelpDialog>[0]) => {
      counted.help += 1;
      return real.HelpDialog(props);
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
  counted.rail = 0;
  counted.help = 0;
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

/** A panel for whichever the rail opens, kept as one function by the host. */
const renderPanel = (panel: string) => <p>{panel} panel</p>;

/** A host's Settings, counting its draws, as one function a memoising host keeps. */
function settingsHost(): {
  draws: () => number;
  renderSettings: (dialog: SettingsDialogState) => React.ReactNode;
} {
  let draws = 0;
  return {
    draws: () => draws,
    renderSettings: dialog => {
      draws += 1;
      return dialog.open ? <p>Settings open</p> : null;
    },
  };
}

function railItem(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

/**
 * The shell as a host renders it while only the selection moves: the
 * inspector names a new block, and the exit is a new inline function.
 */
function shellFor(
  store: PreferenceStore,
  renderSettings: (dialog: SettingsDialogState) => React.ReactNode,
  selected: string
): React.JSX.Element {
  return (
    <BuilderShell
      store={store}
      onExit={() => {}}
      renderPanel={renderPanel}
      renderSettings={renderSettings}
      inspector={<p>{selected} selected</p>}
    />
  );
}

describe("the rail, Help and Settings, drawn again only for what they show", () => {
  it("draws none of them again when the shell renders for something beside them", () => {
    const store = memoryStore();
    const settings = settingsHost();
    const { rerender } = render(
      shellFor(store, settings.renderSettings, "Alpha")
    );
    const drawn = { rail: counted.rail, help: counted.help };
    const settingsDrawn = settings.draws();
    // The controls: each counter sees its surface drawn.
    expect(drawn.rail).toBeGreaterThan(0);
    expect(drawn.help).toBeGreaterThan(0);
    expect(settingsDrawn).toBeGreaterThan(0);

    rerender(shellFor(store, settings.renderSettings, "Beta"));
    rerender(shellFor(store, settings.renderSettings, "Gamma"));

    // The control: the shell itself rendered what changed beside them.
    expect(screen.getByText("Gamma selected")).toBeTruthy();
    expect({ rail: counted.rail, help: counted.help }).toEqual(drawn);
    expect(settings.draws()).toBe(settingsDrawn);
  });

  it("draws the rail again for a panel opened, and not Help or Settings", () => {
    const store = memoryStore();
    const settings = settingsHost();
    render(shellFor(store, settings.renderSettings, "Alpha"));
    const drawn = { rail: counted.rail, help: counted.help };
    const settingsDrawn = settings.draws();

    fireEvent.click(railItem("Layers"));

    expect(railItem("Layers").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("layers panel")).toBeTruthy();
    expect(counted.rail).toBeGreaterThan(drawn.rail);
    expect(counted.help).toBe(drawn.help);
    expect(settings.draws()).toBe(settingsDrawn);
  });

  it("opens the panel a key names after renders it did not draw for", () => {
    // The rail's keys are registered as it draws; one it skipped must still
    // act on the newest preferences, not on those of its last draw.
    const store = memoryStore();
    const settings = settingsHost();
    const { rerender } = render(
      shellFor(store, settings.renderSettings, "Alpha")
    );
    fireEvent.keyDown(document.body, { key: "a" });
    expect(railItem("Add").getAttribute("aria-pressed")).toBe("true");
    rerender(shellFor(store, settings.renderSettings, "Beta"));

    fireEvent.keyDown(document.body, { key: "l" });

    expect(railItem("Layers").getAttribute("aria-pressed")).toBe("true");
    expect(railItem("Add").getAttribute("aria-pressed")).toBe("false");
  });

  it("draws Help again as it opens, and with the panel keys turned off", async () => {
    const store = memoryStore();
    const settings = settingsHost();
    render(shellFor(store, settings.renderSettings, "Alpha"));
    let drawn = counted.help;

    fireEvent.click(railItem("Help"));
    const keys = await screen.findByRole("switch", {
      name: "Single-letter shortcuts",
    });
    expect(counted.help).toBeGreaterThan(drawn);

    drawn = counted.help;
    fireEvent.click(keys);
    await waitFor(() =>
      expect(keys.getAttribute("aria-checked")).toBe("false")
    );
    expect(counted.help).toBeGreaterThan(drawn);
    // The rail sits behind the open modal, hidden from the tree there.
    const layers = screen.getByRole("button", { name: "Layers", hidden: true });
    expect(layers.hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  it("draws Settings again as it opens, and for a new render the host hands it, and not the rail or Help", () => {
    const store = memoryStore();
    const first = settingsHost();
    const { rerender } = render(shellFor(store, first.renderSettings, "Alpha"));

    fireEvent.click(railItem("Settings"));
    expect(screen.getByText("Settings open")).toBeTruthy();
    expect(railItem("Settings").getAttribute("aria-pressed")).toBe("true");

    // What Settings shows changed, so the host hands a new render: it is
    // the one drawn, with the dialog still open.
    const drawn = { rail: counted.rail, help: counted.help };
    const next = settingsHost();
    rerender(shellFor(store, next.renderSettings, "Alpha"));
    expect(next.draws()).toBeGreaterThan(0);
    expect(screen.getByText("Settings open")).toBeTruthy();
    // The rail and Help show nothing of what changed in Settings.
    expect({ rail: counted.rail, help: counted.help }).toEqual(drawn);
  });
});
