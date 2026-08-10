/**
 * Turning rules into CSS text, byte for byte the same every time.
 *
 * The guarantee this module carries is that the same inputs produce the same
 * bytes on every machine and every Node version. That rules out anything that
 * reads a locale, anything that depends on the order a JavaScript object
 * happens to enumerate its keys, and anything that formats a number through a
 * facility whose output can be configured.
 *
 * The output is one rule per line. It is inlined into a page, so every byte
 * counts, but somebody will eventually read it in a browser's devtools while
 * trying to work out why a block looks wrong, and a stylesheet that is one
 * enormous line is a poor answer to that.
 *
 * @module style/serialize
 */
import type { Declaration } from "./declarations";

/** One block of declarations under one selector, optionally inside an at-rule. */
export interface CssRule {
  /**
   * The at-rule this sits inside, written in full: `@media (max-width: 900px)`
   * or `@container (max-width: 40rem)`. Absent means the rule is unconditional.
   */
  atRule?: string;
  selector: string;
  declarations: readonly Declaration[];
}

/** Serialize one declaration list. */
function declarationsText(declarations: readonly Declaration[]): string {
  return declarations
    .map(({ property, value }) => `${property}: ${value}`)
    .join("; ");
}

/**
 * Serialize rules to CSS.
 *
 * Rules are emitted in the order given, because that order IS the cascade: the
 * whole design puts every rule at the same specificity and lets source order
 * decide, so re-sorting here would silently reorder the tiers. Consecutive
 * rules sharing an at-rule are grouped into one block, which is what a person
 * reading the output expects and what keeps `@media` from repeating once per
 * node.
 */
export function serializeRules(rules: readonly CssRule[]): string {
  const lines: string[] = [];
  let openAtRule: string | undefined;
  for (const rule of rules) {
    if (rule.declarations.length === 0) continue;
    if (rule.atRule !== openAtRule) {
      if (openAtRule !== undefined) lines.push("}");
      if (rule.atRule !== undefined) lines.push(`${rule.atRule} {`);
      openAtRule = rule.atRule;
    }
    const indent = openAtRule === undefined ? "" : "  ";
    lines.push(
      `${indent}${rule.selector} { ${declarationsText(rule.declarations)} }`
    );
  }
  if (openAtRule !== undefined) lines.push("}");
  return lines.join("\n");
}
