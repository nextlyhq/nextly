/**
 * The site's definitions from one stored record of the Site Style Single:
 * the one reading the validation and the judgement under the composition
 * graph lock both resolve the record by, whichever connection read it.
 */
import { describe, expect, it, vi } from "vitest";

import {
  siteDefinitionsOfDocument,
  siteStyleDocumentOn,
} from "./site-definitions";
import type { SiteStyleData } from "./site-style";
import { withProvisionalVariables } from "./transfer/provisional-variables";

const variable = (id: string) => ({
  id,
  name: `color.${id}`,
  kind: "color",
  values: { light: "#123456" },
});
const sharedStyle = (id: string) => ({
  id,
  slug: id,
  orderIndex: 0,
  styles: { base: { base: { color: "#111111" } } },
});

/** The code's style: one variable and one shared style of its own. */
const defaults: SiteStyleData = {
  tokens: { tokens: [variable("t-code")] },
  classes: [sharedStyle("c-code")],
} as SiteStyleData;

/** A stored record defining `t-stored`, `c-stored` and a `tablet` breakpoint. */
const stored = {
  id: "the-single",
  tokens: { tokens: [variable("t-stored")] },
  classes: [sharedStyle("c-stored")],
  breakpoints: {
    viewport: [
      { id: "base", label: "Base" },
      { id: "tablet", label: "Tablet", maxWidth: 900 },
    ],
    container: [],
  },
};

describe("the site's definitions from a stored record", () => {
  it("merges the stored sections over the code's, as the stylesheet resolves them", async () => {
    const found = await siteDefinitionsOfDocument(stored, defaults);
    expect(found.tokenIds).toContain("t-code");
    expect(found.tokenIds).toContain("t-stored");
    expect(found.classIds).toContain("c-code");
    expect(found.classIds).toContain("c-stored");
    expect(found.breakpointIds).toContain("tablet");
  });

  it("reads the sections as SQLite stores them, as text, the same", async () => {
    const asText = {
      tokens: JSON.stringify(stored.tokens),
      classes: JSON.stringify(stored.classes),
      breakpoints: JSON.stringify(stored.breakpoints),
    };
    const fromText = await siteDefinitionsOfDocument(asText, defaults);
    const fromValues = await siteDefinitionsOfDocument(stored, defaults);
    expect([...fromText.tokenIds].sort()).toEqual(
      [...fromValues.tokenIds].sort()
    );
    expect([...fromText.classIds].sort()).toEqual(
      [...fromValues.classIds].sort()
    );
    expect([...fromText.breakpointIds].sort()).toEqual(
      [...fromValues.breakpointIds].sort()
    );
  });

  it("answers the code's alone for a Single nothing has been stored in", async () => {
    const found = await siteDefinitionsOfDocument(null, defaults);
    expect(found.tokenIds).toContain("t-code");
    expect(found.tokenIds).not.toContain("t-stored");
    expect(found.classIds).toContain("c-code");
    expect(found.classIds).not.toContain("c-stored");
  });

  it("counts an import's provisional variables only inside its judging writes", async () => {
    const inside = await withProvisionalVariables(["t-incoming"], () =>
      siteDefinitionsOfDocument(stored, defaults)
    );
    expect(inside.tokenIds).toContain("t-incoming");
    expect(inside.tokenIds).toContain("t-stored");
    // CONTROL: the same record outside one counts none.
    const outside = await siteDefinitionsOfDocument(stored, defaults);
    expect(outside.tokenIds).not.toContain("t-incoming");
  });
});

describe("the Site Style Single, read on a write's transaction", () => {
  it("reads it plainly, with no row lock, on the transaction it is handed", async () => {
    const getSingleInTransaction = vi.fn(async () => stored);
    const transaction = { transaction: "the write's own" } as never;
    const read = siteStyleDocumentOn(
      { getSingleInTransaction } as never,
      "site-style"
    );

    expect(await read(transaction)).toBe(stored);
    // Exactly the plain read: a share lock here would wait for a removal
    // holding the Single's row while that removal waits for the graph lock
    // this write holds.
    expect(getSingleInTransaction.mock.calls).toEqual([
      [transaction, "site-style", { lock: "none" }],
    ]);
  });
});
