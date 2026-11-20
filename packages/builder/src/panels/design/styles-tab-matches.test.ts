import { BASE_BREAKPOINT, type NamedClass } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { stylesTabMatches } from "./styles-tab-matches";

const LIBRARY: readonly NamedClass[] = [
  {
    id: "c-card",
    slug: "card",
    orderIndex: 0,
    label: "Card",
    styles: {
      base: { [BASE_BREAKPOINT]: { padding: { blockStart: "1rem" } } },
    },
  },
  {
    id: "c-muted",
    slug: "muted",
    orderIndex: 1,
    label: "Muted label",
    styles: { base: { [BASE_BREAKPOINT]: { color: "#6b7280" } } },
  },
];

describe("how many of the Styles tab's styles a search matches", () => {
  it("counts the shared styles the Styles tab would list for the search", () => {
    expect(stylesTabMatches(LIBRARY, undefined, "card", undefined)).toBe(1);
    expect(stylesTabMatches(LIBRARY, undefined, "label", undefined)).toBe(1);
    // By what a style sets, as the tab's search finds it.
    expect(stylesTabMatches(LIBRARY, undefined, "padding", undefined)).toBe(1);
    expect(stylesTabMatches(LIBRARY, undefined, "zzz", undefined)).toBe(0);
  });

  it("counts nothing while there is no search or no library", () => {
    expect(stylesTabMatches(LIBRARY, undefined, "  ", undefined)).toBe(0);
    expect(stylesTabMatches(undefined, undefined, "card", undefined)).toBe(0);
  });
});
