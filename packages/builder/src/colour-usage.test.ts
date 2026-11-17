/**
 * The colours the site's own settings name, which count as used before any
 * document is counted: another variable naming one through `var()`.
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { namedBySite } from "./colour-usage";

const accent = {
  name: "color.accent",
  kind: "color" as const,
  values: { light: "#c98a3c" },
};

describe("the colours the site's own settings name", () => {
  it("counts a colour another variable names through var()", () => {
    const tokens: SiteTokenSet = {
      tokens: [
        accent,
        {
          name: "shadow.lift",
          kind: "shadow",
          values: { light: "0 1px 2px var(--site-color-accent)" },
        },
      ],
    };
    expect([...namedBySite(tokens)]).toEqual(["color.accent"]);
  });

  it("reads a dark value too, under the site's own prefix", () => {
    const tokens: SiteTokenSet = {
      prefix: "--brand-",
      tokens: [
        accent,
        {
          name: "shadow.lift",
          kind: "shadow",
          values: {
            light: "0 1px 2px #000",
            dark: "0 1px 2px var(--brand-color-accent)",
          },
        },
      ],
    };
    expect([...namedBySite(tokens)]).toEqual(["color.accent"]);
  });

  it("counts nothing for a variable naming only itself, or a property no variable is written under", () => {
    const tokens: SiteTokenSet = {
      tokens: [
        { ...accent, values: { light: "var(--site-color-accent, #000)" } },
        {
          name: "shadow.lift",
          kind: "shadow",
          values: { light: "0 1px 2px var(--elsewhere)" },
        },
      ],
    };
    expect([...namedBySite(tokens)]).toEqual([]);
  });
});
