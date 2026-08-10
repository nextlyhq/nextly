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

import { resetDevWarnings } from "../dev-warn";
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

describe("keys the browser also acts on", () => {
  it("suppresses the browser default for a key a blocking layer swallows", () => {
    // A grab that stops the application but not the browser is only half a grab: mid-drag,
    // mod+s would still open the browser's own save dialog.
    const manager = managerFor();
    manager.register([binding("mod+s", vi.fn())], { name: "shell", depth: 0 });
    manager.register([binding("Escape", vi.fn())], {
      name: "drag",
      depth: 1,
      blocking: true,
    });
    const event = press("s", { ctrlKey: true });
    manager.handle(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("still lets a blocked keystroke type into a field", () => {
    // The one thing a blocking layer must not swallow. Suppressing a printable key aimed at an
    // input would make the field unusable for as long as the layer is up.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("n");
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps a held shortcut consumed without running it again", () => {
    // Returning early on a repeat skipped preventDefault as well, so holding mod+s ran the
    // application save once and then handed every following repeat to the browser.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("mod+s", run)], { name: "shell", depth: 0 });

    manager.handle(press("s", { ctrlKey: true }));
    const repeat = press("s", { ctrlKey: true, repeat: true });
    manager.handle(repeat);

    expect(run).toHaveBeenCalledTimes(1);
    expect(repeat.defaultPrevented).toBe(true);
  });
});

describe("keys that belong to the platform, not the application", () => {
  it("ignores keystrokes while an IME composition is active", () => {
    // Escape during composition means "abandon what I am composing". Acting on it would cancel
    // the composition and dismiss the dialog behind it, from one keypress the user aimed at
    // neither.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("Escape", run)], { name: "shell", depth: 0 });

    const composing = press("Escape");
    Object.defineProperty(composing, "isComposing", { value: true });
    manager.handle(composing);

    expect(run).not.toHaveBeenCalled();
    expect(composing.defaultPrevented).toBe(false);
  });

  it("leaves a native select's type-ahead alone", () => {
    // A select is not a text field, but bare letters jump between its options. A single-key
    // shortcut firing there would act AND suppress the control's own behaviour.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("n", run)], { name: "shell", depth: 0 });
    const select = document.createElement("select");
    document.body.append(select);
    const detach = manager.attach(document);
    select.dispatchEvent(press("n"));
    detach();
    select.remove();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("the space bar", () => {
  it("can be bound, under the name the grammar can carry", () => {
    // The browser reports `key: " "`, which a spec split on whitespace cannot express: `" "`
    // trims away to nothing. Without the alias the space bar is unbindable, ruling out canvas
    // panning and play/pause.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("Space", run)], { name: "canvas", depth: 0 });
    manager.handle(press(" "));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("distinguishes Shift+Space from Space", () => {
    // Shift does not change the character space produces, so unlike `?` the two are genuinely
    // different keystrokes and one binding must not answer for both.
    const plain = vi.fn();
    const manager = managerFor();
    manager.register([binding("Space", plain)], { name: "canvas", depth: 0 });
    manager.handle(press(" ", { shiftKey: true }));
    expect(plain).not.toHaveBeenCalled();
  });
});

describe("sequences that end somewhere else", () => {
  it("lets a blocking layer act on the key that broke its own sequence", () => {
    // Under a blocking layer the retry never ran, because an unmatched multi-key candidate came
    // back "blocked" rather than "none". Pressing `g` then Escape cleared the prefix and did
    // nothing, so the layer's own Escape needed a SECOND press.
    const cancel = vi.fn();
    const manager = managerFor();
    manager.register([binding("g d", vi.fn()), binding("Escape", cancel)], {
      name: "drag",
      depth: 1,
      blocking: true,
    });

    manager.handle(press("g"));
    manager.handle(press("Escape"));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("allows a modifier-led sequence to complete while typing", () => {
    // The typing rule read the LAST chord, so `mod+k c` was rejected in a field on account of
    // its bare final letter — even though `mod+k` had already made it a command.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("mod+k c", run)], { name: "shell", depth: 0 });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    field.dispatchEvent(press("k", { ctrlKey: true }));
    field.dispatchEvent(press("c"));
    detach();
    field.remove();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("still refuses an unmodified sequence while typing", () => {
    // The positive control for the rule above: `g d` must stay inert mid-word, or typing "good"
    // would trigger it. Basing the decision on the first chord has to keep this case out.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("g d", run)], { name: "shell", depth: 0 });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    field.dispatchEvent(press("g"));
    field.dispatchEvent(press("d"));
    detach();
    field.remove();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("keys another owner already claimed", () => {
  it("stands down when a lower-level owner has already handled the key", () => {
    // Radix's DismissableLayer — which every Dialog and Sheet in this kit is built on — listens
    // on document in the CAPTURE phase, calls preventDefault() to dismiss, and does NOT stop
    // propagation. Without this, one Escape closes the modal and runs the shell's Escape
    // binding underneath it: the double action this module exists to remove, arriving through
    // our own components.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("Escape", run)], { name: "shell", depth: 0 });

    const detach = manager.attach(document);
    // Stands in for Radix: capture phase on document, preventDefault, no stopPropagation.
    const dismiss = (e: Event): void => {
      e.preventDefault();
    };
    document.addEventListener("keydown", dismiss, { capture: true });
    document.body.dispatchEvent(press("Escape"));
    document.removeEventListener("keydown", dismiss, { capture: true });
    detach();

    expect(run).not.toHaveBeenCalled();
  });

  it("still acts on a key nobody claimed", () => {
    // The positive control: the guard above must key off defaultPrevented, not silence the
    // manager whenever a capture listener happens to exist.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("Escape", run)], { name: "shell", depth: 0 });
    const detach = manager.attach(document);
    document.body.dispatchEvent(press("Escape"));
    detach();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stops a consumed key reaching a window-level listener", () => {
    // preventDefault suppresses the browser, not other JavaScript. During a staged migration
    // some owners still listen on window, and both halves of the double action would run.
    const run = vi.fn();
    const onWindow = vi.fn();
    const manager = managerFor();
    manager.register([binding("mod+k", run)], { name: "shell", depth: 0 });
    const detach = manager.attach(document);
    window.addEventListener("keydown", onWindow);
    document.body.dispatchEvent(press("k", { ctrlKey: true }));
    window.removeEventListener("keydown", onWindow);
    detach();

    expect(run).toHaveBeenCalledTimes(1);
    expect(onWindow).not.toHaveBeenCalled();
  });
});

describe("what a blocking layer may suppress while typing", () => {
  it("suppresses a browser key that carries no text", () => {
    // "Unmodified" is not the same question as "is text": F1 opens browser help and inserts
    // nothing, so a grab reporting it as consumed while the browser acted would be a lie.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "drag",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("F1");
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves the caret keys to the field", () => {
    // The positive control for the rule above: navigation and editing keys belong to the field,
    // and suppressing them would break the input as surely as swallowing its letters.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "drag",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("ArrowLeft");
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("type-ahead widgets that are not text fields", () => {
  it("leaves an ARIA combobox's type-ahead alone", () => {
    // This kit's own Select wraps a Radix trigger that renders role="combobox" and jumps between
    // options on bare letters without stopping propagation, so the case is reachable from our
    // own components rather than only from a consumer's custom widget.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("n", run)], { name: "shell", depth: 0 });
    const trigger = document.createElement("button");
    trigger.setAttribute("role", "combobox");
    document.body.append(trigger);
    const detach = manager.attach(document);
    trigger.dispatchEvent(press("n"));
    detach();
    trigger.remove();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("a binding that shares another's prefix", () => {
  it("fires the exact binding whichever order they were registered in", () => {
    // Registering `g d` before `g` returned "pending" before the exact `g` was ever examined, so
    // which binding existed came down to the order of an array.
    const single = vi.fn();
    const manager = managerFor();
    manager.register([binding("g d", vi.fn()), binding("g", single)], {
      name: "shell",
      depth: 0,
    });
    manager.handle(press("g"));
    expect(single).toHaveBeenCalledTimes(1);
  });

  it("tells the developer the longer binding is unreachable", () => {
    // Determinism alone would hide the problem: one of the two can never fire, and the only
    // useful response is to say so rather than pick a winner silently.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDevWarnings();
    const manager = managerFor();
    manager.register([binding("g", vi.fn()), binding("g d", vi.fn())], {
      name: "shell",
      depth: 0,
    });
    const said = warn.mock.calls.map(c => String(c[0])).join(" ");
    warn.mockRestore();
    expect(said).toContain("prefix");
    expect(manager).toBeDefined();
  });
});

describe("the plus key", () => {
  it("can be bound with a modifier, as zoom-in is written everywhere", () => {
    // `mod++` split on `+` left a chord with modifiers and no key at all, and `mod+shift+=` is
    // not a substitute because the browser reports that keystroke as `key: "+"`.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("mod++", run)], { name: "canvas", depth: 0 });
    manager.handle(press("+", { ctrlKey: true }));
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("standing down without leaving a mess", () => {
  it("stops a key another owner claimed reaching a window listener", () => {
    // Standing down is not the same as stepping aside. If a dialog dismissed on Escape and the
    // manager merely returned, a window-level owner still ran — one Escape closing the overlay
    // and cancelling an in-flight request. The manager is the only place that can prevent that,
    // and the first owner not being us does not make it less of a double action.
    const onWindow = vi.fn();
    const manager = managerFor();
    const detach = manager.attach(document);
    const dismiss = (e: Event): void => {
      e.preventDefault();
    };
    document.addEventListener("keydown", dismiss, { capture: true });
    window.addEventListener("keydown", onWindow);
    document.body.dispatchEvent(press("Escape"));
    window.removeEventListener("keydown", onWindow);
    document.removeEventListener("keydown", dismiss, { capture: true });
    detach();

    expect(onWindow).not.toHaveBeenCalled();
  });

  it("abandons a half-typed sequence when another owner takes a key", () => {
    // After `g`, an Escape that closed a dialog is a real keystroke. Leaving the prefix pending
    // let a later `d` complete `g d` straight across the interruption.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("g d", run)], { name: "shell", depth: 0 });
    const detach = manager.attach(document);

    document.body.dispatchEvent(press("g"));
    const claimed = press("Escape");
    claimed.preventDefault();
    document.body.dispatchEvent(claimed);
    document.body.dispatchEvent(press("d"));
    detach();

    expect(run).not.toHaveBeenCalled();
  });
});

describe("diagnostics on the path people actually use", () => {
  it("reports a prefix conflict introduced through update()", () => {
    // The React hook registers empty and supplies its real bindings through update, so a check
    // that only ran at register would never see a single binding anyone wrote.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDevWarnings();
    const manager = managerFor();
    const reg = manager.register([], { name: "shell", depth: 0 });
    reg.update([binding("g", vi.fn()), binding("g d", vi.fn())], {
      name: "shell",
      depth: 0,
    });
    const said = warn.mock.calls.map(c => String(c[0])).join(" ");
    warn.mockRestore();
    expect(said).toContain("prefix");
  });
});

describe("keys the focused control owns", () => {
  it("lets a focused checkbox have Space", () => {
    // A checkbox is not a typing target, so bare letters should still fire over it — but Space
    // is how it toggles. A global Space binding silently breaking every checkbox is worse than
    // the shortcut not firing.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("Space", run)], { name: "canvas", depth: 0 });
    const box = document.createElement("input");
    box.type = "checkbox";
    document.body.append(box);
    const detach = manager.attach(document);
    box.dispatchEvent(press(" "));
    detach();
    box.remove();
    expect(run).not.toHaveBeenCalled();
  });

  it("still fires a bare letter over that same checkbox", () => {
    // The positive control: the guard must be about the keys the control owns, not a blanket
    // exemption that would undo the reason checkboxes are not typing targets.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("n", run)], { name: "shell", depth: 0 });
    const box = document.createElement("input");
    box.type = "checkbox";
    document.body.append(box);
    const detach = manager.attach(document);
    box.dispatchEvent(press("n"));
    detach();
    box.remove();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("leaves a menu's type-ahead alone", () => {
    // Radix menus move focus on unmodified letters without preventing default or stopping
    // propagation, and this kit's DropdownMenu and ContextMenu wrap them.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("n", run)], { name: "shell", depth: 0 });
    const item = document.createElement("div");
    item.setAttribute("role", "menuitem");
    document.body.append(item);
    const detach = manager.attach(document);
    item.dispatchEvent(press("n"));
    detach();
    item.remove();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("layouts that are not US English", () => {
  it("lets an AltGraph character be typed under a blocking layer", () => {
    // On many layouts `@` and `€` arrive with ctrlKey AND altKey set. That is text entry, not a
    // chord, and it is not composition either — isComposing never covers it.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("@", { ctrlKey: true, altKey: true });
    Object.defineProperty(event, "getModifierState", {
      value: (k: string) => k === "AltGraph",
    });
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(false);
  });

  it("distinguishes shift for a non-ASCII letter", () => {
    // An ASCII-only test classes every non-Latin letter as punctuation and skips the shift
    // comparison, so a binding for a Cyrillic letter also answered for its capital.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("\u0436", run)], { name: "shell", depth: 0 });
    manager.handle(press("\u0416", { shiftKey: true }));
    expect(run).not.toHaveBeenCalled();
  });
});

describe("a press stays consumed for as long as it is held", () => {
  it("keeps consuming a held shortcut whose action disabled its own condition", () => {
    // `mod+s` saves and clears the dirty flag, so by the second keydown the binding is no longer
    // eligible. Re-offering alone reported the repeat as unhandled and the browser took it —
    // opening Save Page while the user was still holding the key they used to save.
    let dirty = true;
    const manager = managerFor();
    manager.register(
      [
        {
          keys: "mod+s",
          description: "Save",
          run: () => {
            dirty = false;
          },
          when: () => dirty,
        },
      ],
      { name: "form", depth: 0 }
    );

    manager.handle(press("s", { ctrlKey: true }));
    expect(dirty).toBe(false);

    const repeat = press("s", { ctrlKey: true, repeat: true });
    manager.handle(repeat);
    expect(repeat.defaultPrevented).toBe(true);
  });

  it("does not consume a repeat of a key nothing ever claimed", () => {
    // The positive control: remembering the press must not turn into consuming every repeat,
    // which would suppress browser defaults for keys the application never bound.
    const manager = managerFor();
    manager.register([binding("mod+s", vi.fn())], { name: "form", depth: 0 });
    manager.handle(press("j"));
    const repeat = press("j", { repeat: true });
    manager.handle(repeat);
    expect(repeat.defaultPrevented).toBe(false);
  });
});

describe("more keystrokes that interrupt a sequence", () => {
  it("abandons a sequence when a focused control takes the next key", () => {
    // The user pressed Space and watched a checkbox toggle. A later `d` must not complete a
    // `g d` begun before that.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("g d", run)], { name: "shell", depth: 0 });
    const box = document.createElement("input");
    box.type = "checkbox";
    document.body.append(box);
    const detach = manager.attach(document);

    document.body.dispatchEvent(press("g"));
    box.dispatchEvent(press(" "));
    document.body.dispatchEvent(press("d"));
    detach();
    box.remove();

    expect(run).not.toHaveBeenCalled();
  });
});

describe("layouts that build characters from more than one keystroke", () => {
  it("lets a dead key begin an accented character under a blocking layer", () => {
    // The accent keydown reports `key: "Dead"` and arrives BEFORE composition starts, so
    // isComposing never covers it. Suppressing it stops accented input being begun at all.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("Dead");
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(false);
  });
});
