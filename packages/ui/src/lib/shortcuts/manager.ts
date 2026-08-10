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
 * more recently registered wins.
 *
 * Of those two, **depth is declared and sequence is incidental** — and only declared properties
 * survive a refactor. A layer that unmounts and remounts takes a fresh sequence number, so a
 * subtree rebuilt for unrelated reasons can change equal-depth ordering. The guidance that falls
 * out: if relative order matters to you, express it as depth, because depth is the part of the
 * tuple you control. Equal-depth ordering is for stacking things that arrive in genuine
 * mount order, such as one dialog over another. Depth comes from how the application nests, so precedence
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
   * Defaults to true for bindings whose FIRST chord carries a non-shift modifier or is Escape,
   * and false otherwise — the rule nearly every application converges on. `mod+s` must save
   * mid-sentence and Escape must dismiss, while a bare `n` must be able to be the letter n.
   *
   * The first chord decides because it is the keystroke that has to be taken from the field.
   * `mod+k c` is a command from its opening chord, so its bare `c` completes it in an input. A
   * sequence that OPENS on a plain character cannot fire while typing whatever it ends with:
   * allowing `g Escape` would mean swallowing the `g` of every word containing one.
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

/** Identifies a physical keystroke, for matching a repeat back to the press that began it. */
function signature(event: KeyboardEvent): string {
  return `${event.key}\u0000${event.ctrlKey}${event.metaKey}${event.altKey}${event.shiftKey}`;
}

/**
 * The shape this module reads off an event target.
 *
 * Structural rather than `HTMLElement`, because `instanceof` is per-realm: a document inside an
 * iframe or a pop-out window has its OWN `HTMLElement`, and the manager documents a custom
 * `target`, so checking against the outer window's constructor rejects every control in exactly
 * the case the option exists to support. `nodeType === 1` identifies an element in any realm.
 */
interface ElementLike {
  tagName: string;
  isContentEditable: boolean;
  getAttribute: (name: string) => string | null;
}

/**
 * The element the keystroke actually reached.
 *
 * `event.target` is RETARGETED to the shadow host when focus is inside an open shadow root, so
 * reading it alone reports a custom element rather than the input inside it. The composed path
 * starts at the true target and crosses the boundary.
 */
function eventTarget(event: KeyboardEvent): EventTarget | null {
  const path = event.composedPath?.();
  return path && path.length > 0 ? (path[0] ?? null) : event.target;
}

/** The event target as an element, whichever document it came from. */
function asElement(target: EventTarget | null): ElementLike | null {
  if (target === null || typeof target !== "object") return null;
  const node = target as { nodeType?: unknown; tagName?: unknown };
  if (node.nodeType !== 1 || typeof node.tagName !== "string") return null;
  return target as unknown as ElementLike;
}

/** The `type` of an input element, or "" for anything else. */
function inputType(element: ElementLike): string {
  if (element.tagName !== "INPUT") return "";
  const value = (element as { type?: unknown }).type;
  return typeof value === "string" ? value.toLowerCase() : "";
}

/**
 * Whether a focused native control owns this key itself.
 *
 * A checkbox is not a typing target, so bare-letter shortcuts should still fire over it — but
 * Space is how it toggles, Enter is how a button activates, and the arrows are how a radio group
 * moves. Offering those to the shortcut stack means a global `Space` binding silently stops a
 * focused checkbox working, which is a worse failure than the shortcut not firing.
 */
function controlOwnsKey(
  target: EventTarget | null,
  event: KeyboardEvent
): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const element = asElement(target);
  if (!element) return false;
  const tag = element.tagName;
  const type = inputType(element);
  // `reset` belongs with the other button types: it is not a text field, and Space activates it.
  if (
    tag === "BUTTON" ||
    type === "button" ||
    type === "submit" ||
    type === "reset"
  ) {
    return event.key === " " || event.key === "Enter";
  }
  // A link activates on Enter. Space scrolls the page rather than following it, so it is not
  // an activation key here.
  if (tag === "A" && element.getAttribute("href") !== null) {
    return event.key === "Enter";
  }
  if (type === "checkbox") return event.key === " ";
  // A colour input opens its native picker on either key, and this product puts focusable ones
  // on screen in the page builder's colour and gradient controls.
  if (type === "color") return event.key === " " || event.key === "Enter";
  // A range input is a slider: the arrows, Home/End and PageUp/PageDown are how its value moves.
  if (type === "range") {
    return event.key.startsWith("Arrow") || RANGE_KEYS.has(event.key);
  }
  if (type === "radio") {
    return event.key === " " || event.key.startsWith("Arrow");
  }
  return false;
}

/** Whether a keystroke is going into something the user is typing into. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = asElement(target);
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag === "TEXTAREA") return true;
  // A native select does type-ahead on bare letters, so a single-key shortcut firing over it
  // would both act and suppress the control's own behaviour.
  if (tag === "SELECT") return true;
  if (tag === "INPUT") {
    // Only the text-bearing input types capture letters. A checkbox or a button is an input
    // element that a bare-letter shortcut should still fire over.
    return !NON_TEXT_INPUT_TYPES.has(inputType(element));
  }
  // A custom widget that reports itself as taking text does, even when it is a div. `combobox`
  // and `listbox` are here for type-ahead rather than text entry: Radix's Select renders a
  // button with `role="combobox"` and jumps between options on bare letters without stopping
  // propagation, so a single-key shortcut would fire on top of the value it just changed. This
  // kit's own `Select` wraps that trigger, so the case is reachable from our own components.
  const role = element.getAttribute("role");
  return role !== null && TYPE_AHEAD_ROLES.has(role);
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

  /**
   * The layer that claimed the sequence in progress.
   *
   * A prefix is not a property of the keyboard, it is a promise made by ONE layer. Without this,
   * disabling the claimer between keystrokes lets a lower layer's `g d` fire on a `d` whose `g`
   * it never saw, and a layer mounted mid-sequence inherits a prefix typed before it existed.
   */
  let pendingLayer: RegisteredLayer | null = null;

  /**
   * The keystroke consumed by the most recent fresh press, so its repeats stay consumed.
   *
   * Identifies the physical press rather than the binding that answered it: by the time a repeat
   * arrives, the binding may have made itself ineligible.
   */
  let consumedPress: { signature: string; prevented: boolean } | null = null;

  /**
   * Forget a partially typed sequence.
   *
   * Every path that hands a keystroke to someone else calls this. A pending sequence models "the
   * user is part-way through a command", and any real keystroke in between falsifies it — a
   * dismissal, a control taking its own key, a composition, a callback that threw. Keeping the
   * reset with the decision to stand down is deliberate: when it was open-coded at each exit,
   * five separate branches had to remember it and five separate reviews found one that did not.
   */
  function abandonSequence(): void {
    pendingAt = null;
    pressedEvents.length = 0;
    pendingLayer = null;
  }

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
    if (!typing) return false;
    // AltGraph arrives as ctrl+alt on the layouts that use it, so it must be unwrapped before
    // either modifier is read as a chord.
    const altGraph = event.getModifierState?.("AltGraph") ?? false;
    // Ctrl and Meta always make a chord. Alt is platform-dependent: on macOS Option is a text
    // modifier, while on Windows and Linux Alt+F is a menu accelerator that a grab must suppress.
    // Where Option applies, the key REPORTED is the character or `Dead`, never the base letter,
    // so the text tests below recognise it while `mod+s` still reads as the chord it is.
    if (!altGraph && (event.ctrlKey || event.metaKey)) return false;
    if (!altGraph && event.altKey && !isApple) return false;
    // Both are the start of composed text and both precede `isComposing`.
    if (event.key === "Dead" || event.key === "Process") return true;
    // One CODE POINT, not one code unit: an astral character is a single letter written as two
    // UTF-16 units, and rejecting it stops emoji and many scripts being typed at all.
    if ([...event.key].length === 1) return true;
    // A named key with Alt held is an accelerator rather than text.
    if (event.altKey) return false;
    // Enter, PageUp and PageDown edit or scroll only where the target owns multiple lines. In a
    // single-line input Enter submits the form and the page keys scroll the document behind it —
    // application behaviour running underneath the grab, not text entry.
    if (MULTILINE_ONLY_KEYS.has(event.key)) return ownsMultilineText(event);
    return FIELD_KEYS.has(event.key);
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
      // Only the layer that opened a sequence may complete it.
      if (
        pressed.length > 1 &&
        pendingLayer !== null &&
        layer !== pendingLayer
      ) {
        continue;
      }
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
        pendingLayer = layer;
        // A sequence in progress must swallow its own keystroke, or the `g` of `g d` would be
        // typed into the page while the sequence waits for `d`.
        event.preventDefault();
        return "pending";
      }
      if (layer.options.blocking) return "blocked";
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

  /**
   * Offer the keystroke, leaving no sequence behind if a consumer's callback throws.
   *
   * An uncaught handler exception does not stop the page, so without this the half-typed prefix
   * outlives the keystroke that failed: a later key could complete a DIFFERENT command in a
   * lower layer, long after the one that threw had already acted.
   */
  function runOffer(
    pressed: readonly KeyboardEvent[],
    event: KeyboardEvent,
    typing: boolean
  ): "fired" | "pending" | "blocked" | "none" {
    try {
      return offer(pressed, event, typing, true);
    } catch (error) {
      abandonSequence();
      consumedPress = null;
      throw error;
    }
  }

  function handle(event: KeyboardEvent): boolean {
    // An IME turns keystrokes into composition input, and Escape there means "abandon what I am
    // composing". Acting on it would cancel the composition AND dismiss whatever the application
    // binds Escape to — a keystroke the user never aimed at the application at all.
    // Checked FIRST: an owner closer to the keystroke has already answered it, and that stays
    // true even while an IME is composing. Reported as consumed so `attach` stops it
    // propagating — the manager runs no binding, but it is the one place that can keep a
    // window-level owner from acting on a key someone else already answered.
    if (event.defaultPrevented) {
      abandonSequence();
      return true;
    }
    // Composition keystrokes belong to the IME. Escape there means "abandon what I am
    // composing", so acting on it would cancel the composition AND whatever the application
    // binds Escape to.
    if (event.isComposing) {
      abandonSequence();
      return false;
    }
    // Pressing a modifier on its own is not a keystroke to match, and treating it as one would
    // clear any sequence in progress the moment the user reached for Shift.
    if (MODIFIER_KEYS.has(event.key)) return false;

    // A focused native control gets its own activation keys before the shortcut stack sees them.
    if (controlOwnsKey(eventTarget(event), event)) {
      abandonSequence();
      return false;
    }

    const typing = isTypingTarget(eventTarget(event));

    // A held key repeats. The binding must not run again, but the key must stay CONSUMED: a
    // shortcut that suppressed the browser on the first keydown and then let every repeat
    // through would open the browser's own save dialog while the key was held down.
    if (event.repeat) {
      // Re-offering is not enough on its own. A binding whose action changes its own condition —
      // `mod+s` saving and clearing the dirty flag — is no longer eligible by the second
      // keydown, so the repeat would be reported unhandled and the browser would take it. What
      // was consumed is a PRESS, not a match, so the press is what gets remembered.
      if (
        consumedPress !== null &&
        consumedPress.signature === signature(event)
      ) {
        // Consumed does not imply suppressed. A binding may set `preventDefault: false`, and a
        // blocking layer deliberately lets text through — so unconditionally preventing repeats
        // would let a held Backspace delete one character and then stop.
        if (consumedPress.prevented) event.preventDefault();
        return true;
      }
      const repeated = offer([event], event, typing, false);
      if (repeated === "blocked" && !insertsText(event, typing)) {
        // A key can begin repeating BEFORE the layer that grabs the keyboard appears, so this is
        // the first time the manager sees it and there is no earlier press to inherit from.
        // Without this the browser keeps scrolling underneath the grab.
        event.preventDefault();
      }
      return repeated !== "none";
    }

    if (pendingAt !== null && now() - pendingAt > sequenceTimeoutMs) {
      abandonSequence();
    }

    pressedEvents.push(event);
    let outcome = runOffer(pressedEvents, event, typing);

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
      abandonSequence();
      pressedEvents.push(event);
      outcome = runOffer(pressedEvents, event, typing);
    }

    if (outcome === "pending") {
      pendingAt = now();
      consumedPress = {
        signature: signature(event),
        prevented: event.defaultPrevented,
      };
      return true;
    }

    abandonSequence();
    if (outcome === "blocked") {
      // Applied HERE rather than inside `offer`, because a "blocked" from a multi-key candidate
      // is tentative: the retry below may still find an exact single-key binding, and one that
      // sets `preventDefault: false` cannot uncancel an event the fallback already cancelled.
      // A grab that leaves the browser default in place is still not a grab, so this runs once
      // the outcome is final.
      if (!insertsText(event, typing)) event.preventDefault();
    }
    const consumed = outcome === "fired" || outcome === "blocked";
    consumedPress = consumed
      ? { signature: signature(event), prevented: event.defaultPrevented }
      : null;
    return consumed;
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
          // The React hook registers empty and supplies its real bindings here, so a diagnostic
          // that only ran at `register` would never see the bindings anyone actually writes.
          warnOnPrefixConflicts(layer.bindings, nextOptions.name);
          // The bindings that made the pending promise are gone.
          if (pendingLayer === layer) abandonSequence();
        },
        dispose() {
          layers.delete(layer);
          if (pendingLayer === layer) abandonSequence();
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
 * Tab is deliberately absent. It moves focus rather than editing text, so letting it through
 * would carry focus straight out of the drag or modal that claimed the keyboard. A focus trap
 * that wants Tab claims it before the manager, which the `defaultPrevented` check then honours.
 *
 * Used to decide what a blocking layer may suppress while the user is typing. A key outside this
 * set and not a character belongs to the browser, not the field.
 */
/**
 * Roles whose widgets consume bare characters themselves.
 *
 * `textbox` takes text; the rest do type-ahead — Radix's Select jumps between options on a
 * letter, and its menus move focus the same way, neither preventing default nor stopping
 * propagation. A shortcut firing over them acts on top of a selection the user just made.
 */
const TYPE_AHEAD_ROLES = new Set([
  "textbox",
  "combobox",
  "listbox",
  "menu",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
]);

/** The non-arrow keys a native range input uses to move its value. */
const RANGE_KEYS = new Set(["Home", "End", "PageUp", "PageDown"]);

/** Keys that belong to the target only when it holds more than one line of text. */
const MULTILINE_ONLY_KEYS = new Set(["Enter", "PageUp", "PageDown"]);

/** Whether the keystroke reached something that owns multiple lines of text. */
function ownsMultilineText(event: KeyboardEvent): boolean {
  const element = asElement(eventTarget(event));
  return (
    element !== null &&
    (element.tagName === "TEXTAREA" || element.isContentEditable)
  );
}

const FIELD_KEYS = new Set([
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);
