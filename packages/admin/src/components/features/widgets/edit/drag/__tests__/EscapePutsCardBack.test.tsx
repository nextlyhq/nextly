/**
 * Escape while a card's edge is held, through the admin's one shortcut owner.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EscapePutsCardBack } from "../EscapePutsCardBack";

describe("Escape while a card's edge is held", () => {
  it("puts the card back, wherever focus is, a text field included", () => {
    const cancel = vi.fn();
    const { getByRole } = render(
      <ShortcutProvider>
        <input aria-label="Somewhere to type" />
        <EscapePutsCardBack cancel={cancel} />
      </ShortcutProvider>
    );
    const field = getByRole("textbox");
    field.focus();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("is no longer bound once the edge is let go", () => {
    const cancel = vi.fn();
    const { rerender } = render(
      <ShortcutProvider>
        <EscapePutsCardBack cancel={cancel} />
      </ShortcutProvider>
    );
    rerender(<ShortcutProvider>{null}</ShortcutProvider>);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(cancel).not.toHaveBeenCalled();
  });
});
