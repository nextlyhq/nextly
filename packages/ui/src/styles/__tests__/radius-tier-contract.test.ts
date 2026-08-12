/**
 * Pins the corner-radius contract to the code that is supposed to implement it.
 *
 * The tier table is documented twice — in `theme.css` next to the token
 * definitions, and in the plugin authoring guide — and neither is executable, so
 * a component can change its corner, or a tier list can be edited, without
 * anything failing. That is how the two ended up describing different systems:
 * alerts and table wrappers listed as containers when they ship one step
 * tighter, switches and tabs listed in tiers they deliberately sit outside, and
 * `rounded-xl` / `rounded-2xl` presented as steps of the knob when the published
 * preset never exported them.
 *
 * These assertions cover the claims a plugin author would act on: which step a
 * representative component of each tier actually uses, which steps the preset
 * ships, and that the two documents agree with each other.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = resolve(HERE, "../theme.css");
const DOC = resolve(HERE, "../../../docs/plugin-ui-authoring.md");
const PRESET = resolve(HERE, "../../tailwind-preset.ts");
const COMPONENTS = resolve(HERE, "../../components");

/** The steps the contract covers. `full` and `none` are outside it by design. */
const TIERS = ["sm", "md", "lg"] as const;

const RADIUS_CLASS =
  /\brounded(?:-(?:t|b|l|r|tl|tr|bl|br))?-(?:lg|md|sm|xl|2xl|full|none|\[[^\]]+\])/g;

/** A line that is nothing but a comment documents, it does not style. */
function isComment(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  );
}

/** Every radius class a component actually applies, docblocks excluded. */
function radiusClassesOf(component: string): string[] {
  const source = readFileSync(
    resolve(COMPONENTS, `${component}.tsx`),
    "utf8"
  ).split("\n");
  const found = new Set<string>();
  for (const line of source) {
    if (isComment(line)) continue;
    for (const match of line.matchAll(RADIUS_CLASS)) found.add(match[0]);
  }
  return [...found].sort();
}

/**
 * One representative per documented claim. The expected list is the complete
 * set the file applies, so a component picking up a new corner fails here rather
 * than drifting away from the tier it is documented under.
 */
const COMPONENT_CLAIMS: { component: string; classes: string[] }[] = [
  // rounded-lg containers.
  { component: "popover", classes: ["rounded-lg"] },
  { component: "tooltip", classes: ["rounded-lg"] },
  { component: "alert-dialog", classes: ["rounded-lg"] },
  // Card is lg, plus the two inherit corners its header and footer use to stay
  // matched with whatever radius the card ends up with.
  {
    component: "card",
    classes: ["rounded-b-[inherit]", "rounded-lg", "rounded-t-[inherit]"],
  },
  // rounded-md controls. Alert is here, not in the container tier.
  { component: "button", classes: ["rounded-md"] },
  { component: "input", classes: ["rounded-md"] },
  { component: "textarea", classes: ["rounded-md"] },
  { component: "alert", classes: ["rounded-md"] },
  // Dialog: lg panel, md close icon button.
  { component: "dialog", classes: ["rounded-lg", "rounded-md"] },
  // rounded-sm adornments. Checkbox is here, not in the control tier.
  { component: "badge", classes: ["rounded-sm"] },
  { component: "checkbox", classes: ["rounded-sm"] },
  { component: "dropdown-menu", classes: ["rounded-lg", "rounded-sm"] },
  // Deliberately outside the scale, each with a stated reason in the source.
  { component: "switch", classes: ["rounded-full"] },
  { component: "avatar", classes: ["rounded-full"] },
  { component: "tabs", classes: ["rounded-none"] },
  // Anchored to the viewport edge, so it carries no corner at all.
  { component: "sheet", classes: [] },
];

describe("radius tier contract", () => {
  it.each(COMPONENT_CLAIMS)(
    "$component applies exactly $classes",
    ({ component, classes }) => {
      expect(
        radiusClassesOf(component),
        `${component}.tsx no longer matches the tier it is documented under in ` +
          `theme.css and docs/plugin-ui-authoring.md. Update the component or ` +
          `both documents, not just one.`
      ).toEqual(classes);
    }
  );

  it("no component reaches for a step the preset does not export", () => {
    const offenders = COMPONENT_CLAIMS.filter(({ component }) =>
      radiusClassesOf(component).some(cls => /-(?:xl|2xl)$/.test(cls))
    ).map(({ component }) => component);

    expect(
      offenders,
      `rounded-xl / rounded-2xl are not part of the scale: the preset exports ` +
        `only lg/md/sm, and both add to --radius instead of subtracting, so they ` +
        `are 4px and 8px at the shipped --radius: 0.`
    ).toEqual([]);
  });
});

describe("the published preset", () => {
  const preset = readFileSync(PRESET, "utf8");

  it("exports exactly the documented steps", () => {
    const block = /borderRadius:\s*\{([^}]*)\}/.exec(preset)?.[1] ?? "";
    const keys = [...block.matchAll(/^\s*([a-z0-9]+)\s*:/gm)].map(m => m[1]);

    expect(
      keys.sort(),
      `A plugin built against the preset can only use the steps it exports. ` +
        `Adding one here means adding it to the tier tables too.`
    ).toEqual([...TIERS].sort());
  });

  it.each(TIERS)("derives %s from the --radius knob", tier => {
    expect(preset).toMatch(new RegExp(`${tier}:\\s*"[^"]*var\\(--radius\\)`));
  });
});

describe("the two tier documents", () => {
  const theme = readFileSync(THEME, "utf8");
  const doc = readFileSync(DOC, "utf8");

  /**
   * The knob as the theme ships it, taken from the declaration itself. Both
   * documents describe the admin at this value, so it is the thing they have to
   * agree on rather than any one number that falls out of it.
   */
  const SHIPPED_KNOB = (() => {
    const found = /^\s*--radius:\s*([^;]+);/m.exec(theme)?.[1]?.trim();
    if (!found) throw new Error("theme.css declares no --radius knob");
    return found;
  })();

  /** A CSS length in px. Only the units the knob is written in are supported. */
  function toPx(length: string): number {
    const [, value = "", unit = ""] = /^([\d.]+)(px|rem)$/.exec(length) ?? [];
    if (!unit) throw new Error(`--radius is not a px/rem length: ${length}`);
    return unit === "rem" ? Number(value) * 16 : Number(value);
  }

  /**
   * What each tier computes to at the shipped knob, derived from the theme's own
   * `calc()` offsets. Reading the offsets rather than restating them keeps this
   * correct if a step is ever re-spaced.
   */
  /**
   * The prose of a document, with the radius DECLARATIONS removed.
   *
   * Both assertions below ask what a document SAYS the shipped values are, and
   * `calc(var(--radius) - 4px)` is not a statement of that -- it is the offset
   * the value is computed from, which coincides with a tier result only by
   * accident. Left in, it answers the `sm` assertion on its own and the check
   * passes over prose describing a completely different knob.
   */
  function proseOf(source: string): string {
    // Bounded to one line: a declaration ends with `;` on the line it starts.
    // Unbounded, the run to the next `;` anywhere in the file deletes whole
    // paragraphs of a Markdown document, and the assertions then pass or fail on
    // prose that was never read.
    return source.replace(/--radius(?:-[a-z0-9]+)?:[^;\n]*;/g, "");
  }

  /**
   * Whether a document states a length, as a length rather than as a fragment
   * of one. `4px` occurs inside `-4px` and `14px`, and `6px` inside `16px`, so
   * a substring test reports agreement between documents describing different
   * knobs -- the precise flaw this check replaced.
   */
  function states(source: string, length: string): boolean {
    return new RegExp(`(?<![\\d.\\-])${length}\\b`).test(source);
  }

  const SHIPPED_TIERS = Object.fromEntries(
    TIERS.map(tier => {
      const declaration = new RegExp(
        `--radius-${tier}:\\s*(?:calc\\(\\s*var\\(--radius\\)\\s*([+-])\\s*([\\d.]+px)\\s*\\)|var\\(--radius\\))`
      ).exec(theme);
      if (!declaration)
        throw new Error(`theme.css declares no --radius-${tier}`);
      const [, sign, offset] = declaration;
      const delta = sign && offset ? toPx(offset) * (sign === "-" ? -1 : 1) : 0;
      return [tier, toPx(SHIPPED_KNOB) + delta];
    })
  ) as Record<(typeof TIERS)[number], number>;

  it.each(TIERS)("theme.css defines --radius-%s from the knob", tier => {
    expect(theme).toMatch(
      new RegExp(`--radius-${tier}:\\s*(?:calc\\()?\\s*var\\(--radius\\)`)
    );
  });

  it("neither presents xl or 2xl as a tier to pick from", () => {
    // They exist as tokens, but the guide must not table them as options: the
    // preset has no such steps, so a plugin using one silently leaves the scale.
    const tierTableRows = doc
      .split("\n")
      .filter(line => line.startsWith("| `rounded-"));

    expect(tierTableRows.length).toBeGreaterThan(3);
    expect(tierTableRows.join("\n")).not.toMatch(/rounded-2?xl/);
  });

  it("both state the knob the theme actually ships", () => {
    // Read from the declaration rather than restated here, so changing the
    // shipped default cannot leave this check agreeing with a stale document.
    // A substring probe for one incidental value (`-4px`) does not do this
    // work: it stays green while both documents describe a different knob,
    // because the theme's explanation of a LOW knob still contains it.
    for (const [name, source] of [
      ["theme.css", theme],
      ["plugin-ui-authoring.md", doc],
    ] as const) {
      expect(
        states(proseOf(source), SHIPPED_KNOB),
        `${name} does not state the shipped --radius (${SHIPPED_KNOB}). ` +
          `Changing the knob means updating both documents, not just the theme.`
      ).toBe(true);
    }
  });

  it.each(TIERS)("both state what %s computes to at the shipped knob", tier => {
    // The tier values are derived from the knob and the theme's own calc()
    // offsets, so a document quoting the arithmetic of a previous default fails
    // here instead of misinforming a plugin author.
    const expected = `${SHIPPED_TIERS[tier]}px`;
    for (const [name, source] of [
      ["theme.css", theme],
      ["plugin-ui-authoring.md", doc],
    ] as const) {
      expect(
        states(proseOf(source), expected),
        `${name} does not state that --radius-${tier} is ${expected} at the ` +
          `shipped --radius: ${SHIPPED_KNOB}.`
      ).toBe(true);
    }
  });

  it("both record that the lower steps go negative at a low knob", () => {
    // sm and md subtract, so a knob under 4px computes them negative;
    // border-radius clamps that, a padding or a JS read does not. The claim is
    // conditional on the knob, so it stays true across defaults — but only the
    // check above notices when the default itself moves.
    expect(SHIPPED_TIERS.sm).toBeGreaterThan(0);
    for (const [name, source] of [
      ["theme.css", theme],
      ["plugin-ui-authoring.md", doc],
    ] as const) {
      expect(source, `${name} must state the negative-step behaviour`).toMatch(
        /-4px/
      );
    }
  });

  it.each([
    // Element category, and the tier heading it must sit under in both files.
    { element: "alerts", tier: "md" },
    { element: "table wrappers", tier: "md" },
    { element: "image frames", tier: "md" },
    { element: "checkboxes", tier: "sm" },
    { element: "icon buttons", tier: "md" },
    { element: "badges", tier: "sm" },
  ])("both file $element under the $tier tier", ({ element, tier }) => {
    for (const [name, source, headings] of [
      ["theme.css", theme, TIERS.map(t => `rounded-${t} (--radius-${t}`)],
      ["plugin-ui-authoring.md", doc, TIERS.map(t => `| \`rounded-${t}\``)],
    ] as const) {
      // The tier a term falls under is the last tier heading before it.
      const at = source.indexOf(element);
      expect(at, `${name} no longer mentions "${element}"`).toBeGreaterThan(-1);

      const owning = headings
        .map((heading, index) => ({ index, at: source.indexOf(heading) }))
        .filter(entry => entry.at > -1 && entry.at < at)
        .sort((a, b) => b.at - a.at)[0];

      expect(
        owning && TIERS[owning.index],
        `${name} files "${element}" under the wrong tier`
      ).toBe(tier);
    }
  });
});
