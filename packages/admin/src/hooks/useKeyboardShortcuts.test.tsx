// @vitest-environment jsdom
/**
 * The admin's shortcuts are declarations now, not listeners.
 *
 * What these pin is the part a translation layer can get wrong silently: which keystroke each
 * shortcut maps to, and whether it is allowed to fire while the user is typing. Both were
 * decided by the old hook returning early, and are now decided per binding.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { cleanup, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  toKeySpec,
  useEntryFormShortcuts,
  useEntryListShortcuts,
  useKeyboardShortcuts,
  type Shortcut,
} from "./useKeyboardShortcuts";

// Every mounted provider keeps its own listener on the shared jsdom document, so without this a
// keystroke dispatched by one test would still reach every earlier test's tree.
afterEach(cleanup);

function Wrapper({ children }: { children: ReactNode }): ReactElement {
  return <ShortcutProvider isApple={false}>{children}</ShortcutProvider>;
}

/** Dispatches from a real focused element, because "is the user typing" is read off the target. */
function pressFrom(
  target: HTMLElement,
  key: string,
  init: KeyboardEventInit = {}
): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    })
  );
}

function withField(): HTMLInputElement {
  const field = document.createElement("input");
  document.body.append(field);
  return field;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("translating a shortcut into a key spec", () => {
  it("renders ctrl as the platform modifier, not as Control", () => {
    // This hook has always meant "Control OR Command" by `ctrl`, which is what `mod` resolves to
    // per platform. Emitting a literal `ctrl` would stop every admin shortcut on macOS.
    expect(toKeySpec({ key: "s", ctrl: true } as Shortcut)).toBe("mod+s");
    expect(toKeySpec({ key: "Delete" } as Shortcut)).toBe("Delete");
    expect(
      toKeySpec({ key: "k", ctrl: true, shift: true, alt: true } as Shortcut)
    ).toBe("mod+alt+shift+k");
  });
});

describe("a shortcut whose combination a text field owns", () => {
  it("does not take mod+a from an input", () => {
    // Inside a field this selects the text. Taking it to select every row would break editing in
    // the field the user is looking at — and the manager's default for a modifier-led binding is
    // to fire while typing, so this only holds because the adapter opts out.
    const onSelectAll = vi.fn();
    function List(): null {
      useEntryListShortcuts({
        onNew: vi.fn(),
        onSearch: vi.fn(),
        onSelectAll,
        onDelete: vi.fn(),
        hasSelection: false,
      });
      return null;
    }
    render(<List />, { wrapper: Wrapper });

    const field = withField();
    field.focus();
    pressFrom(field, "a", { ctrlKey: true });
    expect(onSelectAll).not.toHaveBeenCalled();

    // The control: outside a field the very same keystroke DOES select all, so this is not
    // passing because the binding never registered.
    pressFrom(document.body, "a", { ctrlKey: true });
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });
});

describe("saving from inside the field being edited", () => {
  it("fires mod+s while typing, and leaves Escape to the field", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    function Form(): null {
      useEntryFormShortcuts({ onSave, onCancel, isDirty: true });
      return null;
    }
    render(<Form />, { wrapper: Wrapper });

    const field = withField();
    field.focus();

    pressFrom(field, "s", { ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);

    // Escape stays out of fields: it is how a menu, popover or IME composition is dismissed, and
    // cancelling the whole form out from under one of those is not what the keystroke meant.
    pressFrom(field, "Escape");
    expect(onCancel).not.toHaveBeenCalled();

    // The control: outside a field Escape still cancels, so the binding exists.
    pressFrom(document.body, "Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("respects the condition on save", () => {
    const onSave = vi.fn();
    function Form(): null {
      useEntryFormShortcuts({ onSave, onCancel: vi.fn(), isDirty: false });
      return null;
    }
    render(<Form />, { wrapper: Wrapper });

    pressFrom(document.body, "s", { ctrlKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("the listener the admin installs", () => {
  it("is one, however many hooks register", () => {
    // The defect this migration removes: each hook instance added its OWN document listener, and
    // `stopPropagation` does not stop a sibling on the same node, so both ran and mount order
    // decided which appeared to win.
    const added = vi.spyOn(document, "addEventListener");
    function Many(): null {
      useKeyboardShortcuts([
        { key: "n", ctrl: true, action: vi.fn(), description: "New" },
      ]);
      useKeyboardShortcuts([
        { key: "j", action: vi.fn(), description: "Next" },
      ]);
      useEntryListShortcuts({
        onNew: vi.fn(),
        onSearch: vi.fn(),
        onSelectAll: vi.fn(),
        onDelete: vi.fn(),
        hasSelection: false,
      });
      return null;
    }
    render(<Many />, { wrapper: Wrapper });

    expect(
      added.mock.calls.filter(([type]) => type === "keydown")
    ).toHaveLength(1);
    added.mockRestore();
  });
});

describe("a condition that changes between renders", () => {
  it("is read at press time, not captured at mount", () => {
    // The refs this hook used to keep existed only because a long-lived listener captured its
    // closure once. The bindings are rebuilt each render now, so the plain value is current.
    const onDelete = vi.fn();
    function List({ hasSelection }: { hasSelection: boolean }): null {
      useEntryListShortcuts({
        onNew: vi.fn(),
        onSearch: vi.fn(),
        onSelectAll: vi.fn(),
        onDelete,
        hasSelection,
      });
      return null;
    }
    const view = render(<List hasSelection={false} />, { wrapper: Wrapper });

    pressFrom(document.body, "Delete");
    expect(onDelete).not.toHaveBeenCalled();

    view.rerender(
      <Wrapper>
        <List hasSelection />
      </Wrapper>
    );
    pressFrom(document.body, "Delete");
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
