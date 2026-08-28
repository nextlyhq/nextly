/**
 * The hint's spelling, which is the half `keyboard-actions` cannot check.
 *
 * That module decides WHICH keystroke moves a block. What is only true here is
 * that the sentence shown to an author names the key their keyboard actually
 * carries, and that a spec this cannot read produces nothing rather than a
 * plausible wrong answer.
 *
 * @module key-hint.test
 */
import { describe, expect, it } from "vitest";

import { keyHint } from "./key-hint";

describe("a binding spelled for a person", () => {
  it("names the key the platform carries, not the one the spec does", () => {
    // The same physical key, two labels. A fixed string is wrong on one of the
    // two platforms, which is the reason the toolbar showed no hint at all.
    expect(keyHint("alt+ArrowUp", false)).toBe("Alt+↑");
    expect(keyHint("alt+ArrowUp", true)).toBe("⌥↑");
  });

  it("resolves `mod` to the modifier that platform actually uses", () => {
    /*
     * `mod` is the spelling the whole editor uses, and it is the case where a
     * retyped hint does real harm: "Ctrl+D" on a Mac teaches a keystroke that
     * does nothing at all.
     */
    expect(keyHint("mod+d", false)).toBe("Ctrl+D");
    expect(keyHint("mod+d", true)).toBe("⌘D");
  });

  it("draws an arrow as an arrow and leaves a named key its name", () => {
    // A key whose name is written on it reads better as that name; only the
    // arrows are glyphs on the keyboard and words in the spec.
    expect(keyHint("ArrowLeft", false)).toBe("←");
    expect(keyHint("Enter", false)).toBe("Enter");
  });

  it("shows nothing for a spec it cannot read", () => {
    /*
     * A hint is a promise that pressing something does something. A spec this
     * cannot parse is one whose keystroke it does not know, so the honest
     * answer is silence — the same judgement the toolbar made.
     */
    expect(keyHint("", false)).toBeNull();
    expect(keyHint("alt+", false)).toBeNull();
  });

  it("keeps a `+` that is a KEY rather than a separator", () => {
    /*
     * The grammar's own edge, and the reason this parses rather than splits:
     * `mod++` is the zoom-in chord — a modifier, a separator, and the plus key
     * — while a naive split leaves a chord carrying modifiers and no key.
     */
    expect(keyHint("mod++", false)).toBe("Ctrl++");
  });
});
