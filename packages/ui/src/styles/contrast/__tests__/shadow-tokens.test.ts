/**
 * Guards that the elevation ramp stays re-themable.
 *
 * Tailwind's `@theme inline` copies a declaration's VALUE into every generated
 * utility. A literal colour is therefore frozen into the compiled stylesheet and
 * can never be overridden at runtime, while a `var()` reference survives into
 * the utility and re-resolves at the element (so `:root` / `.dark` / a scoped
 * override still reaches it). This asserts the ramp uses the second form: each
 * step routes its colour through `--nx-shadow-color`, which is defined for both
 * modes.
 *
 * The status glows (`--shadow-glow-*`, `--shadow-elevation-primary`,
 * `--shadow-soft-primary`) already mix their own `--nx-*` token and are not part
 * of the neutral ramp, so they are not listed here.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postcss from "postcss";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../theme.css"),
  "utf8"
);

/** The neutral elevation ramp: every shadow whose colour is not a brand token. */
const RAMP = [
  "--shadow-sm",
  "--shadow-md",
  "--shadow-lg",
  "--shadow-xl",
  "--shadow-inner-subtle",
  "--shadow-neo",
] as const;

const SHADOW_COLOR = "--nx-shadow-color";

/** `--shadow-*` declarations from the `@theme` at-rule, whitespace collapsed. */
function themeShadows(): Map<string, string> {
  const out = new Map<string, string>();
  postcss.parse(css).walkAtRules("theme", atRule => {
    atRule.walkDecls(decl => {
      if (!decl.prop.startsWith("--shadow-")) return;
      out.set(decl.prop, decl.value.replace(/\s+/g, " ").trim());
    });
  });
  return out;
}

/** Whether a rule with the given selector declares the given property. */
function declaredIn(selector: string, prop: string): boolean {
  let found = false;
  postcss.parse(css).walkRules(rule => {
    if (rule.selector !== selector) return;
    rule.walkDecls(decl => {
      if (decl.prop === prop) found = true;
    });
  });
  return found;
}

describe("shadow tokens", () => {
  const shadows = themeShadows();

  it("declares every ramp step in the @theme block", () => {
    expect([...shadows.keys()]).toEqual(expect.arrayContaining([...RAMP]));
  });

  it.each(RAMP)("%s carries no literal colour", token => {
    const value = shadows.get(token);
    expect(value, `${token} is not declared in @theme`).toBeDefined();
    expect(
      value,
      `${token} hardcodes a colour: "${value}". @theme inline freezes literals ` +
        `into the compiled utility, so the shadow can no longer be re-themed. ` +
        `Express it as color-mix(in srgb, var(${SHADOW_COLOR}) N%, transparent).`
    ).not.toMatch(/\b(?:rgba?|hsla?)\(/);
  });

  it.each(RAMP)("%s routes its colour through the shadow token", token => {
    expect(
      shadows.get(token),
      `${token} must reference var(${SHADOW_COLOR}) so the ramp retints from ` +
        `one place`
    ).toContain(`var(${SHADOW_COLOR})`);
  });

  it.each([":root", ".dark"])("defines the shadow token in %s", selector => {
    expect(
      declaredIn(selector, SHADOW_COLOR),
      `${SHADOW_COLOR} must be declared in ${selector}; a ramp step referencing ` +
        `an undefined token renders no shadow at all`
    ).toBe(true);
  });
});
