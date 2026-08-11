import { describe, expect, it } from "vitest";

import { themeToCss, themesToStylesheet } from "../generate-css";
import { MONO } from "../themes/mono";

describe("themeToCss", () => {
  it("scopes light tokens to the theme attribute", () => {
    const css = themeToCss(MONO);
    expect(css).toContain('.nextly-admin[data-theme="mono"]');
    expect(css).toContain("--nx-primary: oklch(0 0 0);");
  });

  it("scopes dark tokens to the dark class as well", () => {
    const css = themeToCss(MONO);
    expect(css).toContain('.nextly-admin.dark[data-theme="mono"]');
  });

  it("emits the unprefixed radius knob", () => {
    expect(themeToCss(MONO)).toContain("--radius: 0px;");
  });

  it("emits font families", () => {
    const css = themeToCss(MONO);
    expect(css).toContain("--font-sans:");
    expect(css).toContain("--font-mono:");
  });

  it("throws on a theme missing a required token", () => {
    const broken = {
      ...MONO,
      id: "broken",
      light: { ...MONO.light, primary: undefined as unknown as string },
    };
    expect(() => themeToCss(broken)).toThrow(/primary/);
  });

  it("concatenates every theme into one stylesheet", () => {
    const sheet = themesToStylesheet([MONO]);
    expect(sheet).toContain('data-theme="mono"');
  });
});
