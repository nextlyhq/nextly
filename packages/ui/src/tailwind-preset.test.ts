/**
 * The preset and the theme stylesheet must agree about the component rules a
 * class name alone cannot carry.
 *
 * They are two expressions of ONE decision, and they exist separately only
 * because the two supported build paths consume different things: a v4 consumer
 * imports `theme.css`, while the documented v3 path is `presets: [uiPreset]`,
 * which pulls in a JavaScript object and no CSS whatsoever. Scanning a
 * component discovers the CLASS it writes, never the rule behind it, so a rule
 * living in only one of the two reaches only half the consumers.
 *
 * That failure is silent in the worst way: the class is present in the markup,
 * every test asserting it passes, and the component simply renders without its
 * spacing. Nothing errors and nothing looks wrong in the source.
 *
 * This file is the control that keeps them in step. Deriving one from the other
 * would be better than pinning them — the repository's own rule prefers it —
 * but CSS cannot import a TypeScript constant, and generating the stylesheet
 * from the preset at build time would put a code generator between the theme
 * and every consumer that reads it. So the copies stay, and a test that fails
 * the moment they disagree is what makes that safe.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { uiPreset } from "./tailwind-preset";

const here = dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(
  join(here, "styles", "theme.css"),
  "utf8"
).replace(/\s+/g, " ");

/** Every rule the preset registers through `addComponents`. */
function presetComponents(): Record<string, Record<string, string>> {
  const collected: Record<string, Record<string, string>> = {};
  for (const plugin of uiPreset.plugins ?? []) {
    (plugin as (api: { addComponents: (r: never) => void }) => void)({
      addComponents: rules => Object.assign(collected, rules),
    });
  }
  return collected;
}

describe("tailwind preset", () => {
  it("registers the form-section rhythm, which a v3 consumer gets no other way", () => {
    // `presets: [uiPreset]` is the documented v3 path and it loads no CSS, so a
    // rule shipped only in `theme.css` never reaches those consumers.
    expect(presetComponents()[".nx-form-section-rows > *"]).toEqual({
      paddingBlock: "var(--nx-field-gap)",
    });
  });

  it("agrees with the theme stylesheet on that rule", () => {
    // The separating property: both must spend the SAME token. A preset that
    // registered the selector with a different value would satisfy the
    // assertion above while giving v3 and v4 consumers different spacing —
    // which is worse than the missing rule, because it looks deliberate.
    const fromPreset =
      presetComponents()[".nx-form-section-rows > *"]?.paddingBlock;

    expect(fromPreset).toBeDefined();
    expect(themeCss).toContain(
      `.nx-form-section-rows > * { padding-block: ${fromPreset}; }`
    );
  });

  it("declares the token both copies read", () => {
    // Neither copy errors on a missing custom property; both quietly resolve to
    // nothing, so the token's presence is its own assertion.
    expect(themeCss).toContain("--nx-field-gap:");
  });
});
