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

describe("a repeat inherits the policy of the press it belongs to", () => {
  it("keeps letting a permitted key repeat under a blocking layer", () => {
    // Consumed is not the same as suppressed. A blocking layer deliberately lets text through,
    // so unconditionally preventing repeats made a held Backspace delete one character and stop.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);

    field.dispatchEvent(press("Backspace"));
    const repeat = press("Backspace", { repeat: true });
    field.dispatchEvent(repeat);
    detach();
    field.remove();

    expect(repeat.defaultPrevented).toBe(false);
  });

  it("keeps suppressing the repeats of a press that WAS suppressed", () => {
    // The positive control: inheriting the policy must not become "never suppress".
    const manager = managerFor();
    manager.register([binding("mod+s", vi.fn())], { name: "shell", depth: 0 });
    manager.handle(press("s", { ctrlKey: true }));
    const repeat = press("s", { ctrlKey: true, repeat: true });
    manager.handle(repeat);
    expect(repeat.defaultPrevented).toBe(true);
  });
});

describe("keys that act without inserting anything", () => {
  it("suppresses Enter in a single-line input under a blocking layer", () => {
    // Enter inserts no text there; it submits the form. Letting it through means application
    // behaviour running underneath the advertised grab.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "drag",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("Enter");
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves Enter alone in a textarea, where it makes a newline", () => {
    // The control: Enter IS field input where it inserts one, and suppressing it there would
    // stop the user typing a paragraph.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "drag",
      depth: 1,
      blocking: true,
    });
    const area = document.createElement("textarea");
    document.body.append(area);
    const detach = manager.attach(document);
    const event = press("Enter");
    area.dispatchEvent(event);
    detach();
    area.remove();
    expect(event.defaultPrevented).toBe(false);
  });

  it("lets a focused reset button keep Space", () => {
    // Reset is button-like and is already classified as a non-text input, so a global Space
    // binding was firing instead of activating it.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("Space", run)], { name: "shell", depth: 0 });
    const reset = document.createElement("input");
    reset.type = "reset";
    document.body.append(reset);
    const detach = manager.attach(document);
    reset.dispatchEvent(press(" "));
    detach();
    reset.remove();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("targets from another realm", () => {
  it("recognises a control belonging to a different document", () => {
    // `instanceof HTMLElement` is per-realm, and the manager documents a custom target. Checking
    // against the outer window's constructor rejected every control in an iframe or pop-out —
    // the exact case the option exists to serve — so bare shortcuts fired while typing there.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("n", run)], { name: "shell", depth: 0 });

    const frame = document.createElement("iframe");
    document.body.append(frame);
    const inner = frame.contentDocument;
    if (!inner) throw new Error("iframe document unavailable");
    const field = inner.createElement("input");
    inner.body.append(field);

    const detach = manager.attach(inner);
    field.dispatchEvent(
      new (inner.defaultView ?? window).KeyboardEvent("keydown", {
        key: "n",
        bubbles: true,
      })
    );
    detach();
    frame.remove();

    expect(run).not.toHaveBeenCalled();
  });
});

describe("composition interrupting a sequence", () => {
  it("abandons a pending sequence when composition happens in between", () => {
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("mod+k c", run)], { name: "shell", depth: 0 });

    manager.handle(press("k", { ctrlKey: true }));
    const composing = press("x");
    Object.defineProperty(composing, "isComposing", { value: true });
    manager.handle(composing);
    manager.handle(press("c"));

    expect(run).not.toHaveBeenCalled();
  });
});

describe("keystrokes claimed while an IME is composing", () => {
  it("still stops a claimed key reaching a window listener during composition", () => {
    // Two guards overlapped: the composition check ran first and returned "not consumed", so a
    // claimed-AND-composing Escape never reached the branch that stops propagation. Radix
    // prevents Escape in its capture listener whether or not composition is active.
    const onWindow = vi.fn();
    const manager = managerFor();
    const detach = manager.attach(document);
    const dismiss = (e: Event): void => {
      e.preventDefault();
    };
    document.addEventListener("keydown", dismiss, { capture: true });
    window.addEventListener("keydown", onWindow);
    const event = press("Escape");
    Object.defineProperty(event, "isComposing", { value: true });
    document.body.dispatchEvent(event);
    window.removeEventListener("keydown", onWindow);
    document.removeEventListener("keydown", dismiss, { capture: true });
    detach();

    expect(onWindow).not.toHaveBeenCalled();
  });
});

describe("a grab that actually holds the keyboard", () => {
  it("leaves Tab to the focus trap that owns the modal", () => {
    // This reverses an earlier decision here, which suppressed Tab on the reasoning that a grab
    // letting focus leave is not a grab. That was wrong for the case blocking exists to serve: a
    // focus trap only cancels the WRAP at the first and last tabbable element and relies on the
    // browser default for every move in between, so suppressing every Tab pinned focus to a
    // single control inside the modal. A layer that genuinely wants Tab binds it.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("Tab");
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(false);
  });

  it("still lets the caret keys through", () => {
    // The control: narrowing what a blocking layer permits must not take the editing keys with
    // it, or the field under the modal stops working.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
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

describe("a focused range input", () => {
  it("keeps the keys that move its value", () => {
    // A range is a slider: arrows, Home/End and PageUp/PageDown are how its value changes, so a
    // global arrow binding was firing instead of adjusting it.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("ArrowLeft", run)], { name: "shell", depth: 0 });
    const slider = document.createElement("input");
    slider.type = "range";
    document.body.append(slider);
    const detach = manager.attach(document);
    slider.dispatchEvent(press("ArrowLeft"));
    detach();
    slider.remove();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("a binding whose callback throws", () => {
  it("leaves no sequence prefix behind", () => {
    // An uncaught handler exception does not stop the page, so a stale prefix outlived the
    // keystroke that failed and a later key could complete a DIFFERENT command in a lower layer.
    const lower = vi.fn();
    const manager = managerFor();
    manager.register([binding("x y", lower)], { name: "shell", depth: 0 });
    manager.register(
      [
        {
          keys: "x",
          description: "Throws",
          run: () => {
            throw new Error("handler failed");
          },
        },
      ],
      { name: "panel", depth: 1 }
    );

    expect(() => manager.handle(press("x"))).toThrow("handler failed");
    manager.handle(press("y"));
    expect(lower).not.toHaveBeenCalled();
  });
});

describe("text that arrives with a modifier held", () => {
  it("lets macOS Option-produced text through a blocking layer", () => {
    // Option is a TEXT modifier on macOS: Option+5 types a character outright. The key reported
    // is the character itself, never the base letter, so rejecting anything with altKey set
    // stopped those characters being typed under a grab.
    const manager = managerFor(true);
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("\u221e", { altKey: true });
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(false);
  });

  it("still treats mod+s as a chord rather than text", () => {
    // The control: Ctrl and Meta DO make a chord, and a blocking layer must keep suppressing it
    // or the browser's own save dialog opens mid-drag.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("s", { ctrlKey: true });
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(true);
  });

  it("recognises a character written as two UTF-16 units", () => {
    // An astral character is ONE letter and two code units, so a length check on the string
    // rejected it and the grab stopped emoji and several scripts being typed at all.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("\u{1D400}");
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("keys that only belong to a multiline target", () => {
  it("suppresses PageDown in a single-line input under a grab", () => {
    // It edits nothing there and scrolls the document behind the modal instead.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("PageDown");
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves PageDown alone in a textarea, where it scrolls the text", () => {
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const area = document.createElement("textarea");
    document.body.append(area);
    const detach = manager.attach(document);
    const event = press("PageDown");
    area.dispatchEvent(event);
    detach();
    area.remove();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("focus that a listener on document cannot see directly", () => {
  it("recognises an input inside an open shadow root", () => {
    // The event is RETARGETED to the shadow host, so reading `target` alone reports a custom
    // element and a bare shortcut fired over a field the user was typing in.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("n", run)], { name: "shell", depth: 0 });
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    const field = document.createElement("input");
    root.append(field);

    const detach = manager.attach(document);
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", bubbles: true, composed: true })
    );
    detach();
    host.remove();

    expect(run).not.toHaveBeenCalled();
  });
});

describe("a link with focus", () => {
  it("keeps Enter, which is how a link is followed", () => {
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("Enter", run)], { name: "shell", depth: 0 });
    const link = document.createElement("a");
    link.href = "#somewhere";
    document.body.append(link);
    const detach = manager.attach(document);
    link.dispatchEvent(press("Enter"));
    detach();
    link.remove();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("an outcome that is still tentative", () => {
  it("does not cancel a key the retry hands to an allowed-default binding", () => {
    // The first offer reached the blocking fallback with a multi-key candidate and cancelled the
    // event; the retry then fired an exact binding that had asked NOT to preventDefault, and
    // could not uncancel what the fallback had already done.
    const cancel = vi.fn();
    const manager = managerFor();
    manager.register(
      [
        binding("g d", vi.fn()),
        {
          keys: "Escape",
          description: "Cancel",
          run: cancel,
          preventDefault: false,
        },
      ],
      { name: "drag", depth: 1, blocking: true }
    );

    manager.handle(press("g"));
    const escape = press("Escape");
    manager.handle(escape);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(escape.defaultPrevented).toBe(false);
  });
});

describe("Alt means different things on different platforms", () => {
  it("suppresses an Alt accelerator under a grab on a non-Apple platform", () => {
    // Alt+F opens a menu on Windows and Linux; it types nothing. Letting it through because it
    // LOOKS like a single character would hand the browser a key the grab claimed to own.
    const manager = managerFor(false);
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("f", { altKey: true });
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps AltGraph portable across platforms", () => {
    // AltGraph is text entry everywhere it exists, so it must not be gated on the platform the
    // way plain Alt is.
    const manager = managerFor(false);
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
});

describe("a key already repeating when the grab appears", () => {
  it("suppresses it, having never seen its first press", () => {
    // A drag can begin while an arrow key is already held, so the manager's first sight of that
    // key is a repeat with no earlier press to inherit a policy from. Left alone, the browser
    // carries on scrolling underneath the grab.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "drag",
      depth: 1,
      blocking: true,
    });
    const repeat = press("ArrowDown", { repeat: true });
    manager.handle(repeat);
    expect(repeat.defaultPrevented).toBe(true);
  });
});

describe("a sequence belongs to the layer that opened it", () => {
  it("does not let a lower layer complete a prefix it never received", () => {
    // The top layer claimed `g`. Disabling it before the next keystroke handed `d` to a lower
    // layer's `g d`, which had never seen the `g` at all.
    const lower = vi.fn();
    const manager = managerFor();
    manager.register([binding("g d", lower)], { name: "shell", depth: 0 });
    const top = manager.register([binding("g x", vi.fn())], {
      name: "panel",
      depth: 1,
    });

    manager.handle(press("g"));
    top.dispose();
    manager.handle(press("d"));

    expect(lower).not.toHaveBeenCalled();
  });

  it("does not let a layer mounted mid-sequence inherit the prefix", () => {
    // The prefix was typed before this layer existed, so it cannot be the one that promised it.
    const late = vi.fn();
    const manager = managerFor();
    const top = manager.register([binding("g x", vi.fn())], {
      name: "panel",
      depth: 1,
    });
    void top;

    manager.handle(press("g"));
    manager.register([binding("g d", late)], { name: "late", depth: 2 });
    manager.handle(press("d"));

    expect(late).not.toHaveBeenCalled();
  });
});

describe("a focused colour input", () => {
  it("keeps the keys that open its picker", () => {
    // Space and Enter both open the native colour picker, and this product puts focusable colour
    // inputs on screen in the page builder's colour and gradient controls.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("Space", run)], { name: "shell", depth: 0 });
    const swatch = document.createElement("input");
    swatch.type = "color";
    document.body.append(swatch);
    const detach = manager.attach(document);
    swatch.dispatchEvent(press(" "));
    detach();
    swatch.remove();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("a layer whose bindings are replaced mid-sequence", () => {
  it("cannot complete a prefix its previous bindings claimed", () => {
    // Distinct from disposal: the layer still EXISTS and still outranks everything, so the
    // ownership check alone would let its new bindings answer for a promise the old ones made.
    const replaced = vi.fn();
    const manager = managerFor();
    const layer = manager.register([binding("g x", vi.fn())], {
      name: "panel",
      depth: 1,
    });

    manager.handle(press("g"));
    layer.update([binding("g d", replaced)], { name: "panel", depth: 1 });
    manager.handle(press("d"));

    expect(replaced).not.toHaveBeenCalled();
  });
});

describe("a layer that arrives mid-sequence", () => {
  it("still blocks, even though it cannot complete the sequence", () => {
    // Sequence ownership is a rule about MATCHING. Applying it to the whole layer let a modal
    // that mounted between `g` and `d` be stepped over entirely, so a shell command ran straight
    // through the keyboard grab the modal had just taken.
    const shell = vi.fn();
    const manager = managerFor();
    manager.register([binding("g d", shell)], { name: "shell", depth: 0 });

    manager.handle(press("g"));
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    manager.handle(press("d"));

    expect(shell).not.toHaveBeenCalled();
  });
});

describe("a re-render that changed nothing", () => {
  it("keeps a sequence in progress across an unchanged update", () => {
    // `useShortcuts` calls update() after EVERY render, so cancelling on every update made `g d`
    // fail whenever a timer or a context change landed between the two keystrokes.
    const run = vi.fn();
    const manager = managerFor();
    const layer = manager.register([binding("g d", run)], {
      name: "shell",
      depth: 0,
    });

    manager.handle(press("g"));
    // Same keys, same options; only the callback identity differs, as it would each render.
    layer.update([binding("g d", run)], { name: "shell", depth: 0 });
    manager.handle(press("d"));

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("still cancels when the update changes what the layer matches", () => {
    // The control: an update that genuinely replaces the bindings must still invalidate the
    // promise the old ones made.
    const replaced = vi.fn();
    const manager = managerFor();
    const layer = manager.register([binding("g x", vi.fn())], {
      name: "shell",
      depth: 0,
    });

    manager.handle(press("g"));
    layer.update([binding("g d", replaced)], { name: "shell", depth: 0 });
    manager.handle(press("d"));

    expect(replaced).not.toHaveBeenCalled();
  });
});

describe("editing a field that sits under a grab", () => {
  it.each([
    ["c", "copy"],
    ["v", "paste"],
    ["a", "select all"],
    ["z", "undo"],
  ])("leaves mod+%s to the field (%s)", key => {
    // A modal that grabbed the keyboard would otherwise make clipboard and undo impossible
    // inside its own inputs, which is a far worse outcome than an unbound accelerator reaching
    // the browser.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press(key, { ctrlKey: true });
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves word-wise caret movement to the field", () => {
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("ArrowLeft", { ctrlKey: true });
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(false);
  });

  it("still suppresses an accelerator the field does not own", () => {
    // The control: mod+s is the browser's save dialog, not a field editing command, so the grab
    // must keep suppressing it.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("s", { ctrlKey: true });
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("prefix conflicts across a platform alias", () => {
  it("reports mod+k against ctrl+k d on a non-Apple platform", () => {
    // They are the same physical chord there, so one of the two bindings is unreachable — but a
    // comparison of the raw flags calls them different and stays silent.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDevWarnings();
    const manager = managerFor(false);
    manager.register(
      [binding("mod+k", vi.fn()), binding("ctrl+k d", vi.fn())],
      {
        name: "shell",
        depth: 0,
      }
    );
    const said = warn.mock.calls.map(c => String(c[0])).join(" ");
    warn.mockRestore();
    expect(said).toContain("prefix");
    expect(manager).toBeDefined();
  });
});

describe("a focused summary", () => {
  it("keeps the keys that toggle its details", () => {
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("Enter", run)], { name: "shell", depth: 0 });
    const summary = document.createElement("summary");
    document.body.append(summary);
    const detach = manager.attach(document);
    summary.dispatchEvent(press("Enter"));
    detach();
    summary.remove();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("controls that open something on activation", () => {
  it("leaves a file input its chooser keys", () => {
    // Reachable without anyone writing a raw element: the public `Input` accepts every native
    // type, so a global Space binding would stop file selection anywhere one is rendered.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("Space", run)], { name: "shell", depth: 0 });
    const chooser = document.createElement("input");
    chooser.type = "file";
    document.body.append(chooser);
    const detach = manager.attach(document);
    chooser.dispatchEvent(press(" "));
    detach();
    chooser.remove();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("an option inside an open listbox", () => {
  it("keeps its type-ahead", () => {
    // Radix focuses the OPTION, and that is what the event reports — the listbox is only an
    // ancestor, so a check that reads the target's own role alone never sees it.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("n", run)], { name: "shell", depth: 0 });
    const list = document.createElement("div");
    list.setAttribute("role", "listbox");
    const option = document.createElement("div");
    option.setAttribute("role", "option");
    list.append(option);
    document.body.append(list);
    const detach = manager.attach(document);
    option.dispatchEvent(press("n"));
    detach();
    list.remove();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("a handler that throws", () => {
  it("still stops the key reaching a window listener", () => {
    // Dispatch continues to later listeners after an exception is reported. Leaving the event
    // unstopped hands the same keystroke to a window-level owner — running a fallback as though
    // nothing had happened, at the exact moment something did.
    const onWindow = vi.fn();
    const manager = managerFor();
    manager.register(
      [
        {
          keys: "mod+k",
          description: "Throws",
          run: () => {
            throw new Error("handler failed");
          },
        },
      ],
      { name: "shell", depth: 0 }
    );

    const detach = manager.attach(document);
    window.addEventListener("keydown", onWindow);
    // The throw is the point of the test, and jsdom reports a listener exception as an `error`
    // event rather than propagating it out of `dispatchEvent`. Claiming it here keeps a
    // deliberate failure from being reported as an unhandled one.
    const swallow = (e: Event): void => {
      e.preventDefault();
    };
    window.addEventListener("error", swallow);
    document.body.dispatchEvent(press("k", { ctrlKey: true }));
    window.removeEventListener("error", swallow);
    window.removeEventListener("keydown", onWindow);
    detach();

    expect(onWindow).not.toHaveBeenCalled();
  });

  it("still lets the error surface to the caller", () => {
    // The control: stopping propagation must not swallow the failure, or a broken handler
    // becomes invisible.
    const manager = managerFor();
    manager.register(
      [
        {
          keys: "mod+k",
          description: "Throws",
          run: () => {
            throw new Error("handler failed");
          },
        },
      ],
      { name: "shell", depth: 0 }
    );
    expect(() => manager.handle(press("k", { ctrlKey: true }))).toThrow(
      "handler failed"
    );
  });
});

describe("an image submit input", () => {
  it("keeps its activation keys", () => {
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("Space", run)], { name: "shell", depth: 0 });
    const image = document.createElement("input");
    image.type = "image";
    document.body.append(image);
    const detach = manager.attach(document);
    image.dispatchEvent(press(" "));
    detach();
    image.remove();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("redo, which is spelled differently per platform", () => {
  it("suppresses Command+Y on Apple, where it opens browser history", () => {
    // Redo on macOS is Command+Shift+Z. Command+Y is a browser accelerator, so treating `y` as
    // an editing key everywhere let it escape the grab on the one platform where it is not
    // editing at all.
    const manager = managerFor(true);
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("y", { metaKey: true });
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves Ctrl+Y to the field on Windows, where it IS redo", () => {
    const manager = managerFor(false);
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("y", { ctrlKey: true });
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("a different key repeating during a sequence", () => {
  it("abandons the sequence it interrupted", () => {
    // While `x` is held, pressing `g`, receiving another `x` repeat, then pressing `d` completed
    // `g d` as though nothing had come between them.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("g d", run)], { name: "shell", depth: 0 });

    manager.handle(press("g"));
    manager.handle(press("x", { repeat: true }));
    manager.handle(press("d"));

    expect(run).not.toHaveBeenCalled();
  });

  it("survives a repeat of its own opening key", () => {
    // The control: holding `g` a moment too long must not cancel the sequence it just began.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("g d", run)], { name: "shell", depth: 0 });

    manager.handle(press("g"));
    manager.handle(press("g", { repeat: true }));
    manager.handle(press("d"));

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("keys whose owner depends on the control", () => {
  it("leaves PageDown to a focused native select under a grab", () => {
    // A select pages through its option list with these keys. The earlier rule asked only
    // whether the target held multiple LINES, which is the wrong question for a control that
    // pages through options instead.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const select = document.createElement("select");
    document.body.append(select);
    const detach = manager.attach(document);
    const event = press("PageDown");
    select.dispatchEvent(event);
    detach();
    select.remove();
    expect(event.defaultPrevented).toBe(false);
  });

  it("still suppresses Enter on that same select", () => {
    // The control, and the reason one answer for all three keys would be wrong: Enter submits
    // the form rather than editing anything, whatever the target is.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const select = document.createElement("select");
    document.body.append(select);
    const detach = manager.attach(document);
    const event = press("Enter");
    select.dispatchEvent(event);
    detach();
    select.remove();
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("the older spelling of copy and paste", () => {
  it.each([
    ["Ctrl+Insert", { ctrlKey: true }],
    ["Shift+Insert", { shiftKey: true }],
  ])("leaves %s to the field under a grab", (_name, mods) => {
    // The same two commands the letters cover, in the spelling Windows and Linux have always
    // had. Suppressing them makes clipboard work unavailable for anyone who uses them.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("Insert", mods);
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("detaching a target", () => {
  it("does not let one document's prefix be completed on another", () => {
    // A provider swapping targets reuses the manager, so a `g` from the old document could be
    // completed by a `d` on the new one, which never saw the prefix.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("g d", run)], { name: "shell", depth: 0 });

    const first = manager.attach(document);
    document.body.dispatchEvent(press("g"));
    first();

    const second = manager.attach(document);
    document.body.dispatchEvent(press("d"));
    second();

    expect(run).not.toHaveBeenCalled();
  });
});

describe("a prefix conflict that eligibility can separate", () => {
  it("stays quiet when the shorter binding is conditional", () => {
    // An inactive conditional `g` is skipped at press time and `g d` does become pending, so
    // telling the developer the longer binding can never fire would simply be false.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDevWarnings();
    const manager = managerFor();
    manager.register(
      [
        {
          keys: "g",
          description: "Sometimes",
          run: vi.fn(),
          when: () => false,
        },
        binding("g d", vi.fn()),
      ],
      { name: "shell", depth: 0 }
    );
    const said = warn.mock.calls.map(c => String(c[0])).join(" ");
    warn.mockRestore();
    expect(said).not.toContain("prefix");
    expect(manager).toBeDefined();
  });

  it("still warns when neither binding is conditional", () => {
    // The positive control: quietening the false case must not quieten the true one.
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

describe("modified variants of an editing letter", () => {
  it("suppresses a browser accelerator that merely looks like one", () => {
    // Ctrl+Shift+A is the browser's tab search. Lowercasing the key made it read as select-all,
    // so it passed as field editing and escaped the grab entirely.
    const manager = managerFor(false);
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("A", { ctrlKey: true, shiftKey: true });
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(true);
  });

  it("still leaves shift+z redo to the field", () => {
    // The one editing command genuinely spelled with shift, so a blanket rejection of modified
    // variants would take redo away from every field inside a modal.
    const manager = managerFor(true);
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("Z", { metaKey: true, shiftKey: true });
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("a select's own popup keys", () => {
  it("leaves Alt+ArrowDown to a focused native select", () => {
    // Alt with the vertical arrows opens and closes the option popup, so writing every plain-Alt
    // named key off as an accelerator took a standard interaction away inside a modal.
    const manager = managerFor(false);
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const select = document.createElement("select");
    document.body.append(select);
    const detach = manager.attach(document);
    const event = press("ArrowDown", { altKey: true });
    select.dispatchEvent(event);
    detach();
    select.remove();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("a held key whose modifiers change", () => {
  it("stays consumed when shift is added mid-hold", () => {
    // Repeats carry the CURRENT modifiers, and the key itself changes case, so a signature built
    // from them stopped matching mid-hold: after mod+s was handled, adding shift let the next
    // repeat fall through to the browser's Save As.
    const run = vi.fn();
    const manager = managerFor(false);
    manager.register([binding("mod+s", run)], { name: "shell", depth: 0 });

    manager.handle(press("s", { ctrlKey: true, code: "KeyS" }));
    const later = press("S", {
      ctrlKey: true,
      shiftKey: true,
      repeat: true,
      code: "KeyS",
    });
    manager.handle(later);

    expect(run).toHaveBeenCalledTimes(1);
    expect(later.defaultPrevented).toBe(true);
  });
});

describe("a letter outside the basic plane", () => {
  it("matches case-insensitively, as the grammar documents", () => {
    // A Deseret letter is one character in two UTF-16 units, so a length check on the string
    // classified it as a NAMED key and skipped the lowercasing that every other letter gets —
    // leaving its upper and lower case forms unable to match each other.
    const run = vi.fn();
    const manager = managerFor();
    manager.register([binding("\u{10400}", run)], { name: "shell", depth: 0 });
    manager.handle(press("\u{10428}"));
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("a keystroke the IME is composing with", () => {
  it("stops it reaching a window listener without preventing its default", () => {
    // Two things must both hold: the IME's own handling goes ahead, so the default is untouched;
    // and no other listener acts, so a legacy window-level owner cannot dismiss or navigate on
    // the Escape the user pressed to cancel what they were composing.
    const onWindow = vi.fn();
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], { name: "shell", depth: 0 });

    const detach = manager.attach(document);
    window.addEventListener("keydown", onWindow);
    const event = press("Escape");
    Object.defineProperty(event, "isComposing", { value: true });
    document.body.dispatchEvent(event);
    window.removeEventListener("keydown", onWindow);
    detach();

    expect(onWindow).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("extending a selection inside a modal", () => {
  it.each([
    ["ArrowLeft", { ctrlKey: true, shiftKey: true }],
    ["Home", { ctrlKey: true, shiftKey: true }],
  ])("leaves shift+%s to the field", (key, mods) => {
    // Shift is how a selection is extended, so rejecting every shifted chord took select-by-word
    // and select-to-boundary away from every field inside a blocking layer.
    const manager = managerFor(false);
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press(key, mods);
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(false);
  });

  it("still suppresses a shifted letter accelerator", () => {
    // The control: shift belongs to navigation, not to letters. Ctrl+Shift+A is browser tab
    // search and must not pass as select-all.
    const manager = managerFor(false);
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);
    const event = press("A", { ctrlKey: true, shiftKey: true });
    field.dispatchEvent(event);
    detach();
    field.remove();
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("a permitted key whose modifiers change mid-hold", () => {
  it("stops permitting it once it becomes an accelerator", () => {
    // Hold `w` in a field under a grab and it is text. Add Ctrl and the next repeat is a Ctrl+W
    // the browser closes the tab on — the same physical press, no longer the same keystroke.
    const manager = managerFor(false);
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    const detach = manager.attach(document);

    field.dispatchEvent(press("w", { code: "KeyW" }));
    const accelerator = press("w", {
      code: "KeyW",
      ctrlKey: true,
      repeat: true,
    });
    field.dispatchEvent(accelerator);
    detach();
    field.remove();

    expect(accelerator.defaultPrevented).toBe(true);
  });
});

describe("a keyboard with a dedicated AltGraph key", () => {
  it("does not abandon a sequence when AltGraph is pressed", () => {
    // AltGraph reports its own keydown before the character-producing one, so treating it as a
    // keystroke abandoned the sequence before the character that would complete it arrived.
    const run = vi.fn();
    const manager = managerFor(false);
    manager.register([binding("g d", run)], { name: "shell", depth: 0 });

    manager.handle(press("g"));
    manager.handle(press("AltGraph"));
    manager.handle(press("d"));

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("a prefix conflict hidden behind a shift glyph", () => {
  it("reports `?` against `shift+? x`", () => {
    // The matcher ignores the shift flag for punctuation whose glyph already encodes it, so both
    // answer the same physical keydown — but the diagnostic compared the raw flag and stayed
    // silent while one of the two bindings was unreachable.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDevWarnings();
    const manager = managerFor(false);
    manager.register([binding("?", vi.fn()), binding("shift+? x", vi.fn())], {
      name: "shell",
      depth: 0,
    });
    const said = warn.mock.calls.map(c => String(c[0])).join(" ");
    warn.mockRestore();
    expect(said).toContain("prefix");
    expect(manager).toBeDefined();
  });
});

describe("Tab from any control inside a modal", () => {
  it.each([
    ["button", (d: Document) => d.createElement("button")],
    [
      "checkbox",
      (d: Document) => {
        const box = d.createElement("input");
        box.type = "checkbox";
        return box;
      },
    ],
  ])("lets focus advance from a %s", (_name, make) => {
    // The earlier fix was tested with an input, where the typing path made it pass. From a
    // button or a checkbox the same Tab was still suppressed, so focus could not move between
    // the very controls a dialog is made of.
    const manager = managerFor();
    manager.register([binding("Escape", vi.fn())], {
      name: "modal",
      depth: 1,
      blocking: true,
    });
    const control = make(document);
    document.body.append(control);
    const detach = manager.attach(document);
    const event = press("Tab");
    control.dispatchEvent(event);
    detach();
    control.remove();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("a prefix conflict that only looks separable", () => {
  it("warns when the shorter binding is the typing-enabled one", () => {
    // Asymmetric: outside a field both are eligible and the exact match wins; inside one, only
    // the short binding is eligible. The longer one is dead in both places, so the warning that
    // an earlier fix suppressed for BOTH directions belongs here.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDevWarnings();
    const manager = managerFor();
    manager.register(
      [
        { keys: "g", description: "short", run: vi.fn(), whenTyping: true },
        { keys: "g d", description: "long", run: vi.fn(), whenTyping: false },
      ],
      { name: "shell", depth: 0 }
    );
    const said = warn.mock.calls.map(c => String(c[0])).join(" ");
    warn.mockRestore();
    expect(said).toContain("prefix");
    expect(manager).toBeDefined();
  });

  it("stays quiet in the direction that IS separable", () => {
    // The control: a typing-disabled shorter binding leaves the sequence genuinely reachable
    // inside a field, so the warning would be false there.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDevWarnings();
    const manager = managerFor();
    manager.register(
      [
        { keys: "g", description: "short", run: vi.fn(), whenTyping: false },
        { keys: "g d", description: "long", run: vi.fn(), whenTyping: true },
      ],
      { name: "shell", depth: 0 }
    );
    const said = warn.mock.calls.map(c => String(c[0])).join(" ");
    warn.mockRestore();
    expect(said).not.toContain("prefix");
    expect(manager).toBeDefined();
  });
});
