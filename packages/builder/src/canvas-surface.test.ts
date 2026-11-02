import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CANVAS_FRAME_SHEET } from "./canvas-frame-sheet";

/**
 * The canvas is drawn on the PAGE's surface, not on the editor's.
 *
 * A colour nothing declares is inherited, and inheritance is invisible to every
 * other gate here: the canvas rendered, its blocks rendered, no rule was
 * missing and nothing threw — the page was simply the wrong colour. What an
 * author composes then looks nothing like what a visitor loads, which is the
 * one thing this canvas exists to show.
 *
 * Two stylesheets decide it. The page is drawn in a frame of its own, so its
 * surface is stated by the sheet the frame carries (`canvas-frame-sheet.ts`),
 * and nothing of the admin's reaches it. The sheet on the frame and the marks
 * drawn over it are the editor's, in `builder-chrome.css`.
 *
 * Read from the SOURCE stylesheet rather than the built one: `dist` is
 * gitignored, so a check against it answers differently before and after a
 * build — the shape that makes CI and a laptop disagree.
 *
 * @module canvas-surface.test
 */
const CHROME = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
);

/**
 * Every place a rule is written under exactly `selector` in `css`: at the
 * start of a line, followed by its brace, and not the last line of a longer
 * selector LIST — a list such as `.a,\n.nx-canvas {` names the canvas too, but
 * declares something different and must not answer for the canvas's own rule.
 */
function rulesUnder(css: string, selector: string): string[] {
  const marker = `\n${selector} {`;
  const bodies: string[] = [];
  for (
    let at = css.indexOf(marker);
    at !== -1;
    at = css.indexOf(marker, at + 1)
  ) {
    if (css[at - 1] === ",") continue;
    const body = css.slice(at + marker.length);
    bodies.push(body.slice(0, body.indexOf("\n}")));
  }
  return bodies;
}

/** The body of the one rule written under exactly `selector` in `css`. */
function ruleIn(css: string, selector: string): string {
  const bodies = rulesUnder(css, selector);
  expect(bodies.length, `exactly one rule for \`${selector}\``).toBe(1);
  return bodies[0] as string;
}

/** A rule of the editor's own sheet. */
function ruleFor(selector: string): string {
  return ruleIn(CHROME, selector);
}

/** The value of one declaration in a rule body, or undefined. */
function declared(body: string, property: string): string | undefined {
  const match = new RegExp(`(?:^|[\\s;])${property}\\s*:\\s*([^;]+);`).exec(
    body
  );
  return match?.[1]?.trim();
}

/** The canvas root's rule in the frame's sheet. */
function canvasRule(): string {
  return ruleIn(CANVAS_FRAME_SHEET, ".nx-canvas");
}

describe("the canvas's frame as a sheet on the editor's surface", () => {
  it("states its own edge, so the page is separable at any tone", () => {
    /*
     * The surface around the frame is deliberately one step off the background
     * so it recedes, so the two alone are close by design. The edge is what
     * makes the page separable regardless of which of the two is lighter,
     * which the palette inverts between modes.
     */
    const frame = ruleFor(".nx-canvas-frame");
    expect(declared(frame, "outline")).toBe(
      "1px solid var(--nx-builder-border)"
    );
    expect(declared(frame, "box-shadow")).toBe("var(--shadow-md)");
  });

  it("draws that edge OUTSIDE the box the frame is fitted into", () => {
    /*
     * The box takes the frame's painted size exactly, and the chrome layer is
     * placed from the frame's own position inside it. A border would add to
     * the box and move the frame off where the fit put it; an outline paints
     * outside and takes part in no layout.
     */
    const declaresBorder = /(?:^|\s)border(?:-[a-z]+)?\s*:/.test(
      ruleFor(".nx-canvas-frame")
    );
    expect(declaresBorder).toBe(false);
  });

  it("leaves the frame's colour scheme to the system, not the admin", () => {
    /*
     * A frame's `prefers-color-scheme` follows the scheme of the iframe
     * element, so inheriting the admin's dark scheme would turn a site that
     * darkens with the system dark whenever the ADMIN was.
     */
    expect(declared(ruleFor(".nx-canvas-frame__page"), "color-scheme")).toBe(
      "normal"
    );
  });
});

describe("the canvas surface is the site's, not the admin's", () => {
  it("starts from a plain base, with no browser margin around the page", () => {
    expect(declared(ruleIn(CANVAS_FRAME_SHEET, "html, body"), "margin")).toBe(
      "0"
    );
  });

  it("states a background, a text colour and a colour scheme of its own", () => {
    /*
     * From the site's own background and text tokens, which the canvas root
     * names under the site's prefix; the browser's defaults where the host
     * serves no site sheet.
     */
    const rule = canvasRule();
    expect(declared(rule, "background-color")).toBe(
      "var(--nx-canvas-site-ground, Canvas)"
    );
    expect(declared(rule, "color")).toBe(
      "var(--nx-canvas-site-ink, CanvasText)"
    );
    expect(declared(rule, "color-scheme")).toBe("light");
  });

  it("names no admin token anywhere in the frame's sheet", () => {
    /*
     * The admin's tokens are custom properties of the editor's document and
     * resolve to nothing in the frame — and were they to resolve, they would
     * repaint the page whenever the admin changed theme. The canvas's own
     * site-token references are the one `--nx-` name allowed: they point at
     * the site's tokens.
     */
    expect(CANVAS_FRAME_SHEET).toContain("var(--nx-canvas-site-ground");
    expect(/var\(--nx-(?!canvas-site-)/.test(CANVAS_FRAME_SHEET)).toBe(false);
  });

  it("sets the page in the site's body font, not the admin's face", () => {
    const family = declared(canvasRule(), "font-family");
    expect(family).toBe("var(--nx-canvas-site-font, system-ui), sans-serif");
    expect(family?.includes("--font-sans"), "the admin's own face").toBe(false);
  });

  it("is darkened by the site's own dark mode, keyed on the strategy the canvas states", () => {
    expect(
      declared(
        ruleIn(
          CANVAS_FRAME_SHEET,
          '[data-nx-theme="dark"] .nx-canvas[data-nx-site-dark-ground="attribute"]'
        ),
        "color-scheme"
      )
    ).toBe("dark");
    const media =
      /@media \(prefers-color-scheme: dark\) \{\s*\.nx-canvas\[data-nx-site-dark-ground="media"\] \{([^}]*)\}/.exec(
        CANVAS_FRAME_SHEET
      );
    expect(media, "the media-strategy rule exists").not.toBeNull();
    expect(declared(media?.[1] ?? "", "color-scheme")).toBe("dark");
    // Nothing keyed on the admin's `.dark` class: it is in another document.
    expect(/\.dark\b/.test(CANVAS_FRAME_SHEET)).toBe(false);
  });

  it("draws none of the editor's chrome inside the page", () => {
    /*
     * The toolbar, the marks, the drop line and the spacing bands are drawn
     * over the frame in the editor's document, so the frame's sheet styles
     * none of them and the site's CSS can reach none of them.
     */
    for (const chrome of [
      "data-nx-chrome",
      "nx-block-toolbar",
      "nx-drop-indicator",
      "nx-spacing-overlay",
      "data-nx-selected]",
    ]) {
      expect(
        CANVAS_FRAME_SHEET.replace("[data-nx-selected]:empty", "").includes(
          chrome
        ),
        chrome
      ).toBe(false);
    }
  });
});

/** A `#rrggbb` value's relative luminance, per WCAG 2.2. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(at => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

/** A literal `#rrggbb` a token is declared with, read from a rule body. */
function hexOf(body: string, property: string): string {
  const value = declared(body, property);
  expect(value, `${property} is a literal colour`).toMatch(/^#[0-9a-f]{6}$/);
  return value as string;
}

const CONSTANTS = ".nx-builder-tokens,\n.nx-builder-chrome,\n.nx-canvas-layer";
const ADMIN_DARK =
  ".dark .nx-builder-tokens,\n.dark .nx-builder-chrome,\n.nx-builder-tokens.dark,\n.nx-builder-chrome.dark";

const SELECTED = '.nx-canvas-mark[data-mark="selected"]';

describe("the editing colours drawn on the page", () => {
  it("are builder tokens, never the admin's black-or-white primary", () => {
    /*
     * `--nx-primary` is black in the light theme and white in the dark, and
     * these marks sit on the site's page: white vanished on a white page.
     */
    expect(declared(ruleFor(SELECTED), "outline")).toBe(
      "2px solid var(--nx-builder-select)"
    );
    expect(declared(ruleFor(".nx-drop-indicator"), "background")).toBe(
      "var(--nx-builder-select)"
    );
    expect(
      declared(ruleFor('.nx-canvas-mark[data-mark="drop-parent"]'), "outline")
    ).toBe("2px dashed var(--nx-builder-select)");
    expect(
      declared(
        ruleFor('.nx-canvas-mark[data-mark="selected"][data-component]'),
        "outline-color"
      )
    ).toBe("var(--nx-builder-component)");
    const marks = [
      SELECTED,
      ".nx-drop-indicator",
      ".nx-drop-indicator::before",
      '.nx-canvas-mark[data-mark="drop-parent"]',
      ".nx-spacing-handles__handle::before",
    ];
    for (const selector of marks) {
      expect(
        ruleFor(selector).includes("var(--nx-primary)"),
        `${selector} paints with the admin's primary`
      ).toBe(false);
    }
  });

  it("halo the selection ring and the drop line in a mode-invariant white", () => {
    expect(declared(ruleFor(SELECTED), "box-shadow")).toBe(
      "inset 0 0 0 4px var(--nx-builder-halo)"
    );
    expect(declared(ruleFor(".nx-drop-indicator"), "box-shadow")).toBe(
      "0 0 0 1px var(--nx-builder-halo)"
    );
    expect(hexOf(ruleFor(CONSTANTS), "--nx-builder-halo")).toBe("#ffffff");
  });

  it("pick their hue by the PAGE's scheme over the canvas, and by the admin's elsewhere", () => {
    const constants = ruleFor(CONSTANTS);
    const onLight = hexOf(constants, "--nx-builder-select-on-light");
    const onDark = hexOf(constants, "--nx-builder-select-on-dark");
    hexOf(constants, "--nx-builder-component-on-light");
    hexOf(constants, "--nx-builder-component-on-dark");

    // The layer over the canvas takes the page's hue: light unless the frame
    // states the page is drawn dark.
    const layer = ruleFor(".nx-canvas-layer");
    expect(declared(layer, "--nx-builder-select")).toBe(
      "var(--nx-builder-select-on-light)"
    );
    expect(declared(layer, "--nx-builder-component")).toBe(
      "var(--nx-builder-component-on-light)"
    );
    expect(
      declared(
        ruleFor('.nx-canvas-layer[data-nx-page-scheme="dark"]'),
        "--nx-builder-select"
      )
    ).toBe("var(--nx-builder-select-on-dark)");

    // The admin's theme picks for chrome on admin surfaces.
    const adminDark = ruleFor(ADMIN_DARK);
    expect(declared(adminDark, "--nx-builder-select")).toBe(
      "var(--nx-builder-select-on-dark)"
    );
    expect(declared(adminDark, "--nx-builder-component")).toBe(
      "var(--nx-builder-component-on-dark)"
    );

    // Each pick holds 3:1 on the ground it is for (WCAG 2.2 SC 1.4.11).
    expect(contrast(onLight, "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(contrast(onDark, "#0b0f19")).toBeGreaterThanOrEqual(3);
  });

  it("draw the block toolbar as a dark ink bar whose text passes AA", () => {
    const toolbar = ruleFor(".nx-block-toolbar");
    expect(declared(toolbar, "background")).toBe("var(--nx-builder-ink)");
    expect(declared(toolbar, "color")).toBe("var(--nx-builder-ink-text)");
    expect(declared(ruleFor(".nx-block-toolbar__button"), "color")).toBe(
      "var(--nx-builder-ink-text)"
    );

    const light = ruleFor(".nx-builder-tokens,\n.nx-builder-chrome");
    const text = hexOf(light, "--nx-builder-ink-text");
    const inks = [
      hexOf(light, "--nx-builder-ink"),
      hexOf(ruleFor(ADMIN_DARK), "--nx-builder-ink"),
    ];
    for (const ink of inks) {
      expect(
        contrast(text, ink),
        `toolbar text on ${ink}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
