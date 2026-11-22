// @vitest-environment jsdom

/**
 * The bar above the canvas while a region is edited in place: the host's
 * words and Done, a pulse of Done for each press on the dimmed page, and a
 * live region that is there before anything is said in it, so entering and
 * leaving are announced.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditingTargetState } from "./editing-target";
import { RegionEditingBar } from "./region-editing-bar";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const words = {
  bar: "Editing the site header · changes show on 11 pages",
  done: "Done",
  entered: "Editing the site header. Changes show on 11 pages.",
  left: "Back to the page.",
};

type BarEditing = Pick<
  EditingTargetState,
  "target" | "leave" | "pulse" | "announcement"
>;

function editingOf(more: Partial<BarEditing> = {}): BarEditing {
  return {
    target: {
      kind: "region",
      area: "header",
      document: { formatVersion: 1, kind: "component", nodes: [] },
      label: "Site header",
      words,
    },
    leave: vi.fn(),
    pulse: 0,
    announcement: words.entered,
    ...more,
  };
}

describe("the region editing bar", () => {
  it("says what is edited and how far it reaches, with Done, in the host's words", () => {
    const editing = editingOf();
    render(<RegionEditingBar editing={editing} />);
    expect(screen.getByText(words.bar)).toBeTruthy();
    const done = screen.getByRole("button", { name: "Done" });
    // Done is described by the bar, so a screen reader hears what it ends.
    expect(done.getAttribute("aria-describedby")).toBe(
      screen.getByText(words.bar).id
    );
    fireEvent.click(done);
    expect(editing.leave).toHaveBeenCalledTimes(1);
  });

  it("runs the host's Done in place of leaving at once, where it has one", () => {
    const editing = editingOf();
    const onDone = vi.fn();
    render(<RegionEditingBar editing={editing} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(editing.leave).not.toHaveBeenCalled();
  });

  it("draws no bar while the page is edited, but keeps its live region", () => {
    render(
      <RegionEditingBar
        editing={editingOf({ target: { kind: "page" }, announcement: "" })}
      />
    );
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    const live = screen.getByRole("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("");
  });

  it("announces entering and leaving in the live region it kept", () => {
    const view = render(
      <RegionEditingBar
        editing={editingOf({ target: { kind: "page" }, announcement: "" })}
      />
    );
    const live = screen.getByRole("status");
    view.rerender(<RegionEditingBar editing={editingOf()} />);
    // The same element, not a new one: a region that arrives with its text is
    // often not read at all.
    expect(screen.getByRole("status")).toBe(live);
    expect(live.textContent).toBe(words.entered);
    view.rerender(
      <RegionEditingBar
        editing={editingOf({
          target: { kind: "page" },
          announcement: words.left,
        })}
      />
    );
    expect(screen.getByRole("status")).toBe(live);
    expect(live.textContent).toBe(words.left);
  });

  it("highlights Done briefly on each press of the dimmed page", () => {
    vi.useFakeTimers();
    const view = render(<RegionEditingBar editing={editingOf()} />);
    const done = screen.getByRole("button", { name: "Done" });
    expect(done.hasAttribute("data-pulsing")).toBe(false);
    view.rerender(<RegionEditingBar editing={editingOf({ pulse: 1 })} />);
    expect(done.hasAttribute("data-pulsing")).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(done.hasAttribute("data-pulsing")).toBe(false);
    // A second press highlights it again.
    view.rerender(<RegionEditingBar editing={editingOf({ pulse: 2 })} />);
    expect(done.hasAttribute("data-pulsing")).toBe(true);
  });
});
