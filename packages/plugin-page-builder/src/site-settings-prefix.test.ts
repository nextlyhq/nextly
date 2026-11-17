/**
 * The site's CSS variable prefix as Settings reads it: which tier sets it,
 * and how many places name a variable through the old prefix in CSS text
 * (what a change leaves without its colour).
 */
import type { NamedClass, SiteTokenSet } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { oldPrefixUses } from "./site-settings";
import { siteCssPrefix, type SiteStyleData } from "./site-style";
import type { DocumentsUsing } from "./usage-count";
import type { UsageIndexHealth } from "./usage-index-health";

describe("siteCssPrefix", () => {
  it("is --site- with nothing set", () => {
    expect(siteCssPrefix(undefined, undefined)).toEqual({ current: "--site-" });
  });

  it("reports the code's prefix as the one written when nothing is saved", () => {
    const code: SiteStyleData = { tokens: { tokens: [], prefix: "--acme-" } };
    expect(siteCssPrefix(code, undefined)).toEqual({
      current: "--acme-",
      code: "--acme-",
    });
  });

  it("writes under a saved prefix over the code's", () => {
    const code: SiteStyleData = { tokens: { tokens: [], prefix: "--acme-" } };
    const saved: SiteStyleData = { tokens: { tokens: [], prefix: "--brand-" } };
    expect(siteCssPrefix(code, saved)).toEqual({
      current: "--brand-",
      code: "--acme-",
      stored: "--brand-",
    });
  });

  it("reports the prefix the engine actually writes under for a refused one", () => {
    const code: SiteStyleData = { tokens: { tokens: [], prefix: "--nx-" } };
    expect(siteCssPrefix(code, undefined).current).toBe("--site-");
  });
});

const HEALTH: UsageIndexHealth = {
  coversExistingDocuments: true,
  anyUndetermined: false,
};

/** A usage index answering `byKey` for the keys asked, recording them. */
function index(
  byKey: Record<string, DocumentsUsing>,
  health: UsageIndexHealth = HEALTH
) {
  const asked: string[][] = [];
  return {
    asked,
    usage: {
      health: async () => health,
      documentsUsingEach: async (keys: readonly string[]) => {
        asked.push([...keys]);
        return new Map(
          keys.flatMap(key =>
            byKey[key] === undefined ? [] : [[key, byKey[key]] as const]
          )
        );
      },
    },
  };
}

const tokens: SiteTokenSet = {
  tokens: [
    { name: "color.brand", kind: "color", values: { light: "#0055ff" } },
    {
      name: "shadow.card",
      kind: "shadow",
      values: { light: "0 1px 2px var(--site-color-brand)" },
    },
  ],
};

const classes: NamedClass[] = [
  {
    id: "glow",
    slug: "glow",
    orderIndex: 0,
    styles: {
      base: { base: { "box-shadow": "0 0 4px var(--site-color-brand)" } },
    },
  },
  {
    // Named by identity: compiled under whichever prefix, so not counted.
    id: "ink",
    slug: "ink",
    orderIndex: 1,
    styles: { base: { base: { color: { $token: "color.brand" } } } },
  },
];

describe("oldPrefixUses", () => {
  it("counts each variable, shared style and document naming a variable through var()", async () => {
    const { usage, asked } = index({
      "var:--site-color-brand": {
        collections: [{ collection: "pages", documents: ["p1", "p2", null] }],
        complete: true,
      },
    });
    const uses = await oldPrefixUses({ tokens, classes }, "--site-", usage);
    // The shadow variable, the glow style, pages p1 and p2, and one row
    // naming no document.
    expect(uses).toEqual({ count: 5, complete: true });
    // Only the properties are asked about, never the identities a `$token`
    // reference stores.
    expect(asked.flat().every(key => key.startsWith("var:"))).toBe(true);
    expect(asked.flat()).toContain("var:--site-color-brand");
  });

  it("counts nothing that names a variable under another prefix", async () => {
    const { usage } = index({});
    const uses = await oldPrefixUses(
      {
        tokens: {
          ...tokens,
          tokens: [
            tokens.tokens[0]!,
            {
              name: "shadow.card",
              kind: "shadow",
              values: { light: "0 1px 2px var(--other-color-brand)" },
            },
          ],
        },
      },
      "--site-",
      usage
    );
    expect(uses).toEqual({ count: 0, complete: true });
  });

  it("says the count is a lower bound while the index is not whole", async () => {
    const { usage } = index({}, { ...HEALTH, anyUndetermined: true });
    expect((await oldPrefixUses({ tokens }, "--site-", usage)).complete).toBe(
      false
    );
    expect(
      (await oldPrefixUses({ tokens }, "--site-", undefined)).complete
    ).toBe(false);
  });
});
