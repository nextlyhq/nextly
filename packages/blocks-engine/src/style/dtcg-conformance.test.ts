/**
 * The written design-token file is valid DTCG 2025.10.
 *
 * Checked against the format's rules as written: names, the reserved `$`
 * properties a group and a token may hold, each type's value shape
 * (including the `shadow` and `typography` composites), and every alias
 * resolving to a token of the type its place requires. A file with every
 * kind of variable, shadows as fields and as Nextly data, text styles and
 * the site's own data must pass with nothing to say.
 */
import { describe, expect, it } from "vitest";

import { tokensToDtcg, type DtcgNode } from "./dtcg";
import type { NamedClass } from "./named-class";
import { defaultSiteTokens, type SiteToken } from "./site-tokens";

const GROUP_PROPERTIES = new Set([
  "$type",
  "$description",
  "$extensions",
  "$deprecated",
  "$extends",
  "$root",
]);
const TOKEN_PROPERTIES = new Set([
  "$value",
  "$type",
  "$description",
  "$extensions",
  "$deprecated",
]);
const TYPES = new Set([
  "color",
  "dimension",
  "fontFamily",
  "fontWeight",
  "duration",
  "cubicBezier",
  "number",
  "strokeStyle",
  "border",
  "transition",
  "shadow",
  "gradient",
  "typography",
]);
const WEIGHT_KEYWORDS = new Set([
  "thin",
  "hairline",
  "extra-light",
  "ultra-light",
  "light",
  "normal",
  "regular",
  "book",
  "medium",
  "semi-bold",
  "demi-bold",
  "bold",
  "extra-bold",
  "ultra-bold",
  "black",
  "heavy",
  "extra-black",
  "ultra-black",
]);

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Every token in the file by path, with its own or inherited type. */
function tokensOf(
  node: Node,
  at: string[] = [],
  inherited?: string,
  found = new Map<string, { node: Node; type?: string }>()
): Map<string, { node: Node; type?: string }> {
  const type = typeof node.$type === "string" ? node.$type : inherited;
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$") || !isNode(child)) continue;
    const here = [...at, key];
    if ("$value" in child) {
      found.set(here.join("."), {
        node: child,
        type: typeof child.$type === "string" ? child.$type : type,
      });
    } else tokensOf(child, here, type, found);
  }
  return found;
}

/** What makes a file not valid DTCG 2025.10, one line per problem. */
function problemsOf(document: Node): string[] {
  const problems: string[] = [];
  const tokens = tokensOf(document);
  const aliasType = (text: string): string | undefined =>
    tokens.get(text.slice(1, -1))?.type;
  const isAlias = (value: unknown): value is string =>
    typeof value === "string" && /^\{[^{}]+\}$/.test(value);

  const valueOk = (type: string, value: unknown, at: string): boolean => {
    if (isAlias(value)) {
      const target = aliasType(value);
      if (target !== type) {
        problems.push(
          `${at}: ${value} is a ${target ?? "missing token"}, not a ${type}`
        );
      }
      return true;
    }
    switch (type) {
      case "color":
        return (
          isNode(value) &&
          typeof value.colorSpace === "string" &&
          Array.isArray(value.components) &&
          value.components.length === 3 &&
          value.components.every(
            part => typeof part === "number" && part >= 0 && part <= 1
          ) &&
          (value.alpha === undefined ||
            (typeof value.alpha === "number" &&
              value.alpha >= 0 &&
              value.alpha <= 1)) &&
          (value.hex === undefined ||
            (typeof value.hex === "string" &&
              /^#[0-9a-f]{6}$/i.test(value.hex)))
        );
      case "dimension":
        return (
          isNode(value) &&
          typeof value.value === "number" &&
          (value.unit === "px" || value.unit === "rem")
        );
      case "duration":
        return (
          isNode(value) &&
          typeof value.value === "number" &&
          (value.unit === "ms" || value.unit === "s")
        );
      case "fontFamily":
        return (
          (typeof value === "string" && value !== "") ||
          (Array.isArray(value) &&
            value.length > 0 &&
            value.every(name => typeof name === "string" && name !== ""))
        );
      case "fontWeight":
        return (
          (typeof value === "number" && value >= 1 && value <= 1000) ||
          (typeof value === "string" && WEIGHT_KEYWORDS.has(value))
        );
      case "number":
        return typeof value === "number";
      case "shadow": {
        const layers = Array.isArray(value) ? value : [value];
        return (
          layers.length > 0 &&
          layers.every(
            layer =>
              isNode(layer) &&
              valueOk("color", layer.color, `${at}.color`) &&
              ["offsetX", "offsetY", "blur", "spread"].every(part =>
                valueOk("dimension", layer[part], `${at}.${part}`)
              ) &&
              (layer.inset === undefined || typeof layer.inset === "boolean")
          )
        );
      }
      case "typography":
        return (
          isNode(value) &&
          (
            [
              ["fontFamily", "fontFamily"],
              ["fontSize", "dimension"],
              ["fontWeight", "fontWeight"],
              ["letterSpacing", "dimension"],
              ["lineHeight", "number"],
            ] as const
          ).every(([part, partType]) =>
            valueOk(partType, value[part], `${at}.${part}`)
          )
        );
      default:
        return false;
    }
  };

  const walk = (node: Node, at: string[]): void => {
    for (const [key, child] of Object.entries(node)) {
      const here = [...at, key].join(".");
      if (key.startsWith("$")) {
        if (!GROUP_PROPERTIES.has(key))
          problems.push(`${here}: not a group property`);
        if (key === "$extensions" && !isNode(child))
          problems.push(`${here}: not an object`);
        if (key === "$type" && !TYPES.has(String(child)))
          problems.push(`${here}: no such type`);
        continue;
      }
      if (/[.{}]/.test(key)) problems.push(`${here}: not a name`);
      if (!isNode(child)) {
        problems.push(`${here}: neither a token nor a group`);
        continue;
      }
      if (!("$value" in child)) {
        walk(child, [...at, key]);
        continue;
      }
      for (const property of Object.keys(child)) {
        if (!TOKEN_PROPERTIES.has(property))
          problems.push(`${here}.${property}: not a token property`);
      }
      if (child.$extensions !== undefined && !isNode(child.$extensions)) {
        problems.push(`${here}.$extensions: not an object`);
      }
      if (
        child.$description !== undefined &&
        typeof child.$description !== "string"
      ) {
        problems.push(`${here}.$description: not a string`);
      }
      const type = tokens.get(here)?.type;
      if (type === undefined || !TYPES.has(type)) {
        problems.push(`${here}: no type`);
        continue;
      }
      if (!valueOk(type, child.$value, here))
        problems.push(`${here}: not a ${type} value`);
    }
  };
  walk(document, []);
  return problems;
}

const ONE_OF_EACH: SiteToken[] = [
  {
    id: "c-brand",
    name: "brand.ink",
    label: "Ink",
    kind: "color",
    group: "Brand",
    values: { light: "#123456", dark: "rgb(200 210 220 / 0.9)" },
  },
  {
    name: "gap.fluid",
    kind: "dimension",
    fluid: { small: 16, large: 24 },
    values: { light: "clamp(1rem, 0.6087rem + 1.7391vw, 1.5rem)" },
  },
  { name: "gap.em", kind: "dimension", values: { light: "1.5em" } },
  { name: "type.heavy", kind: "fontWeight", values: { light: "800" } },
  { name: "type.ratio", kind: "number", values: { light: "1.25" } },
  { name: "motion.slow", kind: "duration", values: { light: "400ms" } },
  {
    name: "shadow.two",
    kind: "shadow",
    values: {
      light: "0 1px 2px #000000, inset 0 4px 8px 1px var(--site-c-brand)",
    },
  },
  { name: "shadow.odd", kind: "shadow", values: { light: "0 1px 2px" } },
  { name: "misc.ratio", kind: "custom", values: { light: "16 / 9" } },
];

const TEXT_STYLES: NamedClass[] = [
  {
    id: "ts-eyebrow",
    slug: "eyebrow",
    label: "Eyebrow",
    orderIndex: 0,
    role: "text",
    styles: {
      base: {
        base: {
          fontSize: { $token: "font-size.h2" },
          fontWeight: { $token: "type.heavy" },
          textTransform: "uppercase",
        },
      },
    },
  },
  {
    id: "ts-loose",
    slug: "loose",
    orderIndex: 1,
    role: "text",
    styles: { base: { base: { letterSpacing: "0.1em" } } },
  },
];

describe("the written design-token file", () => {
  it("is valid DTCG 2025.10, with every kind, shadows, text styles and the site's data", () => {
    const { document, issues } = tokensToDtcg(
      {
        tokens: [...defaultSiteTokens(), ...ONE_OF_EACH],
        siteText: { h2: { fontSize: { $token: "font-size.h2" } } },
        order: ["c-brand"],
        fluidRange: { min: 320, max: 1440 },
        builtInColoursShown: false,
      },
      { textStyles: TEXT_STYLES }
    );
    expect(issues).toEqual([]);
    const file = JSON.parse(JSON.stringify(document)) as DtcgNode;
    expect(problemsOf(file)).toEqual([]);
    // It holds the composites the check is for.
    const types = [...tokensOf(file).values()].map(entry => entry.type);
    expect(types).toContain("shadow");
    expect(types).toContain("typography");
  });

  it("is checked by a check that finds what isn't valid", () => {
    expect(
      problemsOf({
        lift: {
          $type: "shadow",
          $value: { color: "{nowhere}", offsetX: { value: 1, unit: "em" } },
        },
        "a.b": { $type: "number", $value: 1 },
        style: { $type: "typography", $value: { fontFamily: "Inter" } },
      })
    ).toEqual([
      "lift.color: {nowhere} is a missing token, not a color",
      "lift: not a shadow value",
      "a.b: not a name",
      "style: not a typography value",
    ]);
  });
});
