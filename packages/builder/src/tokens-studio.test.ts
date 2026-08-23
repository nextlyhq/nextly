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
  tokenCounts,
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

  it("labels every kind the engine defines", () => {
    // A kind added to the engine with no label here would draw a tab named
    // after its own identifier.
    for (const label of Object.values(TOKEN_KIND_LABELS)) {
      expect(label).not.toBe("");
    }
  });

  it("counts each kind for the tab", () => {
    expect(tokenCounts(TOKENS).color).toBe(2);
    expect(tokenCounts(TOKENS).dimension).toBe(1);
    expect(tokenCounts(TOKENS).shadow).toBe(0);
  });
});

describe("renaming a token keeps every reference resolving", () => {
  it("FREEZES the identity at the name it had", () => {
    const next = renameToken(TOKENS, "color.ink", "text.body");
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

    const after = declared(renameToken(TOKENS, "color.ink", "text.body"));
    expect(after).toContain("--site-color-ink");
    // And it did NOT start emitting the label instead.
    expect(after).not.toContain("--site-text-body");
  });

  it("is idempotent across repeated renames", () => {
    // The second rename must read the id the first froze, not re-pin to the
    // interim name — otherwise a token renamed twice loses its references on
    // the second edit rather than the first.
    const once = renameToken(TOKENS, "color.ink", "text.body");
    const twice = renameToken(once, "color.ink", "copy.default");
    const token = twice.tokens.find(t => t.name === "copy.default");
    expect(tokenIdentity(token as never)).toBe("color.ink");
    expect(declared(twice)).toContain("--site-color-ink");
  });

  it("renames a token that ALREADY has a frozen identity without moving it", () => {
    const next = renameToken(TOKENS, "color.primary", "brand.primary");
    const token = next.tokens.find(t => t.name === "brand.primary");
    expect(tokenIdentity(token as never)).toBe("color.primary");
    expect(declared(next)).toContain("--site-color-primary");
  });

  it("leaves the set alone for an identity it does not hold", () => {
    expect(renameToken(TOKENS, "nope", "x")).toEqual(TOKENS);
  });
});

describe("which names are refused", () => {
  it("refuses a name no reference could spell", () => {
    // Held to the ENGINE's grammar, which is what a stored `$token` is held to
    // — a table accepting a name references cannot name would hold tokens that
    // exist and resolve to nothing.
    expect(tokenNameIssue(TOKENS, "color.ink", "has spaces")).toBeDefined();
    expect(tokenNameIssue(TOKENS, "color.ink", "x:1}body{color")).toBeDefined();
  });

  it("refuses an empty name", () => {
    expect(tokenNameIssue(TOKENS, "color.ink", "   ")).toBeDefined();
  });

  it("refuses a name another token already reads under", () => {
    expect(tokenNameIssue(TOKENS, "color.ink", "brand.main")).toBeDefined();
  });

  it("allows a token to keep its own name", () => {
    // Comparing by name alone would report every token as colliding with
    // itself the moment its own field is validated.
    expect(tokenNameIssue(TOKENS, "color.ink", "color.ink")).toBeUndefined();
  });

  it("allows a good new name", () => {
    expect(tokenNameIssue(TOKENS, "color.ink", "text.body")).toBeUndefined();
  });
});

describe("editing a value", () => {
  it("writes one mode without disturbing the other", () => {
    const next = setTokenValue(TOKENS, "color.primary", "dark", "#1e3a8a");
    const token = next.tokens.find(t => t.name === "brand.main");
    expect(token?.values.dark).toBe("#1e3a8a");
    // Light is what a reader with no mode set resolves; losing it would make
    // the token vanish for them.
    expect(token?.values.light).toBe("#3b82f6");
  });

  it("clears a dark value so it FOLLOWS light again", () => {
    // Distinct from copying light into dark, which looks identical and is a
    // different document: an explicit dark value stops tracking later edits.
    const next = clearDarkValue(TOKENS, "color.primary");
    const token = next.tokens.find(t => t.name === "brand.main");
    expect(token?.values.dark).toBeUndefined();
    expect(token?.values.light).toBe("#3b82f6");
  });

  it("reports what the engine says about a value that contradicts its kind", () => {
    const next = setTokenValue(TOKENS, "color.ink", "light", "16px");
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
    const next = setTokenValue(
      TOKENS,
      "color.ink",
      "light",
      "url(https://e.test/a.png)"
    );
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
    const { tokens: next, identity } = addToken(TOKENS, "color");
    const row = tokenRowsFor(next, "color").find(r => r.identity === identity);
    expect(row).toBeDefined();
    // Seeded rather than empty: an empty value is refused by the emitter, so a
    // token created empty would arrive already broken.
    expect(row?.issues).toEqual([]);
    expect(declared(next)).toContain(`--site-${identity.replace(/\./g, "-")}`);
  });

  it("gives every kind a seed its own emitter accepts", () => {
    // The seeds are per-kind and easy to get wrong — `0px` is not a colour and
    // `#000000` is not a duration. Each is checked against the engine.
    for (const kind of Object.keys(
      TOKEN_KIND_LABELS
    ) as (keyof typeof TOKEN_KIND_LABELS)[]) {
      const { tokens: next, identity } = addToken({ tokens: [] }, kind);
      const row = tokenRowsFor(next, kind).find(r => r.identity === identity);
      expect(row?.issues, `${kind} seed`).toEqual([]);
    }
  });

  it("does not reuse a name, nor an identity a rename left behind", () => {
    // A renamed token keeps its old name as its IDENTITY, so a new token
    // taking that name would collide on the custom property.
    const renamed = renameToken(TOKENS, "color.ink", "text.body");
    const { identity } = addToken(renamed, "color");
    expect(identity).not.toBe("color.ink");
    expect(identity).not.toBe("text.body");
  });

  it("starts from nothing when the site has no table yet", () => {
    const { tokens: next } = addToken(undefined, "color");
    expect(next.tokens.length).toBe(1);
  });
});

describe("removing a token", () => {
  it("takes it out and leaves the rest", () => {
    const next = removeToken(TOKENS, "color.ink");
    expect(next.tokens.map(t => t.name)).toEqual(["brand.main", "space.4"]);
  });

  it("stops the site sheet declaring its property", () => {
    // What the warning in the panel is about: a page still referencing this
    // token compiles a `var()` nothing declares, so the declaration is dropped
    // and the style is absent with no error anywhere.
    expect(declared(TOKENS)).toContain("--site-color-ink");
    expect(declared(removeToken(TOKENS, "color.ink"))).not.toContain(
      "--site-color-ink"
    );
  });

  it("removes by IDENTITY, not by the label", () => {
    // Removing `brand.main` by name would miss it, because what identifies it
    // is `color.primary`.
    const next = removeToken(TOKENS, "color.primary");
    expect(next.tokens.map(t => t.name)).toEqual(["color.ink", "space.4"]);
  });
});
