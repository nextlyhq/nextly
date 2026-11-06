// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditingBar } from "./editing-bar";

afterEach(() => cleanup());

describe("a shared style chip's held Detach", () => {
  const chips = [{ id: "c-card", name: "Card", className: ".nx-c-card" }];

  it("asks why Detach is held only once its menu is open", () => {
    // Asking plans the whole detach, so it waits for a reader to look: the
    // bar draws on every inspector render, and the menu is rarely open.
    const detachHeld = vi.fn((): string | undefined => "Held for a reason.");
    const view = render(
      <EditingBar
        target={{ kind: "block" }}
        device="All devices"
        state="base"
        chips={chips}
        onTargetChange={() => {}}
        onDetach={() => {}}
        detachHeld={detachHeld}
      />
    );
    view.rerender(
      <EditingBar
        target={{ kind: "block" }}
        device="All devices"
        state="base"
        chips={chips}
        onTargetChange={() => {}}
        onDetach={() => {}}
        detachHeld={detachHeld}
      />
    );
    expect(detachHeld).not.toHaveBeenCalled();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Actions for shared style Card" }),
      { button: 0, ctrlKey: false }
    );
    expect(detachHeld).toHaveBeenCalledWith("c-card");
    expect(
      screen.getByRole("menuitem", { name: /^Detach: keep the look/ })
        .textContent
    ).toContain("Held for a reason.");
  });
});
