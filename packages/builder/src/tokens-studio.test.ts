/**
 * The tokens studio's rules, without a panel around them.
 *
 * The one that matters most is the rename, and it is the reason this file
 * exists apart from the panel test: a rename that moves the identity breaks
 * every stored reference on the site and NOTHING reports it — the custom
 * property moves, the reference resolves to nothing, the declaration is
 * dropped, and the page renders with the style simply absent. There is no
 * error, no console warning and no visual difference on the page being edited.
 * So it is asserted here directly, against the engine's own compiler, rather
 * than inferred from a rendered row.
 *
 * @module tokens-studio.test
 */
import {
  compileSiteSheet,
  emitTokenBlocks,
  tokenIdentity,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  TOKEN_KIND_LABELS,
  addToken,
  clearDarkValue,
  removeToken,
  renameToken,
  setTokenValue,
  tokenNameIssue,
  tokenRowsFor,
} from "./tokens-studio";

const BREAKPOINTS = { base: { id: "base", label: "Base" } } as never;

/** A site with one plain token and one already renamed, so the two differ. */
const TOKENS: SiteTokenSet = {
  tokens: [
    { name: "color.ink", kind: "color", values: { light: "#111111" } },
    {
      id: "color.primary",
      name: "brand.main",
      kind: "color",
      values: { light: "#3b82f6", dark: "#93c5fd" },
    },
    { name: "space.4", kind: "dimension", values: { light: "1rem" } },
  ],
};

/** Every `--custom-property` a compiled site sheet DECLARES. */
function declared(set: SiteTokenSet): string[] {
  const sheet = compileSiteSheet({ tokens: set, breakpoints: BREAKPOINTS });
  return [...sheet.css.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)].map(
    m => m[1] ?? ""
  );
}

describe("what each tab shows", () => {
  it("lists only the tokens of that kind, in stored order", () => {
    expect(tokenRowsFor(TOKENS, "color").map(r => r.name)).toEqual([
      "color.ink",
      "brand.main",
    ]);
    expect(tokenRowsFor(TOKENS, "dimension").map(r => r.name)).toEqual([
      "space.4",
    ]);
  });

  it("carries the IDENTITY beside the name, which differ after a rename", () => {
    const row = tokenRowsFor(TOKENS, "color").find(
      r => r.name === "brand.main"
    );
    expect(row?.identity).toBe("color.primary");
  });

  it("shows the dark value in dark, and marks a light fallback as inherited", () => {
    const dark = tokenRowsFor(TOKENS, "color", "dark");
    expect(dark.find(r => r.name === "brand.main")?.value).toBe("#93c5fd");
    expect(dark.find(r => r.name === "brand.main")?.inherited).toBe(false);
    // `color.ink` defines only light, so dark resolves to it and says so.
    expect(dark.find(r => r.name === "color.ink")?.value).toBe("#111111");
    expect(dark.find(r => r.name === "color.ink")?.inherited).toBe(true);
  });

  it("answers with nothing when no table has been supplied", () => {
    expect(tokenRowsFor(undefined, "color")).toEqual([]);
  });

  it("gives a property to the token the EMITTER wrote, not the first stored", () => {
    /*
     * A token refused before `seen` is updated — a bad name, no light value, an
     * unusable value, or a value that fetches — claims no custom property, so a
     * later token with the same one is emitted normally.
     *
     * Ranking by stored position told that written token only the refused one
     * survives, which is the opposite of the compiled page. `color.primary`
     * here carries a value the guard rejects, so `color-primary` is what the
     * page resolves.
     */
    const clashing: SiteTokenSet = {
      tokens: [
        { name: "color.primary", kind: "color", values: { light: "red;}" } },
        { name: "color-primary", kind: "color", values: { light: "#00ff00" } },
      ],
    };
    // The emitter is the oracle: it is what the page is compiled from.
    const written = emitTokenBlocks(clashing, ":root").emitted.map(t => t.name);
    expect(written).toEqual(["color-primary"]);

    const rows = tokenRowsFor(clashing, "color");
    const survivor = rows.find(row => row.name === "color-primary");
    expect(survivor?.issues.some(issue => /both become/.test(issue))).toBe(
      false
    );
  });

  it("labels every kind the engine defines", () => {
    // A kind added to the engine with no label here would draw a tab named
    // after its own identifier.
    for (const label of Object.values(TOKEN_KIND_LABELS)) {
      expect(label).not.toBe("");
    }
  });
});

describe("renaming a token keeps every reference resolving", () => {
  it("FREEZES the identity at the name it had", () => {
    const next = renameToken(TOKENS, 0, "text.body");
    const token = next.tokens.find(t => t.name === "text.body");
    expect(token).toBeDefined();
    // The label moved; the identity is pinned at the original name.
    expect(tokenIdentity(token as never)).toBe("color.ink");
  });

  it("keeps emitting the SAME custom property a document already references", () => {
    // The assertion that matters, made against the real compiler rather than
    // against the token record: a document storing `color.ink` compiles to
    // `var(--site-color-ink)`, and that property must survive the rename.
    const before = declared(TOKENS);
    expect(before).toContain("--site-color-ink");

    const after = declared(renameToken(TOKENS, 0, "text.body"));
    expect(after).toContain("--site-color-ink");
    // And it did NOT start emitting the label instead.
    expect(after).not.toContain("--site-text-body");
  });

  it("is idempotent across repeated renames", () => {
    // The second rename must read the id the first froze, not re-pin to the
    // interim name — otherwise a token renamed twice loses its references on
    // the second edit rather than the first.
    const once = renameToken(TOKENS, 0, "text.body");
    const twice = renameToken(once, 0, "copy.default");
    const token = twice.tokens.find(t => t.name === "copy.default");
    expect(tokenIdentity(token as never)).toBe("color.ink");
    expect(declared(twice)).toContain("--site-color-ink");
  });

  it("renames a token that ALREADY has a frozen identity without moving it", () => {
    const next = renameToken(TOKENS, 1, "brand.primary");
    const token = next.tokens.find(t => t.name === "brand.primary");
    expect(tokenIdentity(token as never)).toBe("color.primary");
    expect(declared(next)).toContain("--site-color-primary");
  });

  it("leaves the set alone for a position it does not hold", () => {
    expect(renameToken(TOKENS, 99, "x")).toEqual(TOKENS);
  });
});

describe("which names are refused", () => {
  it("refuses a name no reference could spell", () => {
    // Held to the ENGINE's grammar, which is what a stored `$token` is held to
    // — a table accepting a name references cannot name would hold tokens that
    // exist and resolve to nothing.
    expect(tokenNameIssue(TOKENS, 0, "has spaces")).toBeDefined();
    expect(tokenNameIssue(TOKENS, 0, "x:1}body{color")).toBeDefined();
  });

  it("refuses an empty name", () => {
    expect(tokenNameIssue(TOKENS, 0, "   ")).toBeDefined();
  });

  it("refuses a name another token already reads under", () => {
    expect(tokenNameIssue(TOKENS, 0, "brand.main")).toBeDefined();
  });

  it("allows a token to keep its own name", () => {
    // Comparing by name alone would report every token as colliding with
    // itself the moment its own field is validated.
    expect(tokenNameIssue(TOKENS, 0, "color.ink")).toBeUndefined();
  });

  it("allows a good new name", () => {
    expect(tokenNameIssue(TOKENS, 0, "text.body")).toBeUndefined();
  });
});

describe("editing a value", () => {
  it("writes one mode without disturbing the other", () => {
    const next = setTokenValue(TOKENS, 1, "dark", "#1e3a8a");
    const token = next.tokens.find(t => t.name === "brand.main");
    expect(token?.values.dark).toBe("#1e3a8a");
    // Light is what a reader with no mode set resolves; losing it would make
    // the token vanish for them.
    expect(token?.values.light).toBe("#3b82f6");
  });

  it("clears a dark value so it FOLLOWS light again", () => {
    // Distinct from copying light into dark, which looks identical and is a
    // different document: an explicit dark value stops tracking later edits.
    const next = clearDarkValue(TOKENS, 1);
    const token = next.tokens.find(t => t.name === "brand.main");
    expect(token?.values.dark).toBeUndefined();
    expect(token?.values.light).toBe("#3b82f6");
  });

  it("reports what the engine says about a value that contradicts its kind", () => {
    const next = setTokenValue(TOKENS, 0, "light", "16px");
    const row = tokenRowsFor(next, "color").find(
      r => r.identity === "color.ink"
    );
    expect(row?.issues.length).toBeGreaterThan(0);
    expect(row?.issues.join(" ")).toContain("not a colour");
  });

  it("says nothing about a value the engine is happy with", () => {
    const row = tokenRowsFor(TOKENS, "color").find(
      r => r.identity === "color.ink"
    );
    expect(row?.issues).toEqual([]);
  });

  it("reports a value that would make the page fetch a file", () => {
    const next = setTokenValue(TOKENS, 0, "light", "url(https://e.test/a.png)");
    const row = tokenRowsFor(next, "color").find(
      r => r.identity === "color.ink"
    );
    expect(row?.issues.join(" ")).toContain("load a file");
  });
});

describe("two tokens that collide on one custom property", () => {
  it("names the collision on the token that LOSES it", () => {
    // `color.primary-dark` and `color-primary.dark` both become
    // `--site-color-primary-dark`. The emitter writes the first and refuses
    // the second, so an author editing the second sees no effect on the page.
    const clashing: SiteTokenSet = {
      tokens: [
        {
          name: "color.primary-dark",
          kind: "color",
          values: { light: "#111" },
        },
        {
          name: "color-primary.dark",
          kind: "color",
          values: { light: "#222" },
        },
      ],
    };
    const rows = tokenRowsFor(clashing, "color");
    expect(rows[0]?.issues).toEqual([]);
    expect(rows[1]?.issues.join(" ")).toContain("both become");
  });
});

describe("adding a token", () => {
  it("appends a valid token the engine will write", () => {
    const { tokens: next, at } = addToken(TOKENS, "color");
    const row = tokenRowsFor(next, "color").find(r => r.at === at);
    expect(row).toBeDefined();
    // Seeded rather than empty: an empty value is refused by the emitter, so a
    // token created empty would arrive already broken.
    expect(row?.issues).toEqual([]);
    expect(declared(next)).toContain(
      `--site-${(row?.identity ?? "").replace(/\./g, "-")}`
    );
  });

  it("gives every kind a seed its own emitter accepts", () => {
    // The seeds are per-kind and easy to get wrong — `0px` is not a colour and
    // `#000000` is not a duration. Each is checked against the engine.
    for (const kind of Object.keys(
      TOKEN_KIND_LABELS
    ) as (keyof typeof TOKEN_KIND_LABELS)[]) {
      const { tokens: next, at } = addToken({ tokens: [] }, kind);
      const row = tokenRowsFor(next, kind).find(r => r.at === at);
      expect(row?.issues, `${kind} seed`).toEqual([]);
    }
  });

  it("does not reuse a name, nor an identity a rename left behind", () => {
    // A renamed token keeps its old name as its IDENTITY, so a new token
    // taking that name would collide on the custom property.
    const renamed = renameToken(TOKENS, 0, "text.body");
    const { tokens: next, at } = addToken(renamed, "color");
    const name = next.tokens[at]?.name;
    expect(name).not.toBe("color.ink");
    expect(name).not.toBe("text.body");
  });

  it("starts from nothing when the site has no table yet", () => {
    const { tokens: next, at } = addToken(undefined, "color");
    expect(next.tokens.length).toBe(1);
    expect(at).toBe(0);
  });
});

describe("removing a token", () => {
  it("takes it out and leaves the rest", () => {
    const next = removeToken(TOKENS, 0);
    expect(next.tokens.map(t => t.name)).toEqual(["brand.main", "space.4"]);
  });

  it("stops the site sheet declaring its property", () => {
    // What the warning in the panel is about: a page still referencing this
    // token compiles a `var()` nothing declares, so the declaration is dropped
    // and the style is absent with no error anywhere.
    expect(declared(TOKENS)).toContain("--site-color-ink");
    expect(declared(removeToken(TOKENS, 0))).not.toContain("--site-color-ink");
  });

  it("removes by IDENTITY, not by the label", () => {
    // Removing `brand.main` by name would miss it, because what identifies it
    // is `color.primary`.
    const next = removeToken(TOKENS, 1);
    expect(next.tokens.map(t => t.name)).toEqual(["color.ink", "space.4"]);
  });
});

describe("two entries that share one identity are addressed apart", () => {
  /**
   * A set a legacy or imported document can really hold. The read path keeps
   * BOTH so the engine's complaint about the collision is visible on the row
   * that has it — which is the whole point, since this is the state the studio
   * exists to help an author repair.
   */
  const twinned: SiteTokenSet = {
    tokens: [
      { name: "color.dup", kind: "color", values: { light: "#111111" } },
      { name: "color.dup", kind: "color", values: { light: "#222222" } },
    ],
  };

  it("shows both rows, with the collision named on the second", () => {
    const rows = tokenRowsFor(twinned, "color");
    expect(rows.map(r => r.at)).toEqual([0, 1]);
    expect(rows[0]?.issues).toEqual([]);
    expect(rows[1]?.issues.join(" ")).toContain("both become");
  });

  it("edits the row the author is on, not the first one that matches", () => {
    // Addressed by identity, every edit to the second row would land on the
    // first — so the collision could never be repaired from the row that has
    // it, and an author would watch the wrong value change.
    const next = setTokenValue(twinned, 1, "light", "#333333");
    expect(next.tokens[0]?.values.light).toBe("#111111");
    expect(next.tokens[1]?.values.light).toBe("#333333");
  });

  it("renames only the row the author is on", () => {
    const next = renameToken(twinned, 1, "color.other");
    expect(next.tokens[0]?.name).toBe("color.dup");
    expect(next.tokens[1]?.name).toBe("color.other");
  });

  it("removes ONE of them, not both", () => {
    // Filtering on the identity takes both, which is the opposite of what
    // repairing a collision means.
    const next = removeToken(twinned, 1);
    expect(next.tokens.length).toBe(1);
    expect(next.tokens[0]?.values.light).toBe("#111111");
  });

  it("does not report a name collision against the row being edited", () => {
    // Row 1 keeping its own name is not a clash with itself; row 1 taking
    // row 0's name is.
    expect(tokenNameIssue(twinned, 1, "color.dup")).toBeDefined();
    expect(tokenNameIssue(twinned, 0, "color.dup")).toBeDefined();
    expect(tokenNameIssue(twinned, 1, "color.fresh")).toBeUndefined();
  });
});

describe("a generated name is free as a CUSTOM PROPERTY, not as a string", () => {
  it("skips a candidate whose property another spelling already took", () => {
    // `color-2` and `color.2` are different strings and both become
    // `--site-color-2`. A raw-name check hands back `color.2` and the emitter
    // refuses it the moment it is written.
    const set: SiteTokenSet = {
      tokens: [
        { name: "color", kind: "color", values: { light: "#111111" } },
        { name: "color-2", kind: "color", values: { light: "#222222" } },
      ],
    };
    const { tokens: next, at } = addToken(set, "color");
    const added = next.tokens[at];
    expect(added).toBeDefined();
    // Whatever it chose, the ENGINE has to accept the whole set.
    expect(emitTokenBlocks(next, ":root").issues).toEqual([]);
    expect(added?.name).not.toBe("color.2");
  });
});

describe("the seed for a custom token survives being USED", () => {
  it("substitutes into a declaration rather than invalidating it", () => {
    // A CSS-wide keyword passes the emitter and is written without complaint,
    // then behaves as the guaranteed-invalid value at SUBSTITUTION — so
    // `var(--site-custom)` would invalidate the declaration reading it. The
    // emitter cannot see that, so asserting it is happy proves nothing.
    const { tokens: next, at } = addToken({ tokens: [] }, "custom");
    const seeded = next.tokens[at]?.values.light ?? "";
    expect(seeded).not.toBe("");
    const CSS_WIDE = ["initial", "inherit", "unset", "revert", "revert-layer"];
    expect(CSS_WIDE).not.toContain(seeded.trim().toLowerCase());
  });
});

describe("a row key that survives a removal elsewhere in the list", () => {
  const set: SiteTokenSet = {
    tokens: [
      { name: "color.a", kind: "color", values: { light: "#111111" } },
      { name: "color.b", kind: "color", values: { light: "#222222" } },
      { name: "color.c", kind: "color", values: { light: "#333333" } },
    ],
  };

  it("keeps a survivor's key when an EARLIER row is removed", () => {
    // The position cannot be the key: deleting a non-tail token shifts every
    // following `at`, so React reuses the deleted row's component for its
    // successor — carrying the uncontrolled fields and the confirm state onto
    // a different token.
    const before = tokenRowsFor(set, "color");
    const after = tokenRowsFor(removeToken(set, 0), "color");
    expect(before.map(r => r.at)).toEqual([0, 1, 2]);
    expect(after.map(r => r.at)).toEqual([0, 1]);
    // The positions shifted; the keys did not.
    expect(after.map(r => r.key)).toEqual(before.slice(1).map(r => r.key));
  });

  it("is unique when two entries share an identity", () => {
    // The reason the identity alone cannot be the key either.
    const twinned: SiteTokenSet = {
      tokens: [
        { name: "color.dup", kind: "color", values: { light: "#111111" } },
        { name: "color.dup", kind: "color", values: { light: "#222222" } },
      ],
    };
    const keys = tokenRowsFor(twinned, "color").map(r => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not change when a row is renamed", () => {
    // A rename freezes the identity, so the key rides that rather than the
    // label — a row must not remount because its name was edited.
    const renamed = renameToken(set, 1, "color.renamed");
    expect(tokenRowsFor(renamed, "color")[1]?.key).toBe(
      tokenRowsFor(set, "color")[1]?.key
    );
  });
});

describe("two names that land on one custom property", () => {
  // The name-to-property mapping is deliberately not injective: a dot and a
  // dash both become a dash. So two visibly different, individually legal names
  // can be written under one property, and the compiler drops whichever it
  // reaches second — leaving a token the author can see in the table and cannot
  // find on the page.
  const pair = {
    tokens: [
      {
        name: "color.primary-dark",
        kind: "color",
        values: { light: "#111111" },
      },
    ],
  } as SiteTokenSet;

  it("refuses the spelling that collides, though the names differ", () => {
    expect(tokenNameIssue(pair, 1, "color-primary.dark")).toBeDefined();
  });

  it("refuses a NEW row claiming an identity another row has frozen", () => {
    // A renamed token keeps its old name as its identity under a new label, so
    // that name is taken even though no row READS under it any more. Suppressing
    // the clash whenever identities match would let the new row claim it, and
    // the compiler writes the older token and drops this one.
    const frozen = {
      tokens: [
        {
          id: "color.primary",
          name: "color.brand",
          kind: "color",
          values: { light: "#111111" },
        },
      ],
    } as SiteTokenSet;
    expect(tokenNameIssue(frozen, 1, "color.primary")).toBeDefined();
  });

  it("accepts a spelling that lands somewhere else", () => {
    // The control. A gate refusing every name would satisfy the case above and
    // make the studio unusable.
    expect(tokenNameIssue(pair, 1, "color.primary-light")).toBeUndefined();
  });
});
