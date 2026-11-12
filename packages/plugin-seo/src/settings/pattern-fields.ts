/**
 * Which of a content type's fields its title pattern may name, and the
 * variable each is named by. Server-side: it reads the type's schema.
 *
 * @module settings/pattern-fields
 */
import { humanizeFieldName } from "@nextlyhq/plugin-sdk";

import type { PatternField } from "./contract";
import { SITE_NAME_TOKEN, TITLE_FIELDS, tokenKey } from "./patterns";

/** A field as the schema declares it, as far as a pattern needs it. */
export interface PatternFieldSource {
  name?: string;
  type: string;
  label?: unknown;
}

/**
 * Field types whose stored value is text or a number at the top of the
 * document, which is what the resolver can put in a title. A relation, a
 * date or a media field stores an id or a timestamp, not words.
 */
const FILLABLE_TYPES: ReadonlySet<string> = new Set([
  "text",
  "textarea",
  "email",
  "number",
]);

/** The fields never offered on their own: `{Title}` already stands for them. */
const NOT_OFFERED: ReadonlySet<string> = new Set([
  ...TITLE_FIELDS.map(tokenKey),
  tokenKey(SITE_NAME_TOKEN),
]);

/**
 * The variable that names `field`: its label where the label is the field's
 * name in other words, else the name made readable. A variable is matched by
 * name, so a label naming something else would make one that never fills.
 */
export function tokenOf(field: { name: string; label?: unknown }): string {
  const { name, label } = field;
  if (typeof label === "string" && tokenKey(label) === tokenKey(name)) {
    return label.trim();
  }
  return humanizeFieldName(name);
}

/** The fields of a type a pattern may name, in their order. */
export function patternFields(
  fields: readonly PatternFieldSource[]
): PatternField[] {
  const offered: PatternField[] = [];
  for (const field of fields) {
    const { name } = field;
    if (typeof name !== "string" || name === "") continue;
    if (!FILLABLE_TYPES.has(field.type)) continue;
    if (NOT_OFFERED.has(tokenKey(name))) continue;
    offered.push({ name, token: tokenOf({ name, label: field.label }) });
  }
  return offered;
}
