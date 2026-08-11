/**
 * Guards that the font-weight tokens stay in Tailwind's font-WEIGHT namespace.
 *
 * `--font-*` is the font-FAMILY namespace and `--font-weight-*` is the weight
 * one. A weight declared as `--font-bold: 700` therefore registers a family
 * literally named "bold", and `font-bold` compiles to `font-family: 700` —
 * which browsers discard. Worse, that generated utility shadows the real weight
 * utility rather than adding to it, so every `font-bold` in the product silently
 * stops setting a weight: no build error, no browser warning, just text that
 * renders at the inherited weight.
 *
 * The check runs at both ends. It reads `theme.css` to assert the declarations
 * sit in the right namespace, and it compiles the sheet with Tailwind to assert
 * the utilities actually emit a `font-weight` resolving to the intended number,
 * which is the property the failure mode destroys.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postcss from "postcss";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const THEME_PATH = resolve(HERE, "../theme.css");
const css = readFileSync(THEME_PATH, "utf8");

/** The weights the admin uses, and the number each utility must end up at. */
const WEIGHTS = {
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

/** Every weight name Tailwind ships a `font-*` utility for. */
const ALL_WEIGHT_NAMES = [
  "thin",
  "extralight",
  "light",
  "normal",
  "medium",
  "semibold",
  "bold",
  "extrabold",
  "black",
] as const;

/** Custom-property declarations inside the sheet's `@theme` at-rules. */
function themeDeclarations(source: string): Map<string, string> {
  const out = new Map<string, string>();
  postcss.parse(source).walkAtRules("theme", atRule => {
    atRule.walkDecls(decl => {
      if (!decl.prop.startsWith("--")) return;
      out.set(decl.prop, decl.value.replace(/\s+/g, " ").trim());
    });
  });
  return out;
}

/**
 * Compiles the theme against Tailwind and returns the generated CSS for the
 * given utilities, so the assertions read the same output a build would emit.
 */
async function buildUtilities(
  source: string,
  candidates: string[]
): Promise<string> {
  const compiler = await compile(`@import "tailwindcss";\n${source}`, {
    base: dirname(THEME_PATH),
    loadStylesheet: async (id, base) => {
      const path =
        id === "tailwindcss"
          ? require.resolve("tailwindcss/index.css")
          : require.resolve(id, { paths: [base] });
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  return compiler.build(candidates);
}

/** Declarations of a single class rule in compiled CSS, keyed by property. */
function ruleDeclarations(source: string, selector: string) {
  const out = new Map<string, string>();
  postcss.parse(source).walkRules(rule => {
    if (rule.selector !== selector) return;
    // A statement body, not an expression one. postcss types this callback
    // `(decl, index) => false | void` and treats a returned `false` as "stop
    // walking", so returning the Map both fails the signature and makes the
    // walk's continuation depend on the truthiness of a value that has nothing
    // to do with it. It happens to be truthy, which is why nothing was wrong
    // on screen -- and a check whose completeness rests on that is one edit
    // away from silently reading a partial rule.
    rule.walkDecls(decl => {
      out.set(decl.prop, decl.value.trim());
    });
  });
  return out;
}

/** Follows a `var(--x)` chain through the compiled sheet's custom properties. */
function resolveValue(source: string, value: string): string {
  const properties = new Map<string, string>();
  postcss.parse(source).walkDecls(decl => {
    if (decl.prop.startsWith("--"))
      properties.set(decl.prop, decl.value.trim());
  });
  let current = value;
  for (let hops = 0; hops < 8; hops++) {
    const match = current.match(/^var\((--[\w-]+)\)$/);
    if (!match) break;
    const next = properties.get(match[1]);
    if (next === undefined) return current;
    current = next;
  }
  return current;
}

const CANDIDATES = Object.keys(WEIGHTS).map(name => `font-${name}`);
const compiled = await buildUtilities(css, CANDIDATES);

describe("font weight tokens", () => {
  const declarations = themeDeclarations(css);

  it.each(Object.entries(WEIGHTS))(
    "declares --font-weight-%s in the weight namespace",
    (name, weight) => {
      expect(
        declarations.get(`--font-weight-${name}`),
        `--font-weight-${name} must be declared in @theme; without it the ` +
          `font-${name} utility resolves to nothing`
      ).toBe(weight);
    }
  );

  it.each(ALL_WEIGHT_NAMES)(
    "does not declare --font-%s in the family namespace",
    name => {
      expect(
        declarations.has(`--font-${name}`),
        `--font-${name} is the font-FAMILY namespace. Declaring a weight there ` +
          `makes font-${name} compile to font-family, which browsers discard, ` +
          `and it shadows the real weight utility. Use --font-weight-${name}.`
      ).toBe(false);
    }
  );

  it("declares no numeric value anywhere in the family namespace", () => {
    const numeric = [...declarations].filter(
      ([prop, value]) =>
        prop.startsWith("--font-") &&
        !prop.startsWith("--font-weight-") &&
        /^\d+$/.test(value)
    );
    expect(
      numeric,
      `a bare number in the --font-* namespace is a weight in the family ` +
        `namespace: ${numeric.map(([p, v]) => `${p}: ${v}`).join(", ")}`
    ).toEqual([]);
  });

  it.each(Object.entries(WEIGHTS))(
    "compiles .font-%s to a real font-weight",
    (name, weight) => {
      const rule = ruleDeclarations(compiled, `.font-${name}`);
      expect(
        rule.size,
        `no .font-${name} rule was generated at all`
      ).toBeGreaterThan(0);
      expect(
        rule.has("font-family"),
        `.font-${name} sets font-family. The token is in the family namespace, ` +
          `so the utility no longer sets a weight and the declaration is dropped ` +
          `by the browser.`
      ).toBe(false);
      const emitted = rule.get("font-weight");
      expect(
        emitted,
        `.font-${name} emits no font-weight declaration`
      ).toBeDefined();
      expect(
        resolveValue(compiled, emitted ?? ""),
        `.font-${name} must resolve to ${weight}`
      ).toBe(weight);
    }
  );
});
