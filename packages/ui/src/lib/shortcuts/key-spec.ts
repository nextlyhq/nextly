/**
 * Parsing and matching for keyboard shortcut specifications.
 *
 * A spec is written the way it is spoken: `"mod+s"`, `"Escape"`, `"shift+alt+f"`, and — for a
 * sequence — `"g d"`, meaning `g` then `d`. Steps are separated by spaces; within a step,
 * modifiers are joined to the key with `+`.
 *
 * The space bar is written `"Space"`, because the character the browser reports for it is `" "`
 * and a spec split on whitespace has no way to carry that.
 *
 * **`mod` is the point of this module.** It resolves to Command on Apple platforms and Control
 * everywhere else, so a binding is written once. Writing `ctrl` or `meta` explicitly is still
 * possible and then means exactly that, which is what lets a platform-specific binding coexist
 * with a portable one — a distinction lost by any implementation that treats the two as
 * interchangeable.
 *
 * @module lib/shortcuts/key-spec
 */

/**
 * One keystroke: a key plus the modifier state required with it.
 *
 * @experimental
 */
export interface KeyChord {
  /** The `KeyboardEvent.key` value, normalized to lower case for single characters. */
  readonly key: string;
  /** Command on Apple platforms, Control elsewhere. */
  readonly mod: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

/**
 * A shortcut: one chord, or several pressed in order.
 *
 * @experimental
 */
export type KeySequence = readonly KeyChord[];

/**
 * Named keys are compared exactly; single characters are compared case-insensitively.
 *
 * "Single character" is counted in CODE POINTS, matching the text-insertion path. A letter from
 * a supplementary plane occupies two UTF-16 units, so a length check on the string treats it as a
 * named key and skips the lowercasing — leaving its upper and lower case forms unable to match
 * each other, in a grammar that documents case-insensitive letters.
 */
function normalizeKey(key: string): string {
  return [...key].length === 1 ? key.toLowerCase() : key;
}

/**
 * Whether shift is part of what a caller can meaningfully require for this key.
 *
 * On a US layout `?` is already Shift+/, so the browser reports `key: "?"` with `shiftKey: true`.
 * A spec of `"?"` must therefore match an event that carries shift, or the most natural way to
 * write the binding would never fire. For letters and named keys the opposite holds: `"s"` must
 * NOT match Shift+S, or a binding would swallow a keystroke its author never claimed.
 *
 * The dividing line is whether the character itself already encodes the shift.
 */
export function shiftIsMeaningful(key: string): boolean {
  if (key.length > 1) return true;
  // Space is a single character that shift does NOT produce, so Shift+Space is a distinct
  // keystroke and a plain `"Space"` binding must not answer for it.
  if (key === " ") return true;
  // Unicode-aware on purpose: an ASCII-only test calls every non-Latin letter punctuation, so a
  // binding for `ж` would also answer for `Ж` on a Cyrillic layout and could swallow capitals.
  return /[\p{L}\p{N}]/u.test(key);
}

/**
 * Parse a spec into the sequence of chords it describes.
 *
 * @param spec - For example `"mod+s"`, `"Escape"`, or `"g d"`.
 * @throws If the spec is empty, or a step names modifiers but no key.
 *
 * @experimental
 */
export function parseKeys(spec: string): KeySequence {
  const steps = spec.trim().split(/\s+/).filter(Boolean);
  if (steps.length === 0) {
    throw new Error(`Shortcut spec is empty: ${JSON.stringify(spec)}`);
  }
  return steps.map(step => parseChord(step, spec));
}

function parseChord(step: string, spec: string): KeyChord {
  // A `+` is both this grammar's separator and a key people bind. A LONE `+` is the key, and a
  // TRAILING one is too: `mod++` is the usual zoom-in shortcut, and splitting it naively leaves
  // a chord carrying modifiers and no key at all. Spelling it `mod+shift+=` is not a substitute,
  // because the browser reports that keystroke as `key: "+"`.
  // The separator has to still be there for the trailing `+` to be a KEY: `mod++` is a modifier,
  // a separator and the plus key, while `mod+` is a modifier and a separator with nothing after
  // it. Accepting the second registered the zoom-in chord for a step that names no key at all,
  // and made the "no key" error unreachable for exactly the steps that need it.
  const trailingPlusIsKey = step.length > 2 && step.endsWith("++");
  const body = trailingPlusIsKey ? step.slice(0, -1) : step;
  const parts = step === "+" ? ["+"] : body.split("+").filter(Boolean);
  let mod = false;
  let ctrl = false;
  let meta = false;
  let alt = false;
  let shift = false;
  let key: string | undefined;

  for (const raw of parts) {
    switch (raw.toLowerCase()) {
      case "mod":
        mod = true;
        break;
      case "ctrl":
      case "control":
        ctrl = true;
        break;
      case "meta":
      case "cmd":
      case "command":
        meta = true;
        break;
      case "alt":
      case "option":
        alt = true;
        break;
      case "shift":
        shift = true;
        break;
      case "space":
        // The browser reports the space bar as `key: " "`, which cannot survive a spec split on
        // whitespace — `" "` trims to nothing and a literal `"Space"` matches no event. Without
        // this alias the space bar is simply unbindable, which rules out canvas panning and
        // play/pause.
        key = " ";
        break;
      default:
        if (key !== undefined) {
          throw new Error(
            `Shortcut step "${step}" names two keys ("${key}" and "${raw}") in ${JSON.stringify(spec)}`
          );
        }
        key = raw;
    }
  }

  if (trailingPlusIsKey) {
    if (key !== undefined) {
      throw new Error(
        `Shortcut step has more than one key: ${JSON.stringify(step)} in ${JSON.stringify(spec)}`
      );
    }
    key = "+";
  }

  if (key === undefined) {
    throw new Error(
      `Shortcut step "${step}" names modifiers but no key, in ${JSON.stringify(spec)}`
    );
  }
  return { key: normalizeKey(key), mod, ctrl, meta, alt, shift };
}

/**
 * The modifier state an event carries, with `mod` already resolved for the platform.
 *
 * @experimental
 */
export interface ModifierState {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  /** Optional, so a caller driving the matcher by hand need not synthesise one. */
  readonly getModifierState?: (key: string) => boolean;
}

/**
 * Whether a chord describes the given keystroke.
 *
 * Modifiers are matched EXACTLY rather than as a minimum: a binding for `s` must not fire on
 * `mod+s`, which is a different shortcut and very often a destructive one.
 *
 * @param chord - The chord to test.
 * @param key - The event's `key`.
 * @param state - The event's modifier flags.
 * @param isApple - Whether `mod` should resolve to Command rather than Control.
 *
 * @experimental
 */
export function chordMatches(
  chord: KeyChord,
  key: string,
  state: ModifierState,
  isApple: boolean
): boolean {
  if (normalizeKey(key) !== chord.key) return false;

  // `mod` and an explicit `ctrl`/`meta` are folded into one requirement per physical modifier, so
  // a spec may combine them (`"mod+ctrl+k"`) without either one being silently dropped.
  const wantsCtrl = chord.ctrl || (chord.mod && !isApple);
  const wantsMeta = chord.meta || (chord.mod && isApple);

  if (state.metaKey !== wantsMeta) return false;
  // AltGraph produces a CHARACTER and reports itself as Ctrl+Alt. A binding written for that
  // character — `@` on a layout that needs AltGraph for it — would never match if those synthetic
  // flags had to be declared, and declaring them (`ctrl+alt+@`) is layout-specific: the same
  // character needs no modifiers at all elsewhere. So they are ignored for a character key.
  //
  // Only when the chord asks for NEITHER, though. A spec that explicitly declares `ctrl+alt+@`
  // wants those modifiers held for real; ignoring them would let a plain AltGraph `@` fire it,
  // and because declared modifiers make a binding typing-enabled by default, that firing can
  // happen inside a field and suppress the character the user was typing.
  const altGraph = state.getModifierState?.("AltGraph") ?? false;
  const synthetic =
    altGraph && [...chord.key].length === 1 && !wantsCtrl && !chord.alt;
  if (!synthetic) {
    if (state.ctrlKey !== wantsCtrl) return false;
    if (state.altKey !== chord.alt) return false;
  }
  if (shiftIsMeaningful(chord.key) && state.shiftKey !== chord.shift)
    return false;
  return true;
}

/**
 * Whether this platform uses Command as its primary modifier.
 *
 * Reads the modern `userAgentData` hint before the deprecated `navigator.platform`, and answers
 * `false` when neither exists — the non-Apple default is also the correct answer for a server
 * render, where no keystroke can arrive.
 *
 * @experimental
 */
export function detectApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const candidate = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform =
    candidate.userAgentData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}
