// @vitest-environment jsdom
/**
 * The manager's job is to make key ownership DECIDABLE.
 *
 * The defect it replaces is not that shortcuts were missing — it is that several independent
 * `document` listeners each believed they owned a key, and all of them ran. `stopPropagation()`
 * does not stop siblings on the same node, so the winner was whichever component happened to
 * mount first. These tests pin the ordering rules that replace mount order, and the blocking
 * rule that lets a drag hold the keyboard.
 */
import { describe, expect, it, vi } from "vitest";

import { createShortcutManager, type ShortcutBinding } from "./manager";

/** A manager with a fixed platform, so `mod` means the same thing on every machine running CI. */
const managerFor = (isApple = false, now?: () => number) =>
  createShortcutManager({ isApple, now });

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
}

const binding = (
  keys: string,
  run: () => void,
  extra: Partial<ShortcutBinding> = {}
): ShortcutBinding => ({ keys, description: `test ${keys}`, run, ...extra });

describe("modifier matching", () => {
  it("resolves mod to Command on Apple and Control elsewhere", () => {
    const onApple = vi.fn();
    const apple = managerFor(true);
    apple.register([binding("mod+s", onApple)], { name: "a", depth: 0 });
    apple.handle(press("s", { metaKey: true }));
    expect(onApple).toHaveBeenCalledTimes(1);

    const onOther = vi.fn();
    const other = managerFor(false);
    other.register([binding("mod+s", onOther)], { name: "a", depth: 0 });
    other.handle(press("s", { ctrlKey: true }));
    expect(onOther).toHaveBeenCalledTimes(1);
  });

  it("does not fire a Control binding for Command on Apple", () => {
    // The whole point of `mod` being platform-resolved is that `ctrl` can still mean Control
    // specifically. Folding the two together would make a platform-specific binding unwritable.
    const run = vi.fn();
    const manager = managerFor(true);
    manager.register([binding("mod+k", run)], { name: "a", depth: 0 });
    manager.handle(press("k", { ctrlKey: true }));
    expect(run).not.toHaveBeenCalled();
  });

  it("matches modifiers exactly, so a bare key does not fire on mod+key", () => {
    // Treating modifiers as a minimum is how a harmless letter shortcut swallows a destructive
    // one: `s` would fire on mod+s, and the save the user asked for would never reach the form.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("s", run)], { name: "a", depth: 0 });
    manager.handle(press("s", { ctrlKey: true }));
    expect(run).not.toHaveBeenCalled();
    manager.handle(press("s"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("requires shift where shift is a real choice, and ignores it where the key already implies it", () => {
    // `?` is Shift+/ on a US layout, so the browser reports `key: "?"` with shiftKey true. A
    // binding written as `"?"` has to match that, or the natural spelling would never fire —
    // while `"s"` must NOT match Shift+S, which is a keystroke its author never claimed.
    const question = vi.fn();
    const letter = vi.fn();
    const manager = managerFor();
    manager.register([binding("?", question), binding("s", letter)], {
      name: "a",
      depth: 0,
    });

    manager.handle(press("?", { shiftKey: true }));
    expect(question).toHaveBeenCalledTimes(1);

    manager.handle(press("s", { shiftKey: true }));
    expect(letter).not.toHaveBeenCalled();
  });
});

describe("layer precedence", () => {
  it("offers a keystroke to the deeper layer first", () => {
    const shell = vi.fn();
    const canvas = vi.fn();
    const manager = managerFor();
    manager.register([binding("Escape", shell)], { name: "shell", depth: 0 });
    manager.register([binding("Escape", canvas)], { name: "canvas", depth: 2 });

    manager.handle(press("Escape"));
    expect(canvas).toHaveBeenCalledTimes(1);
    expect(shell).not.toHaveBeenCalled();
  });

  it("gives the more recent layer precedence at equal depth", () => {
    // Two dialogs at the same nesting level: the one opened second is on top.
    const first = vi.fn();
    const second = vi.fn();
    const manager = managerFor();
    manager.register([binding("Escape", first)], { name: "first", depth: 1 });
    manager.register([binding("Escape", second)], { name: "second", depth: 1 });

    manager.handle(press("Escape"));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("falls through to a lower layer for a key the top one does not bind", () => {
    const save = vi.fn();
    const cancel = vi.fn();
    const manager = managerFor();
    manager.register([binding("mod+s", save)], { name: "shell", depth: 0 });
    manager.register([binding("Escape", cancel)], { name: "dialog", depth: 1 });

    manager.handle(press("s", { ctrlKey: true }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("passes the key on when a binding's condition is false", () => {
    const guarded = vi.fn();
    const fallback = vi.fn();
    const manager = managerFor();
    manager.register([binding("Escape", fallback)], {
      name: "shell",
      depth: 0,
    });
    manager.register([binding("Escape", guarded, { when: () => false })], {
      name: "top",
      depth: 1,
    });

    manager.handle(press("Escape"));
    expect(guarded).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});

describe("a blocking layer", () => {
  // This is the defect the module exists for: during a drag, the shell's Escape binding
  // navigated out of the editor because both listeners ran.

  /** A shell that saves on mod+s, and a drag layer that binds only Escape. */
  function draggingOver(blocking: boolean) {
    const shellSave = vi.fn();
    const cancelDrag = vi.fn();
    const manager = managerFor();
    manager.register([binding("mod+s", shellSave)], {
      name: "shell",
      depth: 0,
    });
    manager.register([binding("Escape", cancelDrag)], {
      name: "drag",
      depth: 1,
      blocking,
    });
    return { manager, shellSave, cancelDrag };
  }

  it("swallows a key it does not bind instead of letting the shell act", () => {
    // The key here is one the drag layer does NOT bind. Asserting on Escape instead would prove
    // only that the deeper layer wins, which precedence already gives — and would still pass
    // with blocking removed entirely.
    const { manager, shellSave } = draggingOver(true);
    manager.handle(press("s", { ctrlKey: true }));
    expect(shellSave).not.toHaveBeenCalled();
  });

  it("is what stops the shell acting, and not the mere presence of a layer above it", () => {
    // The positive control for the test above: the same stack, the same keystroke, blocking off.
    // Without this, a typo in the key spec would produce the same silence and read as a pass.
    const { manager, shellSave } = draggingOver(false);
    manager.handle(press("s", { ctrlKey: true }));
    expect(shellSave).toHaveBeenCalledTimes(1);
  });

  it("reports the swallowed key as consumed, so nothing downstream treats it as unhandled", () => {
    const { manager } = draggingOver(true);
    expect(manager.handle(press("s", { ctrlKey: true }))).toBe(true);
  });

  it("still runs its own binding while blocking", () => {
    const { manager, cancelDrag } = draggingOver(true);
    manager.handle(press("Escape"));
    expect(cancelDrag).toHaveBeenCalledTimes(1);
  });

  it("neither matches nor blocks while disabled", () => {
    // A drag layer is mounted for the life of the canvas and enabled only mid-drag. If disabling
    // it stopped matching but kept blocking, the editor would be deaf whenever nothing was
    // being dragged — the opposite failure, and a much more visible one.
    const shell = vi.fn();
    const drag = vi.fn();
    const manager = managerFor();
    manager.register([binding("Escape", shell)], { name: "shell", depth: 0 });
    manager.register([binding("Escape", drag)], {
      name: "drag",
      depth: 1,
      blocking: true,
      enabled: false,
    });

    manager.handle(press("Escape"));
    expect(drag).not.toHaveBeenCalled();
    expect(shell).toHaveBeenCalledTimes(1);
  });
});

describe("typing", () => {
  function pressInto(
    manager: ReturnType<typeof createShortcutManager>,
    element: HTMLElement,
    key: string,
    init: KeyboardEventInit = {}
  ): KeyboardEvent {
    const detach = manager.attach(document);
    document.body.append(element);
    const event = press(key, init);
    element.dispatchEvent(event);
    element.remove();
    detach();
    return event;
  }

  it("does not fire a bare letter while the user is typing", () => {
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("n", run)], { name: "shell", depth: 0 });
    pressInto(manager, document.createElement("input"), "n");
    expect(run).not.toHaveBeenCalled();
  });

  it("still fires a modifier shortcut mid-sentence", () => {
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("mod+s", run)], { name: "shell", depth: 0 });
    pressInto(manager, document.createElement("input"), "s", { ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("still fires Escape mid-sentence", () => {
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("Escape", run)], { name: "shell", depth: 0 });
    pressInto(manager, document.createElement("input"), "Escape");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("treats a checkbox as somewhere a bare letter still works", () => {
    // A checkbox is an `input` element that captures no text, so excluding every input by tag
    // would silently disable single-key shortcuts wherever one happened to hold focus.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("n", run)], { name: "shell", depth: 0 });
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    pressInto(manager, checkbox, "n");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("treats a role=textbox widget as text, not as a div", () => {
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("n", run)], { name: "shell", depth: 0 });
    const widget = document.createElement("div");
    widget.setAttribute("role", "textbox");
    pressInto(manager, widget, "n");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("sequences", () => {
  it("fires only once the whole sequence is typed", () => {
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("g d", run)], { name: "shell", depth: 0 });

    manager.handle(press("g"));
    expect(run).not.toHaveBeenCalled();
    manager.handle(press("d"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("swallows the prefix key so it is not typed into the page", () => {
    const manager = managerFor();
    manager.register([binding("g d", vi.fn())], { name: "shell", depth: 0 });
    const event = press("g");
    manager.handle(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("forgets a sequence that goes quiet", () => {
    let clock = 0;
    const run = vi.fn();
    const manager = managerFor(false, () => clock);
    manager.register([binding("g d", run)], { name: "shell", depth: 0 });

    manager.handle(press("g"));
    clock = 5000;
    manager.handle(press("d"));
    expect(run).not.toHaveBeenCalled();
  });

  it("does not eat the key that breaks a sequence", () => {
    // `g` then `mod+k` should open the palette. Discarding the keystroke along with the
    // abandoned prefix would make shortcuts intermittently dead after a stray letter.
    const palette = vi.fn();
    const manager = managerFor();
    manager.register([binding("g d", vi.fn()), binding("mod+k", palette)], {
      name: "shell",
      depth: 0,
    });

    manager.handle(press("g"));
    manager.handle(press("k", { ctrlKey: true }));
    expect(palette).toHaveBeenCalledTimes(1);
  });

  it("does not let reaching for a modifier cancel a sequence in progress", () => {
    // Holding Shift emits its own keydown. Treating that as a keystroke would clear the pending
    // prefix, and any sequence ending in a capital letter would be impossible to type.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("g d", run)], { name: "shell", depth: 0 });

    manager.handle(press("g"));
    manager.handle(press("Shift", { shiftKey: true }));
    manager.handle(press("d"));
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("event handling", () => {
  it("prevents the browser default by default, and not when asked", () => {
    const manager = managerFor();
    manager.register(
      [
        binding("mod+s", vi.fn()),
        binding("mod+p", vi.fn(), { preventDefault: false }),
      ],
      { name: "shell", depth: 0 }
    );

    const saved = press("s", { ctrlKey: true });
    manager.handle(saved);
    expect(saved.defaultPrevented).toBe(true);

    const printed = press("p", { ctrlKey: true });
    manager.handle(printed);
    expect(printed.defaultPrevented).toBe(false);
  });

  it("fires once for a held key rather than on every repeat", () => {
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("Escape", run)], { name: "shell", depth: 0 });

    manager.handle(press("Escape"));
    manager.handle(press("Escape", { repeat: true }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stops listening once detached", () => {
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("Escape", run)], { name: "shell", depth: 0 });

    const detach = manager.attach(document);
    document.dispatchEvent(press("Escape"));
    expect(run).toHaveBeenCalledTimes(1);

    detach();
    document.dispatchEvent(press("Escape"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stops offering a disposed layer's bindings", () => {
    const run = vi.fn();
    const manager = managerFor();
    const registration = manager.register([binding("Escape", run)], {
      name: "shell",
      depth: 0,
    });
    registration.dispose();
    manager.handle(press("Escape"));
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps a layer's precedence when its bindings are replaced", () => {
    // Bindings close over render state and are rebuilt constantly. If replacing them
    // re-registered the layer, every render would push it above its equal-depth neighbours and
    // precedence would quietly follow render frequency.
    const shell = vi.fn();
    const updated = vi.fn();
    const manager = managerFor();
    const first = manager.register([binding("Escape", vi.fn())], {
      name: "first",
      depth: 1,
    });
    manager.register([binding("Escape", shell)], { name: "second", depth: 1 });

    first.update([binding("Escape", updated)], { name: "first", depth: 1 });
    manager.handle(press("Escape"));

    expect(shell).toHaveBeenCalledTimes(1);
    expect(updated).not.toHaveBeenCalled();
  });
});

describe("activeBindings", () => {
  it("lists what is bound, most precedent layer first, for a help panel", () => {
    const manager = managerFor();
    manager.register([binding("mod+s", vi.fn())], { name: "shell", depth: 0 });
    manager.register([binding("Escape", vi.fn())], {
      name: "dialog",
      depth: 1,
    });

    expect(manager.activeBindings().map(entry => entry.layer)).toEqual([
      "dialog",
      "shell",
    ]);
  });

  it("omits a disabled layer, which cannot act on anything", () => {
    const manager = managerFor();
    manager.register([binding("mod+s", vi.fn())], {
      name: "hidden",
      depth: 0,
      enabled: false,
    });
    expect(manager.activeBindings()).toHaveLength(0);
  });
});
