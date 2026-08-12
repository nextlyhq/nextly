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
  shiftIsMeaningful,
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
  /** What this layer MATCHES, so a re-render that changed nothing can be told apart. */
  shape: string;
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
  /**
   * Every active binding, most-precedent layer first, for a shortcuts help panel.
   *
   * The same array is returned until the layer stack changes, so it is safe to use as an external
   * store snapshot without re-rendering on every read.
   */
  activeBindings: () => readonly ActiveShortcut[];
  /**
   * Watch for changes to the layer stack.
   *
   * A help panel mounting alongside the components that register shortcuts would otherwise read
   * BEFORE their effects run and show nothing, with no later render to correct it.
   */
  subscribe: (onChange: () => void) => () => void;
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

/**
 * Identifies the physical press, for matching a repeat back to the keystroke that began it.
 *
 * `code` rather than `key` and the modifier flags, because those CHANGE while a key is held:
 * press Ctrl+S, then add Shift, and the repeats arrive as `S` with a different modifier set. A
 * signature built from them stops matching mid-hold, the repeat is reported unhandled, and the
 * browser takes it. The physical key does not move, so the physical key is what is remembered.
 */
function signature(event: KeyboardEvent): string {
  return event.code || event.key;
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
    type === "reset" ||
    type === "image"
  ) {
    return event.key === " " || event.key === "Enter";
  }
  // A link activates on Enter. Space scrolls the page rather than following it, so it is not
  // an activation key here.
  if (tag === "A" && element.getAttribute("href") !== null) {
    return event.key === "Enter";
  }
  // A summary toggles its details on either key, and the admin renders focusable ones today.
  if (tag === "SUMMARY") return event.key === " " || event.key === "Enter";
  if (type === "checkbox") return event.key === " ";
  // A colour input opens its native picker on either key, and this product puts focusable ones
  // on screen in the page builder's colour and gradient controls.
  if (type === "color") return event.key === " " || event.key === "Enter";
  // A file input opens its chooser the same way, and the public `Input` accepts every native
  // type, so this is reachable without anyone writing a raw input element.
  if (type === "file") return event.key === " " || event.key === "Enter";
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
   * What each held key was consumed as, keyed by the physical key, so its repeats stay consumed.
   *
   * Keyed by the physical press rather than by the binding that answered it: by the time a repeat
   * arrives, the binding may have made itself ineligible.
   *
   * A map rather than one slot, because several keys are held at once routinely. A single slot
   * was overwritten by the next press: hold `mod+s`, press `mod+k` while `s` is still down, and
   * the repeats of `s` matched nothing, so a binding that had made itself ineligible let the
   * browser take them. The map is bounded by the number of distinct physical keys on the keyboard.
   */
  const consumedPresses = new Map<string, { prevented: boolean }>();

  /**
   * The physical key that opened the pending sequence, so its own repeats can be told apart from
   * every other key's.
   *
   * Holding the key that started a prefix must not cancel that prefix, but a repeat arriving from
   * any OTHER key is a real keystroke in between and does cancel it.
   */
  let pendingKey: string | null = null;

  /**
   * What a layer matches, ignoring the parts that change on every render.
   *
   * `useShortcuts` calls `update()` after each render, so a callback identity or an inline object
   * differs constantly while the shortcuts themselves are identical. Cancelling a sequence on
   * every update would make `g d` fail whenever a timer or a context change happened to land
   * between the two keystrokes.
   */
  function layerShape(
    bindings: readonly PreparedBinding[],
    options: ShortcutLayerOptions
  ): string {
    const keys = bindings.map(b => b.binding.keys).join("\u0000");
    return `${keys}\u0001${options.depth}\u0001${options.blocking === true}\u0001${options.enabled !== false}`;
  }

  /** Whether any enabled layer is currently holding the keyboard. */
  function blocking(): boolean {
    return ordered().some(layer => layer.options.blocking === true);
  }

  /**
   * Forget a partially typed sequence.
   *
   * Every path that hands a keystroke to someone else calls this. A pending sequence models "the
   * user is part-way through a command", and any real keystroke in between falsifies it — a
   * dismissal, a control taking its own key, a composition, a callback that threw. One function
   * rather than a reset open-coded at each exit, so standing down and forgetting the prefix
   * cannot come apart: an exit that stands down without resetting leaves a later `d` completing
   * a `g` typed before the keystroke that interrupted it.
   */
  function abandonSequence(): void {
    pendingAt = null;
    pressedEvents.length = 0;
    pendingLayer = null;
    pendingKey = null;
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
    // Tab first, and regardless of what has focus. A modal's focus trap only cancels the WRAP at
    // its first and last tabbable element and relies on the browser default in between, so every
    // control inside it needs Tab to pass — a button and a checkbox just as much as a field.
    //
    // Only the focus-navigation spellings, though. Shift+Tab is the backwards move and belongs
    // here; Ctrl+Tab and its Shift variant change BROWSER TAB, which is a way out of the grab
    // rather than a move inside it. Exempting those reported the keystroke consumed while leaving
    // its default in place, so the layer both silenced other listeners and let the user leave.
    // A layer that genuinely wants a modified Tab can still bind it: an explicit binding matches
    // before this fallback is consulted.
    if (event.key === "Tab")
      return !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!typing) return false;
    // AltGraph arrives as ctrl+alt on the layouts that use it, so it must be unwrapped before
    // either modifier is read as a chord.
    const altGraph = event.getModifierState?.("AltGraph") ?? false;

    if (!altGraph && (event.ctrlKey || event.metaKey)) {
      // A field owns its own editing commands. Suppressing these would leave a user unable to
      // copy, paste, undo or select inside an input that sits in a blocking modal — a far worse
      // outcome than an unbound accelerator reaching the browser. A binding that wants one of
      // these still matches first; only UNBOUND combinations reach here.
      const letter =
        event.key.length === 1 ? event.key.toLowerCase() : event.key;
      // Redo is the one editing command spelled WITH shift on Apple platforms; everywhere else
      // it is Ctrl+Y. Both are the field's.
      if (letter === "z" && event.shiftKey) return !event.altKey;
      if (letter === REDO_LETTER)
        return !isApple && !event.shiftKey && !event.altKey;
      // Shift is how a selection is EXTENDED: mod+shift+arrow selects by word and
      // mod+shift+Home to a boundary, so navigation keeps it. Letters do not — allowing
      // arbitrary modified variants let Ctrl+Shift+A, the browser's tab search, pass as though
      // it were select-all and escape the grab entirely.
      if (EDITING_NAVIGATION.has(event.key)) return !event.altKey || isApple;
      if (event.shiftKey || event.altKey) return false;
      return EDITING_LETTERS.has(letter);
    }
    // Option turns caret keys into their by-word forms on macOS, and is a text modifier there;
    // on Windows and Linux, Alt with a named key is a menu accelerator.
    if (!altGraph && event.altKey) {
      // A native select opens and closes its option popup with Alt and the vertical arrows, so
      // the control's own claim is checked before the key is written off as an accelerator.
      if (
        (event.key === "ArrowDown" || event.key === "ArrowUp") &&
        asElement(eventTarget(event))?.tagName === "SELECT"
      ) {
        return true;
      }
      if (!isApple) return false;
      if (EDITING_NAVIGATION.has(event.key)) return true;
    }
    // Both are the start of composed text and both precede `isComposing`.
    if (event.key === "Dead" || event.key === "Process") return true;
    // One CODE POINT, not one code unit: an astral character is a single letter written as two
    // UTF-16 units, and rejecting it stops emoji and many scripts being typed at all.
    if ([...event.key].length === 1) return true;
    // Enter, PageUp and PageDown edit or scroll only where the target owns multiple lines. In a
    // single-line input Enter submits the form and the page keys scroll the document behind it —
    // application behaviour running underneath the grab, not text entry.
    if (AMBIGUOUS_KEYS.has(event.key)) return targetOwnsAmbiguousKey(event);
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
      // Only the layer that opened a sequence may complete it. That is a rule about MATCHING and
      // deliberately not about precedence: skipping the whole layer let a modal that mounted
      // mid-sequence be stepped over entirely, so a shell command ran straight through the
      // keyboard grab the modal had just taken.
      const mayMatch =
        pressed.length <= 1 || pendingLayer === null || layer === pendingLayer;

      if (mayMatch) {
        // Exact matches are resolved across the WHOLE layer before any prefix is considered.
        // Scanning in registration order instead makes one of `g` and `g d` unreachable purely
        // by which was registered first: `g` fires and clears the sequence, or `g d` returns
        // pending and the exact `g` is never examined. Order of registration should not decide
        // which binding exists.
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
    // `mod` is an alias, so the comparison has to happen after it is resolved: on Windows,
    // `mod+k` and `ctrl+k` are the same physical chord and raw flags call them different.
    const resolved = (chord: KeyChord): string => {
      const ctrl = chord.ctrl || (chord.mod && !isApple);
      const meta = chord.meta || (chord.mod && isApple);
      // Shift is normalised the way the MATCHER treats it. For punctuation whose glyph already
      // encodes shift, the matcher ignores the flag, so `?` and `shift+?` are one chord to it —
      // and a diagnostic that called them different stayed silent about a genuine conflict.
      const shift = shiftIsMeaningful(chord.key) ? chord.shift : false;
      return `${chord.key}\u0000${ctrl}${meta}${chord.alt}${shift}`;
    };
    const sameChord = (a: KeyChord, b: KeyChord): boolean =>
      resolved(a) === resolved(b);
    for (const short of prepared) {
      for (const long of prepared) {
        if (short === long || short.keys.length >= long.keys.length) continue;
        // Only claim the longer binding is dead when nothing can separate the two at press time.
        // A conditional shorter binding is skipped while its `when` is false, and a difference in
        // typing eligibility means one of them is out of play in a focused field — in both cases
        // the sequence does become reachable, and telling the developer to delete one of them
        // would be wrong.
        if (short.binding.when !== undefined) continue;
        // Only ONE direction makes the longer binding reachable. A typing-disabled shorter
        // binding paired with a typing-enabled longer one is genuinely separable: inside a field
        // the short one is out of play and the sequence can run. The reverse is not — outside a
        // field both are eligible and the exact match wins, inside it only the short one is — so
        // the longer binding is dead either way and the warning belongs.
        if (!firesWhileTyping(short) && firesWhileTyping(long)) continue;
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

  const watchers = new Set<() => void>();
  /** The last computed binding list, so repeated reads return the same array identity. */
  let snapshot: readonly ActiveShortcut[] | null = null;

  /** The bindings a reader sees, in precedence order. */
  function computeSnapshot(): readonly ActiveShortcut[] {
    return ordered().flatMap(layer =>
      layer.bindings.map(prepared => ({
        keys: prepared.binding.keys,
        description: prepared.binding.description,
        layer: layer.options.name,
      }))
    );
  }

  /** Whether two binding lists describe the same surface, field by field. */
  function sameShortcuts(
    a: readonly ActiveShortcut[],
    b: readonly ActiveShortcut[]
  ): boolean {
    return (
      a.length === b.length &&
      a.every(
        (entry, index) =>
          entry.keys === b[index]?.keys &&
          entry.description === b[index]?.description &&
          entry.layer === b[index]?.layer
      )
    );
  }

  /**
   * Invalidate the snapshot and tell anyone watching that the stack changed.
   *
   * Watchers are notified only when what they can OBSERVE differs. `update()` runs after every
   * render of a registering component, so notifying unconditionally makes a component that both
   * registers shortcuts and reads them re-render, update, and notify again without end, until
   * React stops it with "Maximum update depth exceeded". An unchanged surface also keeps its
   * previous array identity, which is what an external store must return for a reader not to
   * re-render on a read.
   */
  function changed(): void {
    const previous = snapshot;
    snapshot = null;
    if (watchers.size === 0) return;
    const next = computeSnapshot();
    if (previous && sameShortcuts(previous, next)) {
      snapshot = previous;
      return;
    }
    snapshot = next;
    for (const watcher of watchers) watcher();
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
      // Only THIS key's consumption is dropped. Clearing the map forgot every other key still
      // held: a later repeat of one of those was re-offered rather than inheriting its
      // suppression, and a binding whose own action had made it ineligible reported the repeat
      // unhandled, handing the browser an accelerator the first press had suppressed.
      consumedPresses.delete(signature(event));
      throw error;
    }
  }

  function handle(event: KeyboardEvent): boolean {
    // An event this manager cannot read as a keystroke at all.
    //
    // `attach` listens on `document`, so EVERYTHING dispatched on the page arrives here,
    // including synthetic events from code that is not ours -- `new CustomEvent("keydown")`,
    // password managers, autofill shims. Those carry no `key`, and the match path spreads it
    // (`[...key]`) and calls `startsWith` on it, both of which throw on `undefined`.
    //
    // Admitted ONCE, here, rather than defended at each read: `handle` is the only way in, and
    // `key` is the only property whose absence throws. The modifier flags degrade to "no match"
    // when undefined, and `getModifierState` is already optional-chained at both call sites.
    //
    // Reported as NOT consumed, so `attach` leaves it propagating: an event this manager cannot
    // interpret must reach whatever listener does understand it.
    if (typeof event.key !== "string") return false;

    // Checked FIRST among real keystrokes: an owner closer to the keystroke has already answered it, and that stays
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
      // Reported as consumed WITHOUT preventing the default: the IME's own handling must go
      // ahead, and no other listener should act on the keystroke either. During a staged
      // migration a window-level owner would otherwise dismiss or navigate on the Escape the
      // user pressed to cancel what they were composing.
      return true;
    }
    // Pressing a modifier on its own is not a keystroke to match, and treating it as one would
    // clear any sequence in progress the moment the user reached for Shift. A layer holding the
    // keyboard still consumes it, though — without preventing its default, since a modifier press
    // has no default worth suppressing, and without disturbing the sequence. Otherwise a legacy
    // window-level handler reacting to Shift or Alt still changes application state underneath a
    // grab that claims to hold every unmatched key.
    if (MODIFIER_KEYS.has(event.key)) return blocking();

    // A focused native control gets its own activation keys before the shortcut stack sees them.
    if (controlOwnsKey(eventTarget(event), event)) {
      abandonSequence();
      // Consumed WITHOUT preventing the default, exactly as a composing keystroke is: the
      // control's own activation must go ahead, and no other listener should act on it either.
      // A window-level owner acting on the Space that ticked a checkbox is the same double
      // action in a quieter place.
      return true;
    }

    const typing = isTypingTarget(eventTarget(event));

    // A held key repeats. The binding must not run again, but the key must stay CONSUMED: a
    // shortcut that suppressed the browser on the first keydown and then let every repeat
    // through would open the browser's own save dialog while the key was held down.
    if (event.repeat) {
      // A repeat of some OTHER key is a real keystroke between the sequence's own. While `x` is
      // held, pressing `g`, receiving another `x` repeat, then pressing `d` must not complete
      // `g d` as though nothing had come between them.
      //
      // Measured against the key that OPENED the prefix, not against whether this manager
      // consumed the repeating key. Holding a consumed key — `mod+s` — while typing `g d` put
      // that key in the consumed map, so asking the map preserved the prefix across a keystroke
      // from an entirely different key.
      if (pendingKey !== signature(event)) {
        abandonSequence();
      }
      // Re-offering is not enough on its own. A binding whose action changes its own condition —
      // `mod+s` saving and clearing the dirty flag — is no longer eligible by the second
      // keydown, so the repeat would be reported unhandled and the browser would take it. What
      // was consumed is a PRESS, not a match, so the press is what gets remembered.
      const held = consumedPresses.get(signature(event));
      if (held) {
        // Two different questions about one held key, and they have different answers.
        //
        // CONSUMED belongs to the physical press: it does not move when the modifiers around it
        // do, so the repeats of a keystroke this manager answered stay its own.
        //
        // SUPPRESSED is a property of the keystroke, and modifiers change what that is. A press
        // that was prevented stays prevented — adding shift to a held `mod+s` must not hand the
        // browser a Save As. A press that was PERMITTED, though, was permitted because it was
        // text: add Ctrl to a held `w` and it becomes the accelerator that closes the tab, so the
        // decision is re-made rather than inherited.
        //
        // A PERMITTED press is re-decided by ASKING the stack again, rather than by comparing a
        // signature of the things that might have changed.
        //
        // Three independent inputs decide it — the modifiers, the layer stack, and each binding's
        // own `when` — and the last cannot be signed at all: it is a function, so every render
        // supplies a new identity while the condition is unchanged, and signing it would re-decide
        // constantly. Re-offering reads all three at once, so a binding whose action falsified its
        // own condition stops permitting the browser default on its next repeat, rather than
        // leaving the page scrolling under a layer that claims to hold the keyboard.
        //
        // Offered with `invoke` false, so the matching binding's `preventDefault` policy applies
        // without its action running a second time.
        if (held.prevented) {
          event.preventDefault();
        } else {
          const still = offer([event], event, typing, false);
          // "fired" means a binding matched and its own `preventDefault` policy has already been
          // applied, so nothing more is decided here. Every other outcome leaves a press this
          // manager still owns with no one applying a policy to it, and the browser must not act
          // on a key we claim — unless it is text, which is the one thing a grab may never eat.
          //
          // The "none" case is not hypothetical: hold a plain `w` bound with
          // `preventDefault: false`, then add Ctrl. No binding matches Ctrl+W, there may be no
          // blocking layer to report it, and the browser closes the tab.
          if (still !== "fired" && !insertsText(event, typing)) {
            event.preventDefault();
          }
        }
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
      pendingKey = signature(event);
      consumedPresses.set(signature(event), {
        prevented: event.defaultPrevented,
      });
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
    if (consumed) {
      consumedPresses.set(signature(event), {
        prevented: event.defaultPrevented,
      });
    } else {
      consumedPresses.delete(signature(event));
    }
    return consumed;
  }

  return {
    register(bindings, layerOptions) {
      const prepared = prepare(bindings);
      const layer: RegisteredLayer = {
        options: layerOptions,
        bindings: prepared,
        sequence: nextSequence++,
        shape: layerShape(prepared, layerOptions),
      };
      warnOnPrefixConflicts(layer.bindings, layerOptions.name);
      layers.add(layer);
      changed();
      return {
        update(nextBindings, nextOptions) {
          layer.bindings = prepare(nextBindings);
          layer.options = nextOptions;
          // The React hook registers empty and supplies its real bindings here, so a diagnostic
          // that only ran at `register` would never see the bindings anyone actually writes.
          warnOnPrefixConflicts(layer.bindings, nextOptions.name);
          const shape = layerShape(layer.bindings, nextOptions);
          const shapeChanged = shape !== layer.shape;
          layer.shape = shape;
          // Only a change to what this layer MATCHES can invalidate a promise it made. `update`
          // runs after every render, so cancelling unconditionally made a sequence fail whenever
          // an unrelated re-render landed between its two keystrokes.
          if (shapeChanged && pendingLayer === layer) abandonSequence();
          changed();
        },
        dispose() {
          layers.delete(layer);
          changed();
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
        try {
          if (handle(event as KeyboardEvent)) event.stopPropagation();
        } catch (error) {
          // A binding whose callback threw still CLAIMED the key. Dispatch continues to later
          // listeners after an exception is reported, so leaving the event unstopped would hand
          // the same keystroke to a window-level owner and recreate the double action — with a
          // failed handler, which is the worst moment to run a fallback as though nothing had.
          event.stopPropagation();
          throw error;
        }
      };
      target.addEventListener("keydown", listener);
      return () => {
        target.removeEventListener("keydown", listener);
        // A sequence belongs to the event stream that began it. A provider swapping targets
        // would otherwise let a `g` from the old document be completed by a `d` on the new one,
        // and a repeat inherit consumption state from keystrokes this target never saw.
        abandonSequence();
        consumedPresses.clear();
      };
    },
    subscribe(onChange) {
      watchers.add(onChange);
      return () => {
        watchers.delete(onChange);
      };
    },
    activeBindings() {
      // Cached, because an external store must return a stable identity for an unchanged stack:
      // a fresh array on every read makes React re-render without end.
      if (snapshot) return snapshot;
      snapshot = computeSnapshot();
      return snapshot;
    },
  };
}

const MODIFIER_KEYS = new Set([
  "Control",
  "Meta",
  "Alt",
  "Shift",
  // A dedicated AltGraph key reports its own keydown before the character-producing one. Without
  // it here, pressing AltGraph mid-sequence abandons the sequence before the character that would
  // have completed it ever arrives.
  "AltGraph",
]);

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
  // The focused element inside an open listbox is the OPTION, and it is what the event reports;
  // the listbox itself is only its ancestor.
  "option",
  "menu",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
]);

/** The non-arrow keys a native range input uses to move its value. */
const RANGE_KEYS = new Set(["Home", "End", "PageUp", "PageDown"]);

/**
 * The letters a text field claims with Ctrl or Command: clipboard, select-all, undo and redo.
 *
 * Unbound, these belong to the field rather than to the application, so a modal that grabbed the
 * keyboard would otherwise make copy and paste impossible inside its own inputs.
 */
const EDITING_LETTERS = new Set(["a", "c", "v", "x", "z"]);

/**
 * Redo, which is spelled differently on each platform.
 *
 * Ctrl+Y is redo on Windows and Linux. On macOS redo is Command+Shift+Z, and Command+Y is a
 * BROWSER accelerator that opens history — so treating it as an editing key everywhere would let
 * it escape a keyboard grab on the one platform where it is not editing at all.
 */
const REDO_LETTER = "y";

/** Caret movement and deletion, which a modifier turns into their by-word forms. */
const EDITING_NAVIGATION = new Set([
  "Insert",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "Backspace",
  "Delete",
]);

/** Keys whose owner depends on which control has focus. */
const AMBIGUOUS_KEYS = new Set(["Enter", "PageUp", "PageDown"]);

/**
 * Whether the focused target owns this particular ambiguous key.
 *
 * Enter, PageUp and PageDown mean different things to different controls, so one answer for all
 * three would be wrong for at least one of them. Enter inserts a newline only where there are
 * lines; the page keys page through content, which a native select does with its option list.
 */
function targetOwnsAmbiguousKey(event: KeyboardEvent): boolean {
  const element = asElement(eventTarget(event));
  if (element === null) return false;
  const multiline = element.tagName === "TEXTAREA" || element.isContentEditable;
  if (event.key === "Enter") return multiline;
  return multiline || element.tagName === "SELECT";
}

/**
 * Keys a focused field consumes itself: caret movement and the edits that carry no character.
 *
 * Tab is here because a focus trap needs it: it only cancels the wrap at the first and last
 * tabbable element, and relies on the browser default for every move in between.
 *
 * Used to decide what a blocking layer may suppress while the user is typing. A key outside this
 * set and not a character belongs to the browser, not the field.
 */
const FIELD_KEYS = new Set([
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  // Shift+Insert pastes and carries no ctrl or meta, so it arrives here rather than at the
  // chord branch where Ctrl+Insert is recognised.
  "Insert",
  // Tab moves focus, and a blocking layer must NOT take it. The documented case for blocking is
  // a modal, whose focus trap only calls `preventDefault()` at the first and last tabbable
  // element — ordinary moves between the controls inside it rely on the browser default.
  // Suppressing every Tab therefore pinned focus to one control in exactly the situation
  // blocking exists to serve. A layer that genuinely wants Tab binds it.
  "Tab",
]);
