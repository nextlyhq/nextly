/**
 * The words the editor says about a Design save that met someone else's
 * change: who is named, how the entries are listed, which sentence each kind
 * of conflict takes, and the undo and redo lines.
 *
 * @module admin/conflict-words.test
 */
import { describe, expect, it } from "vitest";

import type { EntryConflict } from "../site-style-merge";
import type { SaveConflicts } from "../site-style-versioned-save";

import {
  conflictWords,
  entryLabel,
  KEPT_CHANGING_WORDS,
  namedList,
} from "./conflict-words";

/** A variable as stored, with a display label. */
const token = (name: string, label?: string) => ({
  name,
  kind: "color",
  values: { light: "#123456" },
  ...(label === undefined ? {} : { label }),
});

/** A conflict over one variable, both sides present. */
function changed(
  name: string,
  label: string,
  over: Partial<EntryConflict> = {}
): EntryConflict {
  return {
    key: name,
    setting: false,
    kind: "changed",
    kept: "mine",
    base: token(name, label),
    mine: { ...token(name, label), values: { light: "#000000" } },
    theirs: { ...token(name, label), values: { light: "#ffffff" } },
    ...over,
  };
}

const PRIMARY = changed("color.primary", "Primary");
const ACCENT = changed("color.accent", "Accent");
const BODY = changed("color.body", "Body");
const MUTED = changed("color.muted", "Muted");

/** Conflicts after one refusal naming Sam, exactly one save between. */
const bySam = (...entries: EntryConflict[]): SaveConflicts => ({
  entries,
  refusal: { changedBy: { name: "Sam", kind: "person" }, oneSaveBetween: true },
});

describe("who is named", () => {
  it("names the person when exactly one save came between", () => {
    expect(conflictWords("tokens", bySam(PRIMARY))).toBe(
      "Sam changed Primary while you were editing. Your value was kept. Undo puts theirs back."
    );
  });

  it("says Someone when more than one save came between", () => {
    const conflicts: SaveConflicts = {
      entries: [PRIMARY],
      refusal: { changedBy: { name: "Sam" }, oneSaveBetween: false },
    };
    expect(conflictWords("tokens", conflicts)).toMatch(/^Someone changed /);
  });

  it("says Someone when no refusal sent the save back, or it named nobody", () => {
    // Merged onto a read that moved before the save: no refusal to read.
    expect(conflictWords("tokens", { entries: [PRIMARY] })).toMatch(
      /^Someone changed Primary /
    );
    expect(
      conflictWords("tokens", {
        entries: [PRIMARY],
        refusal: { changedBy: { name: null }, oneSaveBetween: true },
      })
    ).toMatch(/^Someone /);
    expect(
      conflictWords("tokens", {
        entries: [PRIMARY],
        refusal: { changedBy: { name: "  " }, oneSaveBetween: true },
      })
    ).toMatch(/^Someone /);
  });
});

describe("a forward save, mine kept", () => {
  it("says nothing for a clean merge", () => {
    expect(conflictWords("tokens", { entries: [] })).toBeUndefined();
    expect(conflictWords("tokens", undefined)).toBeUndefined();
  });

  it("lists two entries and says values in the plural", () => {
    expect(conflictWords("tokens", { entries: [PRIMARY, ACCENT] })).toBe(
      "Someone changed Primary and Accent while you were editing. Your values were kept. Undo puts theirs back."
    );
  });

  it("names two and counts the rest from three on", () => {
    expect(conflictWords("tokens", bySam(PRIMARY, ACCENT, BODY, MUTED))).toBe(
      "Sam changed Primary, Accent and 2 more while you were editing. Your values were kept. Undo puts theirs back."
    );
    expect(namedList(["Primary", "Accent", "Body"])).toBe(
      "Primary, Accent and 1 more"
    );
    expect(namedList(["Primary"])).toBe("Primary");
  });

  it("says they removed what mine changed, and that it was kept", () => {
    const removed = changed("color.primary", "Primary", {
      kind: "removed-by-them",
      theirs: undefined,
    });
    expect(conflictWords("tokens", bySam(removed))).toBe(
      "Sam removed Primary while you were editing it. It was kept, with your value. Undo removes it again."
    );
    expect(
      conflictWords("tokens", {
        entries: [
          removed,
          changed("color.accent", "Accent", {
            kind: "removed-by-them",
            theirs: undefined,
          }),
        ],
      })
    ).toBe(
      "Someone removed Primary and Accent while you were editing them. They were kept, with your values. Undo removes them again."
    );
  });

  it("says they changed what mine removed, and that it was removed", () => {
    const gone = changed("color.primary", "Primary", {
      kind: "removed-by-me",
      mine: undefined,
    });
    expect(conflictWords("tokens", bySam(gone))).toBe(
      "Sam changed Primary while you were removing it. It was removed. Undo brings it back with their value."
    );
    expect(
      conflictWords("tokens", {
        entries: [
          gone,
          changed("color.accent", "Accent", {
            kind: "removed-by-me",
            mine: undefined,
          }),
        ],
      })
    ).toBe(
      "Someone changed Primary and Accent while you were removing them. They were removed. Undo brings them back with their values."
    );
  });

  it("says each kind of conflict in its own sentence", () => {
    const removed = changed("color.accent", "Accent", {
      kind: "removed-by-them",
      theirs: undefined,
    });
    expect(conflictWords("tokens", bySam(PRIMARY, removed))).toBe(
      "Sam changed Primary while you were editing. Your value was kept. Undo puts theirs back. " +
        "Sam removed Accent while you were editing it. It was kept, with your value. Undo removes it again."
    );
  });
});

describe("an undo or redo, theirs kept", () => {
  const theirs = { ...PRIMARY, kept: "theirs" as const };

  it("says the change could not be undone, as the history says it", () => {
    expect(conflictWords("tokens", bySam(theirs), "undone")).toBe(
      "Sam changed Primary since, so your change to it could not be undone."
    );
  });

  it("says the change could not be redone", () => {
    expect(conflictWords("tokens", bySam(theirs), "redone")).toBe(
      "Sam changed Primary since, so your change to it could not be redone."
    );
  });

  it("says changes to them for several entries, and removed where they removed it", () => {
    const accent = { ...ACCENT, kept: "theirs" as const };
    expect(
      conflictWords("tokens", { entries: [theirs, accent] }, "undone")
    ).toBe(
      "Someone changed Primary and Accent since, so your changes to them could not be undone."
    );
    const removed = changed("color.primary", "Primary", {
      kind: "removed-by-them",
      kept: "theirs",
      theirs: undefined,
    });
    expect(conflictWords("tokens", bySam(removed), "redone")).toBe(
      "Sam removed Primary since, so your change to it could not be redone."
    );
    // Theirs changed what the replay would remove: changed, as above.
    const kept = changed("color.primary", "Primary", {
      kind: "removed-by-me",
      kept: "theirs",
      mine: undefined,
    });
    expect(conflictWords("tokens", bySam(kept), "undone")).toBe(
      "Sam changed Primary since, so your change to it could not be undone."
    );
  });
});

describe("naming an entry", () => {
  it("names a variable by its display label, derived when it has none", () => {
    expect(entryLabel("tokens", changed("color.brand-blue", ""))).toBe(
      "Brand blue"
    );
  });

  it("names a shared style by its label, else its class name", () => {
    const card = { id: "c1", slug: "card", label: "Promo card", styles: {} };
    const conflict: EntryConflict = {
      key: "c1",
      setting: false,
      kind: "changed",
      kept: "mine",
      base: card,
      mine: card,
      theirs: card,
    };
    expect(entryLabel("classes", conflict)).toBe("Promo card");
    const bare = { id: "c1", slug: "card", styles: {} };
    expect(
      entryLabel("classes", {
        ...conflict,
        base: bare,
        mine: bare,
        theirs: bare,
      })
    ).toBe("card");
    // A rename both made names the style as both started from it.
    expect(
      entryLabel("classes", {
        ...conflict,
        mine: { ...card, label: "Mine" },
        theirs: { ...card, label: "Theirs" },
      })
    ).toBe("Promo card");
    // One only mine holds is named as mine has it.
    expect(
      entryLabel("classes", { ...conflict, base: undefined, theirs: undefined })
    ).toBe("Promo card");
  });

  it("names a font by its family, once for several of its faces", () => {
    const face = (weight: string) => ({
      family: "Lora",
      weight,
      style: "normal",
      src: [{ url: `/api/media/${weight}/raw` }],
    });
    const of = (weight: string): EntryConflict => ({
      key: `Lora|${weight}`,
      setting: false,
      kind: "removed-by-me",
      kept: "mine",
      base: undefined,
      mine: undefined,
      theirs: face(weight),
    });
    expect(conflictWords("fonts", bySam(of("400"), of("700")))).toBe(
      "Sam changed Lora while you were removing it. It was removed. Undo brings it back with their value."
    );
  });

  it("names a token setting in words, and an unnamed entry by its key", () => {
    const prefix: EntryConflict = {
      key: "prefix",
      setting: true,
      kind: "changed",
      kept: "mine",
      base: "site",
      mine: "brand",
      theirs: "acme",
    };
    expect(conflictWords("tokens", bySam(prefix))).toBe(
      "Sam changed the variable prefix while you were editing. Your value was kept. Undo puts theirs back."
    );
    expect(
      entryLabel("classes", { ...prefix, setting: false, key: "c9" })
    ).toBe("c9");
  });
});

describe("a save that never landed", () => {
  it("says the design kept changing", () => {
    expect(KEPT_CHANGING_WORDS).toBe(
      "The site's design kept changing while this was saved, so it was not saved. Try again."
    );
  });
});
