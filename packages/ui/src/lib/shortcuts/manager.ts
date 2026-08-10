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

import {
  chordMatches,
  detectApplePlatform,
  parseKeys,
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
  if (tag === "INPUT") {
    // Only the text-bearing input types capture letters. A checkbox or a button is an input
    // element that a bare-letter shortcut should still fire over.
    const type = (target as HTMLInputElement).type.toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  // A custom widget that reports itself as a text box takes text even when it is a div.
  return target.getAttribute("role") === "textbox";
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
  const last = prepared.keys[prepared.keys.length - 1];
  if (last === undefined) return false;
  return (
    last.mod || last.ctrl || last.meta || last.alt || last.key === "Escape"
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
  let pending: { chords: string[]; at: number } | null = null;

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

  function chordKey(event: KeyboardEvent): string {
    return `${event.key} ${event.ctrlKey}${event.metaKey}${event.altKey}${event.shiftKey}`;
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

  function fire(prepared: PreparedBinding, event: KeyboardEvent): void {
    if (prepared.binding.preventDefault !== false) event.preventDefault();
    prepared.binding.run(event);
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
    typing: boolean
  ): "fired" | "pending" | "blocked" | "none" {
    for (const layer of ordered()) {
      for (const prepared of layer.bindings) {
        if (typing && !firesWhileTyping(prepared)) continue;
        if (prepared.binding.when && !prepared.binding.when()) continue;
        const depth = matchDepth(prepared, pressed);
        if (depth === "exact") {
          fire(prepared, event);
          return "fired";
        }
        if (depth === "prefix") {
          // A sequence in progress must swallow its own keystroke, or the `g` of `g d` would be
          // typed into the page while the sequence waits for `d`.
          event.preventDefault();
          return "pending";
        }
      }
      if (layer.options.blocking) return "blocked";
    }
    return "none";
  }

  const pressedEvents: KeyboardEvent[] = [];

  function handle(event: KeyboardEvent): boolean {
    // A held key repeats; a shortcut should fire once per press.
    if (event.repeat) return false;
    // Pressing a modifier on its own is not a keystroke to match, and treating it as one would
    // clear any sequence in progress the moment the user reached for Shift.
    if (MODIFIER_KEYS.has(event.key)) return false;

    if (pending && now() - pending.at > sequenceTimeoutMs) {
      pending = null;
      pressedEvents.length = 0;
    }

    const typing = isTypingTarget(event.target);
    pressedEvents.push(event);

    let outcome = offer(pressedEvents, event, typing);

    // A sequence that led nowhere must not eat the key that broke it: `g` then `mod+k` should
    // open the palette rather than being discarded with the abandoned prefix.
    if (outcome === "none" && pressedEvents.length > 1) {
      pressedEvents.length = 0;
      pressedEvents.push(event);
      pending = null;
      outcome = offer(pressedEvents, event, typing);
    }

    if (outcome === "pending") {
      pending = { chords: pressedEvents.map(chordKey), at: now() };
      return true;
    }

    pending = null;
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
        handle(event as KeyboardEvent);
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
