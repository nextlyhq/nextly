/**
 * Which stored templates must keep today's rendering.
 *
 * The `{{variable}}` engine filled `{{name}}` and `{{a.b}}` and sent every
 * other brace as written. Read as Liquid, a template stored before Liquid
 * could mean something else: a literal `{% if %}` would become a condition, a
 * `|` inside braces a filter, and `{{0}}` the number zero rather than a
 * variable named "0". Such a template keeps the old rendering until someone
 * changes what was flagged and confirms it should be read as Liquid.
 *
 * Detection is conservative: anything Liquid might read differently is
 * flagged, so no stored email changes without a person deciding it should.
 */

import { parseLiquid, readsVariable } from "./liquid-engine";
import type { TemplateFields } from "./render-template";

/** The fields Liquid renders. */
type LiquidSource = Pick<
  TemplateFields,
  "subject" | "htmlContent" | "plainTextContent" | "preheader"
>;

/** The fields Liquid renders, with the name a person reads in the workbench. */
export const LIQUID_FIELDS: ReadonlyArray<[keyof LiquidSource, string]> = [
  ["subject", "Subject"],
  ["preheader", "Preview text"],
  ["htmlContent", "HTML"],
  ["plainTextContent", "Plain text"],
];

/**
 * A `{{…}}` both engines read the same way: a plain variable path. Not a
 * Liquid literal (`true`, `nil`, a number), and no segment Liquid treats as a
 * property of its own (`size`, `first`, `last`).
 */
const VARIABLE_PATH = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/;
const LIQUID_WORDS = new Set([
  "true",
  "false",
  "nil",
  "null",
  "empty",
  "blank",
]);
const LIQUID_PROPERTIES = new Set(["size", "first", "last"]);
/** What the data object itself inherits; the root of every path reads it. */
const ROOT_PROTOTYPE_KEYS = new Set(
  Object.getOwnPropertyNames(Object.prototype)
);
const PROTOTYPE_KEYS = new Set([
  ...ROOT_PROTOTYPE_KEYS,
  ...Object.getOwnPropertyNames(Array.prototype),
  ...Object.getOwnPropertyNames(String.prototype),
]);
const OLD_TOKEN = /{{\s*([\w.]+)\s*}}/g;

function readsTheSame(path: string): boolean {
  if (!VARIABLE_PATH.test(path)) return false;
  const [root, ...rest] = path.split(".");
  // A property only an object's prototype has (`constructor`, `toString`):
  // the old engine read it, and Liquid reads own properties only.
  if (LIQUID_WORDS.has(root) || ROOT_PROTOTYPE_KEYS.has(root)) return false;
  return !rest.some(
    segment => LIQUID_PROPERTIES.has(segment) || PROTOTYPE_KEYS.has(segment)
  );
}

/** Why a field would render differently as Liquid, or null when it would not. */
export function oldEngineReason(
  source: string | null | undefined
): string | null {
  if (!source) return null;
  for (const match of source.matchAll(OLD_TOKEN)) {
    if (!readsTheSame(match[1])) {
      return `“${match[0]}” is a variable to the old engine and something else to Liquid.`;
    }
  }
  // What the old engine left as text, with its own variables taken out.
  const rest = source.replace(OLD_TOKEN, "");
  if (rest.includes("{%"))
    return "It holds “{%”, which the old engine sent as text and Liquid reads as a tag.";
  if (rest.includes("{{"))
    return "It holds “{{” that the old engine sent as text and Liquid reads as output.";
  const parsed = parseLiquid(source);
  if ("problem" in parsed)
    return `Liquid can't read it: ${parsed.problem.message}`;
  return null;
}

/**
 * Whether a template reads the top-level variable `name`, on the engine it
 * renders with: as the old engine's `{{path}}` tokens do for a template kept
 * on it (`legacy`) or text Liquid can't parse, and as Liquid reads it
 * otherwise.
 */
export function templateReadsVariable(
  source: string,
  name: string,
  legacy = false
): boolean {
  if (!legacy && !("problem" in parseLiquid(source))) {
    return readsVariable(source, name);
  }
  for (const match of source.matchAll(OLD_TOKEN)) {
    if (match[1].split(".")[0] === name) return true;
  }
  return false;
}

/** Each field of a template that would render differently as Liquid, with why. */
export function oldEngineReasons(
  version: Partial<Record<keyof LiquidSource, string | null | undefined>>
): Array<{ field: keyof LiquidSource; label: string; reason: string }> {
  return LIQUID_FIELDS.flatMap(([field, label]) => {
    const reason = oldEngineReason(version[field]);
    return reason ? [{ field, label, reason }] : [];
  });
}
