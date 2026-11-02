import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The canvas is drawn on the PAGE's surface, not on the editor's frame.
 *
 * A colour nothing declares is inherited, and inheritance is invisible to every
 * other gate here: the canvas rendered, its blocks rendered, no rule was
 * missing and nothing threw — the page was simply the wrong colour, because the
 * chrome's frame showed through a document whose blocks declare no background
 * of their own. What an author composes then looks nothing like what a visitor
 * loads, which is the one thing this canvas exists to show.
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
 * Every place a rule is written under exactly `selector`: at the start of a
 * line, followed by its brace, and not the last line of a longer selector LIST
 * — a list such as `.a,\n.nx-canvas {` names the canvas too, but declares
 * something different and must not answer for the canvas's own rule.
 */
function rulesUnder(selector: string): string[] {
  const marker = `\n${selector} {`;
  const bodies: string[] = [];
  for (
    let at = CHROME.indexOf(marker);
    at !== -1;
    at = CHROME.indexOf(marker, at + 1)
  ) {
    if (CHROME[at - 1] === ",") continue;
    const body = CHROME.slice(at + marker.length);
    bodies.push(body.slice(0, body.indexOf("\n}")));
  }
  return bodies;
}

/** The one `.nx-canvas` rule, so a second one cannot answer for the first. */
function canvasRule(): string {
  const bodies = rulesUnder(".nx-canvas");
  expect(
    bodies.length,
    "exactly one `.nx-canvas` rule, or these assertions read whichever came first"
  ).toBe(1);
  return bodies[0] as string;
}

describe("the canvas as a sheet", () => {
  it("states its own edge, so the page is separable at any tone", () => {
    /*
     * The frame is deliberately one step off the background so it recedes, so
     * the two surfaces alone are close by design. The edge is what makes the
     * page separable regardless — and regardless of which of the two is
     * lighter, which the palette inverts between modes.
     */
    expect(canvasRule()).toContain(
      "outline: 1px solid var(--nx-builder-border)"
    );
  });

  it("carries the separation on the EDGE, not only on a shadow", () => {
    /*
     * A shadow has almost nothing to darken on a dark page, so a sheet relying
     * on one is legible in light mode and flat in dark. The shadow may be
     * present as a secondary cue; the edge may not be missing.
     */
    const rule = canvasRule();
    const hasEdge = rule.includes("outline: 1px solid");
    expect(
      hasEdge,
      "a shadow alone leaves the page edgeless wherever it cannot cast"
    ).toBe(true);
  });

  it("draws that edge OUTSIDE the width the page is previewed at", () => {
    /*
     * This element carries the previewed width, `container-type: inline-size`
     * and the edge together, under the shell's `box-sizing: border-box`. A
     * border is therefore subtracted from the content box the container queries
     * resolve against, and two pixels decide a tier: at a 992px request the
     * content box is 990px, so a `max-width: 991px` rule stays active and the
     * unconditional tier cannot be previewed at all. An outline paints outside
     * the box and takes part in no layout, which is why it is the one that may
     * be used here.
     *
     * Matched as a property rather than as the shorthand, so `border-top` or
     * `border-width` cannot reintroduce the same subtraction under another
     * spelling. `--nx-builder-border` is not a match: the token is preceded by
     * `-` rather than by whitespace, and is a value rather than a declaration.
     */
    const declaresBorder = /(?:^|\s)border(?:-[a-z]+)?\s*:/.test(canvasRule());
    expect(
      declaresBorder,
      "a border here narrows the content box the previewed tier is decided by"
    ).toBe(false);
  });
});

/**
 * The body of the one rule written under exactly `selector`.
 *
 * Matched on the whole selector at the start of a line, so a longer selector
 * that merely contains this one cannot answer for it, and held to exactly one
 * match for the reason {@link canvasRule} is.
 */
function ruleFor(selector: string): string {
  const bodies = rulesUnder(selector);
  expect(bodies.length, `exactly one rule for \`${selector}\``).toBe(1);
  return bodies[0] as string;
}

/** The value of one declaration in a rule body, or undefined. */
function declared(body: string, property: string): string | undefined {
  const match = new RegExp(`(?:^|[\\s;])${property}\\s*:\\s*([^;]+);`).exec(
    body
  );
  return match?.[1]?.trim();
}

/** The site's attribute dark mode, keyed on the strategy the canvas states. */
const SITE_DARK =
  '[data-nx-theme="dark"] .nx-canvas[data-nx-site-dark-mode="attribute"]';

/** Every rule whose selector names `.nx-canvas`, as selector and body. */
function canvasRules(): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = [];
  const pattern = /\n([^{}\s/*][^{}]*?)\s*\{([^{}]*)\}/g;
  for (const match of CHROME.matchAll(pattern)) {
    const selector = (match[1] as string).trim();
    if (selector.includes(".nx-canvas")) {
      rules.push({ selector, body: match[2] as string });
    }
  }
  return rules;
}

describe("the canvas surface is the site's, not the admin's", () => {
  it("states a background, a text colour and a colour scheme of its own", () => {
    /*
     * All three inherit, and each one left unstated is taken from the admin
     * around the canvas: the background from the frame, the text colour and
     * the scheme from the admin's theme. Stating only the background left a
     * dark admin's light text on a white page.
     */
    const rule = canvasRule();
    expect(declared(rule, "background-color")).toBe("Canvas");
    expect(declared(rule, "color")).toBe("CanvasText");
    expect(declared(rule, "color-scheme")).toBe("light");
  });

  it("takes none of the three from an admin token", () => {
    /*
     * The defect this replaces was `--nx-builder-surface-raised`, an admin
     * token that is near black in the dark theme. Any `--nx-*` token here
     * repaints the page whenever the admin changes theme, which is exactly
     * what a visitor's page never does.
     */
    const rule = canvasRule();
    for (const property of ["background-color", "color", "color-scheme"]) {
      const value = declared(rule, property);
      expect(value, `${property} is declared`).toBeDefined();
      expect(
        value?.includes("var(--nx-"),
        `${property} follows the admin's theme: ${value}`
      ).toBe(false);
    }
  });

  it("sets the page in the site's body font, not the admin's face", () => {
    /*
     * The face inherits like the colours do, and left unstated the page is set
     * in the admin's Geist — a face the published page never uses.
     */
    const family = declared(canvasRule(), "font-family");
    /*
     * Through the property the canvas root sets inline, because the token's
     * own name depends on the site's prefix: naming `--site-font-body` here
     * left a site under another prefix in the fallback face.
     */
    expect(family).toBe("var(--nx-canvas-site-font, system-ui), sans-serif");
    expect(family?.includes("--site-"), "a hard-coded token prefix").toBe(
      false
    );
    expect(family?.includes("--font-sans"), "the admin's own face").toBe(false);
  });

  it("is darkened by the site's own dark mode and by nothing of the admin's", () => {
    expect(declared(ruleFor(SITE_DARK), "color-scheme")).toBe("dark");
    /*
     * Positive control first: the scan below reads real rules, so a pattern
     * that matched nothing would make the absence assertion meaningless.
     */
    const rules = canvasRules();
    expect(
      rules.some(rule => rule.selector === SITE_DARK),
      "the rule scan finds the site's dark-mode rule"
    ).toBe(true);
    /*
     * The host's attribute darkens only a site whose strategy IS the
     * attribute. A site that follows the system keeps light token values
     * under it, so an unqualified rule would draw dark ground under light
     * tokens.
     */
    const byAttribute = rules.filter(rule =>
      rule.selector.includes('[data-nx-theme="dark"]')
    );
    expect(byAttribute.length, "the scan finds the attribute rules").toBe(1);
    for (const rule of byAttribute) {
      expect(
        rule.selector,
        "keyed on the strategy the canvas states"
      ).toContain('.nx-canvas[data-nx-site-dark-mode="attribute"]');
    }
    const admin = rules.filter(
      rule =>
        /\.dark\b/.test(rule.selector) &&
        !rule.selector.includes("[data-nx-chrome]") &&
        /(?:^|[\s;])(?:background(?:-color)?|color|color-scheme)\s*:/.test(
          rule.body
        )
    );
    expect(
      admin.map(rule => rule.selector),
      "the admin's .dark class repaints the page"
    ).toEqual([]);
  });
});

describe("a site that darkens with the visitor's system", () => {
  it("darkens the canvas page under the media query, keyed on the stated strategy", () => {
    /*
     * The playground's own site uses the `media` strategy, so with the system
     * in dark its tokens take their dark values on the canvas. A page left on
     * a light ground under them is the published page nobody loads.
     */
    const block =
      /@media \(prefers-color-scheme: dark\) \{\s*\.nx-canvas\[data-nx-site-dark-mode="media"\] \{([^}]*)\}/.exec(
        CHROME
      );
    expect(block, "the media-strategy rule exists").not.toBeNull();
    const body = block?.[1] ?? "";
    expect(declared(body, "color-scheme")).toBe("dark");
    expect(declared(body, "--nx-builder-select")).toBe(
      "var(--nx-builder-select-on-dark)"
    );
  });
});

describe("the editor's chrome on the canvas keeps the admin's theme", () => {
  /** A selector with its line breaks and inner padding collapsed. */
  const flat = (selector: string): string =>
    selector.replace(/\s+/g, " ").replace(/\(\s/g, "(").replace(/\s\)/g, ")");

  /** The one rule whose flattened selector is `selector`. */
  function chromeRule(selector: string): string {
    const found = canvasRules().filter(
      rule => flat(rule.selector) === selector
    );
    expect(found.length, `exactly one rule for \`${selector}\``).toBe(1);
    return found[0]?.body ?? "";
  }

  /*
   * EVERY piece of chrome the editor draws inside the page, in one list: the
   * controls marked as chrome, and the spacing overlay and drop line, which
   * take no pointer events and so carry no chrome marker. The overlay's value
   * chips are text, and without this they were set in the site's face.
   */
  const MEMBERS = "[data-nx-chrome], .nx-spacing-overlay, .nx-drop-indicator";
  const LIGHT = `:where(.nx-canvas :is(${MEMBERS}))`;
  const DARK = `:where(.dark .nx-canvas :is(${MEMBERS}))`;

  it("hands chrome back the admin's text colour, scheme and face, weighing nothing", () => {
    /*
     * The canvas now states the site's scheme, text colour and face, and all
     * three inherit into chrome drawn on the page. Inside `:where()` so a
     * chrome rule that states its own colour still wins.
     */
    const light = chromeRule(LIGHT);
    expect(declared(light, "color-scheme")).toBe("light");
    expect(declared(light, "color")).toBe("var(--nx-builder-text)");
    expect(declared(light, "font-family")).toBe(
      "var(--font-sans, system-ui, sans-serif)"
    );
    expect(declared(chromeRule(DARK), "color-scheme")).toBe("dark");
    const order = canvasRules().map(rule => flat(rule.selector));
    expect(
      order.indexOf(DARK),
      "equal weight, so the dark rule has to come second"
    ).toBeGreaterThan(order.indexOf(LIGHT));
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

const CONSTANTS = ".nx-builder-tokens,\n.nx-builder-chrome,\n.nx-canvas";
const ADMIN_DARK =
  ".dark :is(.nx-builder-tokens, .nx-builder-chrome),\n:is(.nx-builder-tokens, .nx-builder-chrome).dark";

describe("the editing colours drawn on the page", () => {
  it("are builder tokens, never the admin's black-or-white primary", () => {
    /*
     * `--nx-primary` is black in the light theme and white in the dark, and
     * these marks sit on the site's page: white vanished on a white page.
     */
    expect(declared(ruleFor(".nx-canvas [data-nx-selected]"), "outline")).toBe(
      "2px solid var(--nx-builder-select)"
    );
    expect(declared(ruleFor(".nx-drop-indicator"), "background")).toBe(
      "var(--nx-builder-select)"
    );
    expect(
      declared(ruleFor(".nx-canvas [data-nx-drop-parent]"), "outline")
    ).toBe("2px dashed var(--nx-builder-select)");
    expect(
      declared(
        ruleFor(".nx-canvas [data-nx-selected][data-nx-instance]"),
        "outline-color"
      )
    ).toBe("var(--nx-builder-component)");
    const marks = [
      ".nx-canvas [data-nx-selected]",
      ".nx-drop-indicator",
      ".nx-drop-indicator::before",
      ".nx-canvas [data-nx-drop-parent]",
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
    expect(
      declared(ruleFor(".nx-canvas [data-nx-selected]"), "box-shadow")
    ).toBe("inset 0 0 0 4px var(--nx-builder-halo)");
    expect(declared(ruleFor(".nx-drop-indicator"), "box-shadow")).toBe(
      "0 0 0 1px var(--nx-builder-halo)"
    );
    expect(hexOf(ruleFor(CONSTANTS), "--nx-builder-halo")).toBe("#ffffff");
  });

  it("pick their hue by the PAGE's scheme on the canvas, and by the admin's elsewhere", () => {
    const constants = ruleFor(CONSTANTS);
    const onLight = hexOf(constants, "--nx-builder-select-on-light");
    const onDark = hexOf(constants, "--nx-builder-select-on-dark");
    hexOf(constants, "--nx-builder-component-on-light");
    hexOf(constants, "--nx-builder-component-on-dark");

    // The canvas page is light unless the site's own dark mode applies.
    const canvas = canvasRule();
    expect(declared(canvas, "--nx-builder-select")).toBe(
      "var(--nx-builder-select-on-light)"
    );
    expect(declared(canvas, "--nx-builder-component")).toBe(
      "var(--nx-builder-component-on-light)"
    );
    const siteDark = ruleFor(SITE_DARK);
    expect(declared(siteDark, "--nx-builder-select")).toBe(
      "var(--nx-builder-select-on-dark)"
    );

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
