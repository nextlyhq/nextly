import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import {
  APPEAR_LOAD_GATE,
  APPEAR_SCROLL_GATE,
  appearKeyframesName,
} from "./appear";
import { compilePageCss } from "./compile-page";
import { compileStyleValues } from "./declarations";
import { findUnnamespacedGlobals, findUnscopedRules } from "./isolation";
import { nodeClassName, PAGE_ROOT_CLASS } from "./node-class";
import { validateStyleValues } from "./validate-style-value";

/*
 * "Animation when it appears", compiled. The browser tests show it playing;
 * these pin what is written, which is where the promises are kept: the hidden
 * start only inside keyframes, the keyframes only where motion is asked for on
 * a screen, scroll-driven play only behind a feature test, and every part set
 * per device on its own.
 */

const page = (nodes: unknown[]): BlockDocument =>
  ({ formatVersion: 1, kind: "page", nodes }) as unknown as BlockDocument;

const box = (styles: unknown, extra: object = {}): BlockNode =>
  ({
    id: "n1",
    type: "core/box",
    version: 1,
    props: {},
    styles,
    ...extra,
  }) as unknown as BlockNode;

const compiled = (nodes: unknown[]) =>
  compilePageCss(page(nodes), { breakpoints: FIXTURE_BREAKPOINTS });

const rise = { appear: { effect: "rise", duration: 600, start: "scroll" } };

/** The block's own declarations, by property, at the base breakpoint. */
function declared(values: Record<string, unknown>): Record<string, string> {
  const { declarations, warnings } = compileStyleValues(values, "");
  expect(warnings).toEqual([]);
  return Object.fromEntries(
    declarations.map(declaration => [declaration.property, declaration.value])
  );
}

/** The sheet without its keyframes, which hold the only hidden start. */
function outsideKeyframes(css: string): string {
  return css.replace(/@keyframes[^{]*\{[^{}]*\{[^}]*\}\s*\}/g, "");
}

describe("an animation's compiled CSS", () => {
  it("writes the effect's longhands on the block, reading the other parts", () => {
    expect(declared(rise)).toEqual({
      "--nx-pb-appear-effect": "rise",
      "--nx-pb-appear-duration": "600",
      "--nx-pb-appear-start": "scroll",
      "--nx-pb-appear-stop": `var(${APPEAR_SCROLL_GATE})`,
      "--nx-pb-appear-timeline": "view()",
      "animation-name": `var(--nx-pb-appear-stop, ${appearKeyframesName("rise")})`,
      "animation-duration": "calc(var(--nx-pb-appear-duration, 600) * 1ms)",
      "animation-delay": "calc(var(--nx-pb-appear-delay, 0) * 1ms)",
      "animation-timing-function": "ease-out",
      "animation-fill-mode": "both",
      "animation-timeline": "var(--nx-pb-appear-timeline, view())",
      "animation-range": "entry 0% entry 100%",
    });
  });

  it("starts on load through the load gate, on the document's own timeline", () => {
    const written = declared({ appear: { start: "load", delay: 200 } });
    expect(written["--nx-pb-appear-stop"]).toBe(`var(${APPEAR_LOAD_GATE})`);
    expect(written["--nx-pb-appear-timeline"]).toBe("auto");
    expect(written["--nx-pb-appear-delay"]).toBe("200");
  });

  it("names one set of keyframes per effect, under the page's namespace", () => {
    const effects = [
      "fade-in",
      "rise",
      "slide-in-left",
      "slide-in-right",
      "zoom-in",
    ] as const;
    for (const effect of effects) {
      expect(declared({ appear: { effect } })["animation-name"]).toContain(
        appearKeyframesName(effect)
      );
    }
    const { css } = compiled([box({ base: { base: rise } })]);
    expect(findUnnamespacedGlobals(css, PAGE_ROOT_CLASS)).toEqual([]);
    expect(findUnscopedRules(css, PAGE_ROOT_CLASS)).toEqual([]);
  });

  it("stops the animation with None", () => {
    expect(declared({ appear: { effect: "none" } })).toEqual({
      "--nx-pb-appear-effect": "none",
      "animation-name": "none",
    });
  });

  it("refuses a time outside whole milliseconds from 0 to 10 seconds", () => {
    for (const duration of [-1, 1.5, 10_001]) {
      const issues = validateStyleValues(
        { appear: { duration, delay: duration } },
        "",
        "strict"
      );
      expect(
        issues.map(issue => issue.path),
        String(duration)
      ).toEqual(["/appear/duration", "/appear/delay"]);
    }
    expect(
      validateStyleValues(
        { appear: { duration: 10_000, delay: 0 } },
        "",
        "strict"
      )
    ).toEqual([]);
  });
});

describe("an animation per device", () => {
  it("lets a narrower device say None and keep the wider one's parts", () => {
    const { css } = compiled([
      box({
        base: {
          base: rise,
          mobile: { appear: { effect: "none" } },
        },
      }),
    ]);
    const mobile = css.slice(css.indexOf("@media (max-width: 640px)"));
    const mobileRule = /\{([^{}]*animation-name: none[^{}]*)\}/.exec(mobile);
    expect(mobileRule?.[1]).toBeDefined();
    // None at mobile writes only the stop and its own property: the desktop
    // duration and start are not repeated or reset there.
    expect(mobileRule?.[1]).not.toContain("animation-duration");
    expect(mobileRule?.[1]).not.toContain("--nx-pb-appear-start");
    expect(css.indexOf("animation-name: var(--nx-pb-appear-stop")).toBeLessThan(
      css.indexOf("@media (max-width: 640px)")
    );
  });

  it("lets a narrower device change one part alone", () => {
    const { css } = compiled([
      box({
        base: {
          base: rise,
          tablet: { appear: { duration: 300 } },
        },
      }),
    ]);
    const tablet = css.slice(css.indexOf("@media (max-width: 1024px)"));
    expect(tablet).toContain("--nx-pb-appear-duration: 300");
    expect(tablet.split("}")[1]).not.toContain("animation-name");
  });
});

describe("a page carrying an animation", () => {
  it("writes the prelude once, before its rules, and nothing without one", () => {
    const { css } = compiled([box({ base: { base: rise } })]);
    expect(
      css.split("@supports not (animation-timeline: view())")
    ).toHaveLength(2);
    expect(css.indexOf("@keyframes")).toBeLessThan(
      css.indexOf(`.${nodeClassName("n1")}`)
    );
    const plain = compiled([box({ base: { base: { opacity: 0.5 } } })]).css;
    expect(plain).not.toContain("--nx-pb-appear");
    expect(plain).not.toContain("@keyframes");
  });

  it("wraps scroll-driven play in a feature test that closes the scroll gate", () => {
    const { css } = compiled([box({ base: { base: rise } })]);
    expect(css).toContain(
      `@supports not (animation-timeline: view()) {\n  :where(.${PAGE_ROOT_CLASS}) { ${APPEAR_SCROLL_GATE}: none; }\n}`
    );
    // Every element starts on the scroll gate, the start when none is chosen.
    expect(css).toMatch(
      new RegExp(
        `:where\\(\\.${PAGE_ROOT_CLASS}, \\.${PAGE_ROOT_CLASS} \\*\\) \\{[^}]*--nx-pb-appear-stop: var\\(${APPEAR_SCROLL_GATE}\\);`
      )
    );
  });

  it("defines the keyframes only where motion is asked for, on a screen", () => {
    const { css } = compiled([box({ base: { base: rise } })]);
    const guard =
      "@media screen and (prefers-reduced-motion: no-preference) {\n";
    const opened = css.indexOf(guard);
    expect(opened).toBeGreaterThanOrEqual(0);
    const closed = css.indexOf("\n}", opened);
    const inside = css.slice(opened, closed);
    expect(inside.match(/@keyframes/g)).toHaveLength(5);
    // And nowhere else.
    expect(css.slice(0, opened) + css.slice(closed)).not.toContain(
      "@keyframes"
    );
  });

  it("hides and moves a block only inside its keyframes, and moves only opacity and the transform", () => {
    const { css } = compiled([
      box({ base: { base: { appear: { effect: "slide-in-right" } } } }),
    ]);
    const outside = outsideKeyframes(css);
    expect(outside).not.toContain("@keyframes");
    expect(outside).not.toMatch(
      /(^|[;{\s])(opacity|translate|scale|transform|visibility|display)\s*:/
    );
    for (const frames of css.match(/@keyframes[^{]*\{[^{}]*\{[^}]*\}/g) ?? []) {
      const properties = [...frames.matchAll(/([a-z-]+)\s*:/g)].map(
        match => match[1]
      );
      for (const property of properties) {
        expect(["opacity", "translate", "scale"]).toContain(property);
      }
    }
  });

  it("clips the page's sideways overflow only for a slide", () => {
    const clip = `:where(.${PAGE_ROOT_CLASS}) { overflow-x: clip; }`;
    expect(
      compiled([
        box({ base: { base: { appear: { effect: "slide-in-left" } } } }),
      ]).css
    ).toContain(clip);
    expect(compiled([box({ base: { base: rise } })]).css).not.toContain(clip);
  });

  it("keeps the prelude in the sheet when the animated block is gated", () => {
    const { css, gated } = compiled([
      box(
        { base: { base: rise } },
        {
          visibility: {
            conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
          },
        }
      ),
    ]);
    expect(gated?.n1).toContain("animation-name");
    expect(css).toContain("@keyframes");
    expect(css).not.toContain("animation-name");
  });
});
