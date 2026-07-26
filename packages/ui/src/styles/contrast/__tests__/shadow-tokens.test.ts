/**
 * Asserts the shadow ramp resolves its color through a custom property rather
 * than a baked literal, which is what lets a theme restyle elevation. A literal
 * rgba() here compiles into the stylesheet and cannot be overridden at runtime.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseThemeTokens } from "../parse-theme";

const THEME_CSS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../theme.css"
);
const css = readFileSync(THEME_CSS, "utf8");

const THEMEABLE_SHADOWS = [
  "--shadow-sm",
  "--shadow-md",
  "--shadow-lg",
  "--shadow-xl",
  "--shadow-inner-subtle",
  "--shadow-neo",
];

describe("shadow tokens", () => {
  it.each(THEMEABLE_SHADOWS)("%s carries no literal rgba color", name => {
    const decl = new RegExp(`${name}:([^;]*);`, "s").exec(css);
    expect(decl, `${name} must be declared in theme.css`).not.toBeNull();
    expect(decl![1]).not.toMatch(/rgba?\(/);
  });

  it.each(THEMEABLE_SHADOWS)("%s references --nx-shadow-color", name => {
    const decl = new RegExp(`${name}:([^;]*);`, "s").exec(css);
    expect(decl![1]).toContain("--nx-shadow-color");
  });

  it("defines a shadow color for both modes", () => {
    const { light, dark } = parseThemeTokens(css);
    expect(light.get("--nx-shadow-color")).toBeDefined();
    expect(dark.get("--nx-shadow-color")).toBeDefined();
  });
});
