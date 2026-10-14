import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { expect } from "vitest";

/** The admin's two modes, as its theme provider sets them on its container. */
export const THEMES = ["light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

/**
 * Renders `ui` inside the admin's container in `theme`: the container the
 * theme provider marks with `dark` for the dark mode, under which every
 * `--nx-*` token takes its dark value.
 */
export function renderInTheme(ui: ReactElement, theme: Theme): RenderResult {
  return render(
    <div className={theme === "dark" ? "nextly-admin dark" : "nextly-admin"}>
      {ui}
    </div>
  );
}

/**
 * A colour written into markup rather than taken from a token: a hex, an
 * `rgb`/`hsl`/`oklch` literal, or a palette or arbitrary-value utility.
 * Any of them reads the same in both modes, so one of them in a screen is
 * a screen that is wrong in one of the two.
 */
const LITERAL_COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(/i;
const PALETTE_CLASS =
  /\b(?:bg|text|border|ring|fill|stroke)-(?:\[|(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d))/;

/** Holds every element of a render to the theme's tokens: no colour of its own, inline or by class. */
export function expectTokenColoursOnly(container: HTMLElement): void {
  const elements = [container, ...container.querySelectorAll("*")];
  for (const element of elements) {
    expect(element.getAttribute("style") ?? "").not.toMatch(LITERAL_COLOUR);
    expect(element.getAttribute("class") ?? "").not.toMatch(PALETTE_CLASS);
    expect(element.getAttribute("class") ?? "").not.toMatch(LITERAL_COLOUR);
  }
}
