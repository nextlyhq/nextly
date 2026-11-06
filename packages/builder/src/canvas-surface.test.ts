import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CANVAS_FRAME_SHEET } from "./canvas-frame-sheet";
import { EMPTY_CONTAINER_SELECTOR } from "./empty-slot";

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
 * The canvas mounted on its own, with no builder scope above it. Matches
 * nothing inside the shell, where the tokens are inherited, and at zero
 * specificity, so the canvas's own rules still win where they apply.
 */
const STANDALONE_CANVAS =
  ":where(.nx-canvas:not(:is(.nx-builder-tokens, .nx-builder-chrome) *))";

/**
 * The layer the editor draws over the canvas, mounted without the shell: it
 * sits in the host's document beside the frame, so it needs the tokens of its
 * own, on the same terms as the lone canvas.
 */
const STANDALONE_LAYER =
  ":where(.nx-canvas-layer:not(:is(.nx-builder-tokens, .nx-builder-chrome) *))";

/** The token scopes' selector list: the shell's two, a lone canvas and a lone layer. */
const TOKENS = `.nx-builder-tokens,\n.nx-builder-chrome,\n${STANDALONE_CANVAS},\n${STANDALONE_LAYER}`;

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

/**
 * The scope of the rules that stand in for a site on the editor's blank page,
 * which a page the site serves never matches.
 */
const BLANK = ":where(:root[data-nx-canvas-frame])";

/** The canvas root's rule on the blank page, in the frame's sheet. */
function canvasRule(): string {
  return ruleIn(CANVAS_FRAME_SHEET, `${BLANK} .nx-canvas`);
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
    expect(
      declared(ruleIn(CANVAS_FRAME_SHEET, `${BLANK}, ${BLANK} body`), "margin")
    ).toBe("0");
  });

  it("leaves the site's own page to the site's stylesheet", () => {
    /*
     * On a page the site serves, the canvas sits in the site's own layout,
     * and the site's stylesheet decides its ground, ink, type, scheme and
     * base, as it does for the published page. So the rules that are not
     * scoped to the blank page state none of them.
     */
    const root = ruleIn(CANVAS_FRAME_SHEET, ".nx-canvas");
    for (const property of [
      "background-color",
      "color",
      "font-family",
      "color-scheme",
      "flex",
    ]) {
      expect(declared(root, property), property).toBe(undefined);
    }
    const unscoped = [
      ...CANVAS_FRAME_SHEET.matchAll(/([^{}]+)\{([^{}]*)\}/g),
    ].filter(([, selector]) => {
      const bare = (selector ?? "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
      return !bare.includes(BLANK) && !bare.startsWith("@");
    });
    // The control: the scan reads rules, the canvas root's among them.
    expect(unscoped.length).toBeGreaterThan(0);
    for (const [, selector] of unscoped) {
      const bare = (selector ?? "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
      expect(/(^|[\s,])(html|body)([\s,]|$)/.test(bare), bare).toBe(false);
    }
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

  it("paints the page with no admin token: only the admin's own chrome reads them", () => {
    /*
     * The admin's tokens would repaint the page whenever the admin changed
     * theme, so the page's own rules name only the site's tokens. The
     * exceptions are the admin's words on the page, which take the tokens the
     * frame hands them: a Layout region's badge and tag, and a collection
     * list's note to its author and its "When empty" tag.
     */
    expect(CANVAS_FRAME_SHEET).toContain("var(--nx-canvas-site-ground");
    const naming = [
      ...CANVAS_FRAME_SHEET.matchAll(/([^{}]+)\{([^{}]*)\}/g),
    ].filter(([, , body]) =>
      /var\(--nx-(?!canvas-site-|canvas-zoom)/.test(body ?? "")
    );
    // The control: the region's rules are found, so the scan reads rules.
    expect(naming.length).toBeGreaterThan(0);
    for (const [, selector] of naming) {
      const selectors = (selector ?? "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(",")
        .map(part => part.trim());
      // The site's own layout around the canvas is quietened as a region's
      // content is, by the same handed token.
      for (const part of selectors) {
        expect(part, "a rule painting with an admin token").toMatch(
          /^(\.nx-canvas-region|\[data-nx-site-chrome\]|\[data-nx-list-diagnostic|\.nx-canvas \[data-nx-list-)/
        );
      }
    }
  });

  it("sets the page in the site's body font, not the admin's face", () => {
    const family = declared(canvasRule(), "font-family");
    expect(family).toBe("var(--nx-canvas-site-font, system-ui), sans-serif");
    expect(family?.includes("--font-sans"), "the admin's own face").toBe(false);
  });

  it("is darkened by the site's own dark mode, by the marker the canvas states", () => {
    expect(
      declared(
        ruleIn(
          CANVAS_FRAME_SHEET,
          `${BLANK} .nx-canvas[data-nx-site-dark-ground][data-nx-site-theme="dark"]`
        ),
        "color-scheme"
      )
    ).toBe("dark");
    // With no marker stated, the device decides, as it does for the values.
    const media =
      /@media \(prefers-color-scheme: dark\) \{\s*:where\(:root\[data-nx-canvas-frame\]\) \.nx-canvas\[data-nx-site-dark-ground\]:not\(\[data-nx-site-theme\]\) \{([^}]*)\}/.exec(
        CANVAS_FRAME_SHEET
      );
    expect(media, "the device rule exists").not.toBeNull();
    expect(declared(media?.[1] ?? "", "color-scheme")).toBe("dark");
    // Nothing keyed on the admin's `.dark` class, or on markers above the
    // canvas, which the canvas states for itself.
    expect(/\.dark\b/.test(CANVAS_FRAME_SHEET)).toBe(false);
    expect(CANVAS_FRAME_SHEET.includes("[data-nx-theme")).toBe(false);
  });

  it("makes the page one stacking context, and repeats only an opaque ground", () => {
    const page = ruleIn(
      CANVAS_FRAME_SHEET,
      `${BLANK} .nx-canvas > .nx-pb-page`
    );
    expect(declared(page, "isolation")).toBe("isolate");
    for (const property of ["display", "background-color", "background"]) {
      expect(declared(page, property), `the page root's ${property}`).toBe(
        undefined
      );
    }
    expect(
      declared(
        ruleIn(
          CANVAS_FRAME_SHEET,
          `:where(${BLANK} .nx-canvas[data-nx-site-ground-opaque] > .nx-pb-page)`
        ),
        "background-color"
      )
    ).toBe("var(--nx-canvas-site-ground, Canvas)");
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
const ADMIN_DARK = `.dark .nx-builder-tokens,\n.dark .nx-builder-chrome,\n.dark ${STANDALONE_CANVAS},\n.nx-builder-tokens.dark,\n.nx-builder-chrome.dark`;

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
    expect(
      declared(ruleFor('.nx-canvas-mark[data-mark="exposed"]'), "outline")
    ).toBe("1px dashed var(--nx-builder-component)");
    // Inside its part: the placement's frame is drawn outside the parts, and
    // a dash outside a full-width part would run under it, leaving only its
    // top and bottom to read, as rules rather than a box per part.
    expect(
      declared(
        ruleFor('.nx-canvas-mark[data-mark="exposed"]'),
        "outline-offset"
      )
    ).toBe("-2px");
    const marks = [
      SELECTED,
      ".nx-drop-indicator",
      ".nx-drop-indicator::before",
      '.nx-canvas-mark[data-mark="drop-parent"]',
      '.nx-canvas-mark[data-mark="exposed"]',
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
    // The rest of a selection: a thinner ring with a thinner halo.
    const secondary = ruleFor(
      '.nx-canvas-mark[data-mark="selected"][data-secondary]'
    );
    expect(declared(secondary, "outline-width")).toBe("1px");
    expect(declared(secondary, "box-shadow")).toBe(
      "inset 0 0 0 2px var(--nx-builder-halo)"
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

    const light = ruleFor(TOKENS);
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

/**
 * The selector list of the rule whose body declares `property`, where that
 * rule is the one opening with `first`.
 */
function selectorListDeclaring(first: string, property: string): string[] {
  const pattern =
    /(?:^|\n)((?:[^{}\n/*][^{}\n]*,\n)*[^{}\n/*][^{}\n]*)\s*\{([^{}]*)\}/g;
  for (const match of CHROME.matchAll(pattern)) {
    // One selector per line: a comma inside `:is(...)` is not a list's.
    const selectors = (match[1] ?? "")
      .split(",\n")
      .map(selector => selector.trim().replace(/,$/, ""));
    if (selectors[0] === first && (match[2] ?? "").includes(`${property}:`)) {
      return selectors;
    }
  }
  return [];
}

describe("a canvas mounted outside the editor shell", () => {
  it("declares the builder tokens its region chrome reads", () => {
    // The token block: the region's opacity, and the border, surface and text
    // its badge and tag are drawn with.
    const scope = selectorListDeclaring(
      ".nx-builder-tokens",
      "--nx-builder-region-opacity"
    );
    expect(scope).toContain(STANDALONE_CANVAS);
    expect(scope).toContain(STANDALONE_LAYER);
  });

  it("takes the dark picks under the admin's dark theme, as the shell does", () => {
    const dark = selectorListDeclaring(
      ".dark .nx-builder-tokens",
      "--nx-builder-scheme"
    );
    expect(dark).toContain(`.dark ${STANDALONE_CANVAS}`);
  });
});

describe("a Layout region drawn in the canvas frame", () => {
  it("is styled by the frame's own sheet, in the admin's tokens, at the admin's size", () => {
    const lock = ruleIn(CANVAS_FRAME_SHEET, ".nx-canvas-region__lock");
    expect(declared(lock, "background")).toBe(
      "var(--nx-builder-surface-raised)"
    );
    expect(declared(lock, "color")).toBe("var(--nx-builder-text-muted)");
    const words = ruleIn(CANVAS_FRAME_SHEET, ".nx-canvas-region__mark-body");
    expect(declared(words, "zoom")).toBe("calc(1 / var(--nx-canvas-zoom, 1))");
    expect(declared(words, "font-family")).toBe(
      "var(--font-sans, system-ui), sans-serif"
    );
    // One home: the editor's own sheet never reaches the frame, so it holds
    // none of these rules.
    expect(CHROME.includes(".nx-canvas-region")).toBe(false);
  });
});

describe("the marks drawn over the frame", () => {
  it("dash a locked block's ring and drop the halo where a clip cuts the mark", () => {
    expect(
      declared(
        ruleFor('.nx-canvas-mark[data-mark="selected"][data-locked]'),
        "outline-style"
      )
    ).toBe("dashed");
    expect(
      declared(ruleFor(".nx-canvas-mark[data-clipped]"), "box-shadow")
    ).toBe("none");
    // The page's elements are in the frame, where this sheet never reaches, so
    // a rule styling a locked block's own outline would mark nothing.
    expect(CHROME.includes("[data-nx-locked][data-nx-selected]")).toBe(false);
  });
});

describe("a refused drop's notice", () => {
  it("is one neutral notice with a red edge, on the canvas and in Layers alike", () => {
    const notice = ruleFor(".nx-refusal-notice");
    expect(declared(notice, "background")).toBe(
      "var(--nx-builder-surface-raised)"
    );
    expect(declared(notice, "color")).toBe("var(--nx-builder-text)");
    expect(declared(notice, "border-left")).toBe(
      "3px solid var(--nx-destructive)"
    );
    // Each place only positions it: neither paints a fill of its own.
    for (const place of [".nx-drop-refusal", ".nx-layers-drop-refusal"]) {
      const rule = ruleFor(place);
      expect(declared(rule, "background"), place).toBe(undefined);
      expect(declared(rule, "background-color"), place).toBe(undefined);
    }
  });
});

describe("a collection list's notes and tag in the canvas frame", () => {
  it("draws a fallen-back sort amber and a failed read red, in the editor's own names", () => {
    const amber = ruleIn(
      CANVAS_FRAME_SHEET,
      '[data-nx-list-diagnostic="sort-fallback"]'
    );
    expect(declared(amber, "background")).toContain("var(--nx-builder-warning");
    const red = ruleIn(
      CANVAS_FRAME_SHEET,
      '[data-nx-list-diagnostic="query-failed"]'
    );
    expect(declared(red, "background")).toContain("var(--nx-builder-danger");
    // A note about the list spans its row, never one entry's cell.
    const note = ruleIn(CANVAS_FRAME_SHEET, "[data-nx-list-diagnostic]");
    expect(declared(note, "grid-column")).toBe("1 / -1");
    expect(declared(note, "flex-basis")).toBe("100%");
    // Read at the admin's size on a page drawn small.
    expect(declared(note, "font-size")).toBe(
      "calc(0.8125rem / var(--nx-canvas-zoom, 1))"
    );
    // Each is the theme's own, so it follows light and dark.
    expect(ruleFor(TOKENS)).toContain(
      "--nx-builder-warning: var(--nx-warning)"
    );
  });

  it("tags a list drawing its empty state with why, at the admin's size", () => {
    const tagged = (because: string) =>
      declared(
        ruleIn(
          CANVAS_FRAME_SHEET,
          `.nx-canvas [data-nx-list-empty-because="${because}"]::before`
        ),
        "content"
      );
    expect(tagged("chosen")).toBe('"When empty"');
    expect(tagged("none")).toBe('"No entries match · showing When empty"');
    expect(tagged("failed")).toBe('"Showing When empty"');
    const tag = ruleIn(
      CANVAS_FRAME_SHEET,
      ".nx-canvas [data-nx-list-shows]::before"
    );
    expect(declared(tag, "zoom")).toBe("calc(1 / var(--nx-canvas-zoom, 1))");
    expect(declared(tag, "background")).toBe(
      "var(--nx-builder-select, Highlight)"
    );
  });

  it("keeps the tag inside the list, so it covers nothing above it", () => {
    const tag = ruleIn(
      CANVAS_FRAME_SHEET,
      ".nx-canvas [data-nx-list-shows]::before"
    );
    // In the list's own flow, first, spanning a grid's row from its start
    // and sized to its words: never lifted out above the list's top edge,
    // where it lay over whatever the page draws there.
    expect(declared(tag, "position")).toBeUndefined();
    expect(declared(tag, "inset-block-end")).toBeUndefined();
    expect(declared(tag, "grid-column")).toBe("1 / -1");
    expect(declared(tag, "justify-self")).toBe("start");
    expect(declared(tag, "inline-size")).toBe("max-content");
    // Over an empty list's area, whose words are centred, it sits at the
    // inside of the top edge.
    const over = ruleIn(
      CANVAS_FRAME_SHEET,
      `${EMPTY_CONTAINER_SELECTOR}[data-nx-list-shows]::before`
    );
    expect(declared(over, "position")).toBe("absolute");
    expect(declared(over, "inset-block-start")).toBe("0");
    expect(declared(over, "inset-inline-start")).toBe("0");
  });

  it("draws an empty list's empty state as a roomy area that says what it is for", () => {
    const area = ruleIn(
      CANVAS_FRAME_SHEET,
      `${EMPTY_CONTAINER_SELECTOR}[data-nx-list-shows]`
    );
    // Room at the admin's size, whatever the zoom, so the words centred in
    // it and the spacing badges on its edges never meet.
    expect(declared(area, "min-height")).toBe(
      "calc(7.5rem / var(--nx-canvas-zoom, 1))"
    );
    expect(declared(area, "position")).toBe("relative");
    expect(declared(area, "justify-content")).toBe("center");
    const line = ruleIn(
      CANVAS_FRAME_SHEET,
      `${EMPTY_CONTAINER_SELECTOR}[data-nx-list-shows]::after`
    );
    expect(declared(line, "content")).toBe(
      '"Visitors see this when no entry matches. Left empty, the list shows nothing."'
    );
    expect(declared(line, "zoom")).toBe("calc(1 / var(--nx-canvas-zoom, 1))");
  });
});

describe("the Source menu's note where no related source is offered", () => {
  it("sets its heading where the list's group headings sit", () => {
    // The list's rows sit inside its own padding, and a group's heading
    // inside that; the note, drawn above the list, takes the same two
    // steps, so "Related entries" lines up with "Collections".
    const list = ruleFor(".nx-font-pick__list");
    const note = ruleFor(".nx-list-query__menu-note");
    expect(declared(note, "padding-inline")).toBe(declared(list, "padding"));
    const words = ruleFor(".nx-list-query__menu-text");
    // The words under it start where an option's words do.
    expect(declared(words, "padding-inline")).toBe(
      declared(ruleFor(".nx-font-pick__option"), "padding")?.split(" ")[1]
    );
  });
});
