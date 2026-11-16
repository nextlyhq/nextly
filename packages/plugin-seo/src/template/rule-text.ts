/**
 * A template's rule as a person writes it and as the Page Builder stores it.
 *
 * Written, a rule is text with variables, `{Post title} | {Site name}`, as a
 * content type's title pattern is. Stored, it is a list of literal text and
 * bindings joined in order, which the Page Builder fills per entry with its
 * own binding pass: a variable is a binding to the entry's field it names,
 * and `{Site name}` a binding to the site's name. Nothing in literal text is
 * read as a placeholder once stored.
 *
 * @module template/rule-text
 */
import type { PatternField } from "../settings/contract";
import { SITE_NAME_TOKEN, tokenKey } from "../settings/patterns";

/** A stored binding, as far as a rule's text reads it. */
export interface RuleBinding {
  $bind: string;
  source?: string;
  [option: string]: unknown;
}

/** One piece of a stored rule: literal text, or a binding. */
export type RuleSegment = string | RuleBinding;

/** The site's name, as a rule binds it: the site's own setting. */
const SITE_NAME_BINDING: RuleBinding = {
  $bind: "applicationName",
  source: "site",
};

/** A variable in written text, `{Post title}`. */
const VARIABLE = /\{([^{}]+)\}/g;

/** The binding a variable names, or nothing for one naming no field. */
function bindingOf(
  token: string,
  fields: readonly PatternField[]
): RuleBinding | undefined {
  const key = tokenKey(token);
  if (key === tokenKey(SITE_NAME_TOKEN)) return { ...SITE_NAME_BINDING };
  const field = fields.find(
    each => tokenKey(each.token) === key || tokenKey(each.name) === key
  );
  return field === undefined ? undefined : { $bind: field.name };
}

/** `segments` with literal text beside literal text joined into one. */
function joined(segments: readonly RuleSegment[]): RuleSegment[] {
  const out: RuleSegment[] = [];
  for (const segment of segments) {
    const last = out.at(-1);
    if (typeof segment === "string" && typeof last === "string") {
      out[out.length - 1] = last + segment;
    } else if (segment !== "") {
      out.push(segment);
    }
  }
  return out;
}

/**
 * Written text as a stored rule, and the variables in it naming no field,
 * each once, as written. Such a variable is kept as literal text, so what was
 * typed is never lost; the panel says it fills nothing. Text with nothing in
 * it is no rule.
 */
export function ruleOfText(
  text: string,
  fields: readonly PatternField[]
): { segments: RuleSegment[]; unknown: string[] } {
  if (text.trim() === "") return { segments: [], unknown: [] };
  const segments: RuleSegment[] = [];
  const unknown: string[] = [];
  let at = 0;
  for (const match of text.matchAll(VARIABLE)) {
    const start = match.index;
    segments.push(text.slice(at, start));
    const token = match[1].trim();
    const binding = bindingOf(token, fields);
    if (binding === undefined) {
      segments.push(match[0]);
      if (!unknown.includes(token)) unknown.push(token);
    } else {
      segments.push(binding);
    }
    at = start + match[0].length;
  }
  segments.push(text.slice(at));
  return { segments: joined(segments), unknown };
}

/** The variable a stored binding is written as, and whether it says it whole. */
function variableOf(
  binding: RuleBinding,
  fields: readonly PatternField[]
): { text: string; exact: boolean } {
  const options = Object.keys(binding).filter(
    key => key !== "$bind" && key !== "source"
  );
  const source = binding.source ?? "entry";
  if (source === "site" && binding.$bind === SITE_NAME_BINDING.$bind) {
    return { text: `{${SITE_NAME_TOKEN}}`, exact: options.length === 0 };
  }
  const field =
    source === "entry"
      ? fields.find(each => each.name === binding.$bind)
      : undefined;
  return field === undefined
    ? { text: `{${binding.$bind}}`, exact: false }
    : { text: `{${field.token}}`, exact: options.length === 0 };
}

/**
 * A stored rule written as text. `exact` is false where a binding says more
 * than a variable can (a fallback, a format, another source, a field the
 * type's variables do not offer): the text names it, but writing the text
 * back would store a plainer rule.
 */
export function textOfRule(
  segments: readonly unknown[] | undefined,
  fields: readonly PatternField[]
): { text: string; exact: boolean } {
  let text = "";
  let exact = true;
  for (const segment of segments ?? []) {
    if (typeof segment === "string") {
      text += segment;
      continue;
    }
    if (
      typeof segment !== "object" ||
      segment === null ||
      typeof (segment as { $bind?: unknown }).$bind !== "string"
    ) {
      exact = false;
      continue;
    }
    const written = variableOf(segment as RuleBinding, fields);
    text += written.text;
    exact &&= written.exact;
  }
  return { text, exact };
}
