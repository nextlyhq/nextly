/**
 * The single owner of keyboard shortcuts for an application.
 *
 * ## Why this exists
 *
 * Shortcuts are usually registered by whoever needs them, each component adding its own
 * `document` listener. That works until two of them want the same key, and then it fails in a way
 * that is very hard to see: `stopPropagation()` does NOT stop other listeners on the same node —
 * that requires `stopImmediatePropagation()`, and even then only for listeners registered later.
 * So every global handler runs, in mount order, and mount order is not something a developer
 * chose. Pressing Escape during a drag can cancel the drag AND navigate away from the page,
 * because two independent listeners each believed they owned the key.
 *
 * This module replaces that with one listener and an explicit precedence rule.
 *
 * ## The model: a stack of layers
 *
 * A **layer** is a set of bindings belonging to one interactive context — the application shell,
 * a dialog, an editor canvas mid-drag. Layers are ordered, the topmost is offered each keystroke
 * first, and the first binding that matches consumes it.
 *
 * Precedence is `(depth, sequence)`: the deeper layer wins, and between layers at equal depth the
 * more recently registered wins. Depth comes from how the application nests, so precedence
 * follows the component tree rather than a set of coordinated numbers — the z-index problem,
 * avoided. Equal-depth ordering is what stacks a second dialog above the first.
 *
 * A layer may be **blocking**, meaning it also swallows the keys it does NOT bind. That is the
 * property a drag or a modal needs: while it is up, nothing beneath it can act. This is the same
 * shape as a window manager's keyboard grab, and as the dismissable-layer stack this kit's
 * dialogs already sit on.
 *
 * ## What it deliberately does not do
 *
 * It listens in the BUBBLE phase, so a focused component that handles its own keys and calls
 * `stopPropagation()` wins without needing to know this module exists. React attaches its
 * handlers at the app root, below `document`, so an `onKeyDown` prop is a sufficient opt-out.
 * Capturing instead would make this module outrank every component in the tree, including the
 * kit's own dialogs, and there would be no way for a component to decline.
 *
 * @module lib/shortcuts/manager
 */

import { devWarnOnce } from "../dev-warn";

import {
  chordMatches,
  detectApplePlatform,
  parseKeys,
  type KeyChord,
  type KeySequence,
} from "./key-spec";

/**
 * One shortcut and what it does.
 *
 * @experimental
 */
export interface ShortcutBinding {
  /** The keys, as understood by `parseKeys` — `"mod+s"`, `"Escape"`, `"g d"`. */
  keys: string;
  /**
   * What this does, in words, for a shortcuts help panel. Required because an undiscoverable
   * shortcut helps only the person who wrote it.
   */
  description: string;
  /** Runs when the shortcut fires. */
  run: (event: KeyboardEvent) => void;
  /** Checked at press time; a binding whose condition is false is skipped and passes the key on. */
  when?: () => boolean;
  /**
   * Whether this fires while the user is typing in a field.
   *
   * Defaults to true for bindings that carry a non-shift modifier or end on Escape, and false
   * otherwise — the rule nearly every application converges on. `mod+s` must save mid-sentence
   * and Escape must dismiss, while a bare `n` must be able to be the letter n.
   */
  whenTyping?: boolean;
  /** Whether to call `preventDefault()` when it fires. Defaults to true. */
  preventDefault?: boolean;
}

/**
 * How a layer behaves for keys it does not bind.
 *
 * @experimental
 */
export interface ShortcutLayerOptions {
  /** Identifies the layer in diagnostics and in a help panel. */
  name: string;
  /** Precedence: deeper layers are offered keystrokes first. */
  depth: number;
  /**
   * Whether unmatched keys stop here instead of reaching layers beneath.
   *
   * The reason a drag can be interrupted safely: everything below is inert for as long as this
   * is set, so no other context can act on a keystroke aimed at this one.
   */
  blocking?: boolean;
  /** Whether the layer participates at all. A disabled layer neither matches nor blocks. */
  enabled?: boolean;
}

/** A registered layer, which can be updated in place or removed. */
interface RegisteredLayer {
  options: ShortcutLayerOptions;
  bindings: readonly PreparedBinding[];
  sequence: number;
}

interface PreparedBinding {
  binding: ShortcutBinding;
  keys: KeySequence;
}

/**
 * A layer's registration, held by whoever created it.
 *
 * @experimental
 */
export interface ShortcutRegistration {
  /** Replace this layer's bindings and options without changing its precedence. */
  update: (
    bindings: readonly ShortcutBinding[],
    options: ShortcutLayerOptions
  ) => void;
  /** Remove the layer. */
  dispose: () => void;
}

/**
 * Options for creating a manager.
 *
 * @experimental
 */
export interface ShortcutManagerOptions {
  /** Whether `mod` means Command. Detected from the platform when omitted. */
  isApple?: boolean;
  /** How long a partially typed sequence waits for its next key, in milliseconds. */
  sequenceTimeoutMs?: number;
  /** Clock source, for tests that need to control sequence expiry. */
  now?: () => number;
}

/**
 * A shortcut manager: the registry, the matcher, and the one listener.
 *
 * @experimental
 */
export interface ShortcutManager {
  /** Add a layer. */
  register: (
    bindings: readonly ShortcutBinding[],
    options: ShortcutLayerOptions
  ) => ShortcutRegistration;
  /**
   * Offer a keystroke to the stack. Returns whether it was consumed.
   *
   * Public so the behaviour can be tested without a DOM, and so a host that already owns its
   * event plumbing can drive the manager itself.
   */
  handle: (event: KeyboardEvent) => boolean;
  /** Install the single listener on a target, returning a function that removes it. */
  attach: (
    target: Pick<EventTarget, "addEventListener" | "removeEventListener">
  ) => () => void;
  /** Every active binding, most-precedent layer first, for a shortcuts help panel. */
  activeBindings: () => readonly ActiveShortcut[];
}

/**
 * A binding as presented to a help panel, with the layer it came from.
 *
 * @experimental
 */
export interface ActiveShortcut {
  keys: string;
  description: string;
  layer: string;
}

const DEFAULT_SEQUENCE_TIMEOUT_MS = 1000;

/** Whether a keystroke is going into something the user is typing into. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (
    !target ||
    typeof HTMLElement === "undefined" ||
    !(target instanceof HTMLElement)
  ) {
    return false;
  }
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA") return true;
  // A native select does type-ahead on bare letters, so a single-key shortcut firing over it
  // would both act and suppress the control's own behaviour.
  if (tag === "SELECT") return true;
  if (tag === "INPUT") {
    // Only the text-bearing input types capture letters. A checkbox or a button is an input
    // element that a bare-letter shortcut should still fire over.
    const type = (target as HTMLInputElement).type.toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  // A custom widget that reports itself as taking text does, even when it is a div. `combobox`
  // and `listbox` are here for type-ahead rather than text entry: Radix's Select renders a
  // button with `role="combobox"` and jumps between options on bare letters without stopping
  // propagation, so a single-key shortcut would fire on top of the value it just changed. This
  // kit's own `Select` wraps that trigger, so the case is reachable from our own components.
  const role = target.getAttribute("role");
  return role === "textbox" || role === "combobox" || role === "listbox";
}

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** The default answer to "does this fire while typing?", explained on `ShortcutBinding`. */
function firesWhileTyping(prepared: PreparedBinding): boolean {
  const explicit = prepared.binding.whenTyping;
  if (explicit !== undefined) return explicit;
  // The FIRST chord decides, because that is the keystroke separating "issuing a command"
  // from "typing". Reading the last one rejects `mod+k c` in an editor: the sequence is
  // unmistakably a command, but its final chord is a bare letter.
  const first = prepared.keys[0];
  if (first === undefined) return false;
  return (
    first.mod || first.ctrl || first.meta || first.alt || first.key === "Escape"
  );
}

/**
 * Create a shortcut manager.
 *
 * @experimental
 */
export function createShortcutManager(
  options: ShortcutManagerOptions = {}
): ShortcutManager {
  const isApple = options.isApple ?? detectApplePlatform();
  const sequenceTimeoutMs =
    options.sequenceTimeoutMs ?? DEFAULT_SEQUENCE_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());

  const layers = new Set<RegisteredLayer>();
  let nextSequence = 0;

  // The partially typed sequence, shared across layers. It is global rather than per-layer
  // because the keystrokes are: once `g` has been pressed, the next key belongs to whichever
  // layer completes it, and a per-layer prefix would let two layers each hold half a sequence.
  let pendingAt: number | null = null;

  function prepare(bindings: readonly ShortcutBinding[]): PreparedBinding[] {
    return bindings.map(binding => ({
      binding,
      keys: parseKeys(binding.keys),
    }));
  }

  /** Most precedent first: deeper wins, then more recently registered. */
  function ordered(): RegisteredLayer[] {
    return [...layers]
      .filter(layer => layer.options.enabled !== false)
      .sort(
        (a, b) => b.options.depth - a.options.depth || b.sequence - a.sequence
      );
  }

  /**
   * Whether a binding's sequence matches the keys pressed so far.
   *
   * Returns `"exact"` when the sequence is complete, `"prefix"` when more keys would complete it,
   * and `"none"` otherwise. Distinguishing the middle case is what lets a sequence in progress
   * hold the keyboard without firing anything.
   */
  function matchDepth(
    prepared: PreparedBinding,
    pressed: readonly KeyboardEvent[]
  ): "exact" | "prefix" | "none" {
    if (pressed.length > prepared.keys.length) return "none";
    for (let i = 0; i < pressed.length; i++) {
      const chord = prepared.keys[i];
      const event = pressed[i];
      if (chord === undefined || event === undefined) return "none";
      if (!chordMatches(chord, event.key, event, isApple)) return "none";
    }
    return pressed.length === prepared.keys.length ? "exact" : "prefix";
  }

  function fire(
    prepared: PreparedBinding,
    event: KeyboardEvent,
    invoke: boolean
  ): void {
    if (prepared.binding.preventDefault !== false) event.preventDefault();
    if (invoke) prepared.binding.run(event);
  }

  /**
   * Whether letting this keystroke through would put a character into a field.
   *
   * The single case a blocking layer must not suppress. Everything else it swallows has to be,
   * or the grab is only half of one: the application stops acting while the BROWSER still does.
   */
  function insertsText(event: KeyboardEvent, typing: boolean): boolean {
    if (!typing || event.ctrlKey || event.metaKey || event.altKey) return false;
    // A single character is text. Everything else has to be named, because "unmodified" is not
    // the same question: F1, Escape and the function keys carry no text and reach the browser,
    // so treating them as editing would let a blocking layer report a key as consumed while the
    // browser still opened its help window.
    return event.key.length === 1 || FIELD_KEYS.has(event.key);
  }

  /**
   * Offer one candidate sequence to the stack.
   *
   * Takes the triggering event alongside the pressed sequence rather than reading the last
   * element back out: the sequence is the matching key, the event is what gets acted on, and
   * conflating them made the non-empty invariant something a reader had to reconstruct.
   */
  function offer(
    pressed: readonly KeyboardEvent[],
    event: KeyboardEvent,
    typing: boolean,
    invoke: boolean
  ): "fired" | "pending" | "blocked" | "none" {
    for (const layer of ordered()) {
      // Exact matches are resolved across the WHOLE layer before any prefix is considered.
      // Scanning in registration order instead makes one of `g` and `g d` unreachable purely by
      // which was registered first: `g` fires and clears the sequence, or `g d` returns pending
      // and the exact `g` is never examined. Order of registration should not decide which
      // binding exists.
      let prefixed = false;
      for (const prepared of layer.bindings) {
        if (typing && !firesWhileTyping(prepared)) continue;
        if (prepared.binding.when && !prepared.binding.when()) continue;
        const depth = matchDepth(prepared, pressed);
        if (depth === "exact") {
          fire(prepared, event, invoke);
          return "fired";
        }
        if (depth === "prefix") prefixed = true;
      }
      if (prefixed) {
        // A sequence in progress must swallow its own keystroke, or the `g` of `g d` would be
        // typed into the page while the sequence waits for `d`.
        event.preventDefault();
        return "pending";
      }
      if (layer.options.blocking) {
        // A grab that leaves the browser default in place is not a grab: mid-drag, `mod+s`
        // would still open the browser's own save dialog while the shell binding was blocked.
        if (!insertsText(event, typing)) event.preventDefault();
        return "blocked";
      }
    }
    return "none";
  }

  /**
   * Warn when one binding's sequence is a strict prefix of another's in the same layer.
   *
   * `g` and `g d` cannot both be reachable: the first keystroke either acts or waits, and
   * whichever answer the matcher gives, the other binding is dead. Resolving it by registration
   * order would make the outcome depend on the order of an array, so the matcher is
   * deterministic (exact wins) and the ambiguity is reported instead of hidden.
   */
  function warnOnPrefixConflicts(
    prepared: readonly PreparedBinding[],
    layerName: string
  ): void {
    const sameChord = (a: KeyChord, b: KeyChord): boolean =>
      a.key === b.key &&
      a.mod === b.mod &&
      a.ctrl === b.ctrl &&
      a.meta === b.meta &&
      a.alt === b.alt &&
      a.shift === b.shift;
    for (const short of prepared) {
      for (const long of prepared) {
        if (short === long || short.keys.length >= long.keys.length) continue;
        if (short.keys.every((chord, i) => sameChord(chord, long.keys[i]))) {
          devWarnOnce(
            false,
            `shortcuts: in layer "${layerName}", "${short.binding.keys}" is a prefix of ` +
              `"${long.binding.keys}", so the longer one can never fire. Bind one or the other.`
          );
        }
      }
    }
  }

  const pressedEvents: KeyboardEvent[] = [];

  function handle(event: KeyboardEvent): boolean {
    // An IME turns keystrokes into composition input, and Escape there means "abandon what I am
    // composing". Acting on it would cancel the composition AND dismiss whatever the application
    // binds Escape to — a keystroke the user never aimed at the application at all.
    if (event.isComposing) return false;
    // Something closer to the keystroke has already claimed it. Radix's DismissableLayer, which
    // every Dialog and Sheet in this kit is built on, listens on `document` in the CAPTURE phase,
    // calls `preventDefault()` to dismiss, and does not stop propagation — so without this check
    // one Escape closes the modal AND runs the shell's Escape binding underneath it. That is
    // precisely the double action this manager exists to remove, arriving through our own
    // components.
    if (event.defaultPrevented) return false;
    // Pressing a modifier on its own is not a keystroke to match, and treating it as one would
    // clear any sequence in progress the moment the user reached for Shift.
    if (MODIFIER_KEYS.has(event.key)) return false;

    const typing = isTypingTarget(event.target);

    // A held key repeats. The binding must not run again, but the key must stay CONSUMED: a
    // shortcut that suppressed the browser on the first keydown and then let every repeat
    // through would open the browser's own save dialog while the key was held down.
    if (event.repeat) {
      const repeated = offer([event], event, typing, false);
      return repeated !== "none";
    }

    if (pendingAt !== null && now() - pendingAt > sequenceTimeoutMs) {
      pendingAt = null;
      pressedEvents.length = 0;
    }

    pressedEvents.push(event);
    let outcome = offer(pressedEvents, event, typing, true);

    // A sequence that led nowhere must not eat the key that broke it: `g` then `mod+k` should
    // open the palette rather than being discarded with the abandoned prefix.
    //
    // "blocked" counts as leading nowhere. A blocking layer holding both a sequence and a
    // single-key binding would otherwise swallow the key that broke its own sequence — press
    // `g`, then Escape, and the layer's own Escape handler would need a SECOND press.
    if (
      pressedEvents.length > 1 &&
      (outcome === "none" || outcome === "blocked")
    ) {
      pressedEvents.length = 0;
      pressedEvents.push(event);
      pendingAt = null;
      outcome = offer(pressedEvents, event, typing, true);
    }

    if (outcome === "pending") {
      pendingAt = now();
      return true;
    }

    pendingAt = null;
    pressedEvents.length = 0;
    return outcome === "fired" || outcome === "blocked";
  }

  return {
    register(bindings, layerOptions) {
      const layer: RegisteredLayer = {
        options: layerOptions,
        bindings: prepare(bindings),
        sequence: nextSequence++,
      };
      warnOnPrefixConflicts(layer.bindings, layerOptions.name);
      layers.add(layer);
      return {
        update(nextBindings, nextOptions) {
          layer.bindings = prepare(nextBindings);
          layer.options = nextOptions;
        },
        dispose() {
          layers.delete(layer);
        },
      };
    },
    handle,
    attach(target) {
      const listener = (event: Event): void => {
        // `preventDefault` suppresses the BROWSER, not other JavaScript listeners. A consumed
        // key must also stop bubbling, or a window-level owner runs the second half of the
        // double action this manager exists to remove — which is the state of the tree during a
        // staged migration, when some owners have moved over and some have not.
        if (handle(event as KeyboardEvent)) event.stopPropagation();
      };
      target.addEventListener("keydown", listener);
      return () => target.removeEventListener("keydown", listener);
    },
    activeBindings() {
      return ordered().flatMap(layer =>
        layer.bindings.map(prepared => ({
          keys: prepared.binding.keys,
          description: prepared.binding.description,
          layer: layer.options.name,
        }))
      );
    },
  };
}

const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "Shift"]);

/**
 * Keys a focused field consumes itself: caret movement and the edits that carry no character.
 *
 * Used to decide what a blocking layer may suppress while the user is typing. A key outside this
 * set and not a character belongs to the browser, not the field.
 */
const FIELD_KEYS = new Set([
  "Backspace",
  "Delete",
  "Enter",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);
