/**
 * What the email editor completes: the variables a template can use, their
 * nested properties, Liquid's tags and its filters.
 *
 * Variables come from the template's declarations, the built-ins every email
 * gets, and the keys of the test data, so a value the author can see in the
 * Data panel is one they can complete. Properties come from the test data's
 * shape: `order.` completes `order`'s keys, a list completes the keys of its
 * first item, and a `for` loop's variable completes as an item of the list
 * it loops over.
 *
 * Tags and filters are the ones the email engine registers (`liquid-problems`,
 * pinned to the server's): offering any other would suggest something every
 * save of it refuses.
 *
 * @module components/features/settings/EmailTemplateForm/liquid/liquid-completion
 */
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { liquidCompletionSource } from "@codemirror/lang-liquid";

import { BUILT_IN_VARIABLES } from "../sample-data";
import type { TemplateFormVariable } from "../schema";

import { liquidFilterNames, liquidTagNames } from "./liquid-problems";

const TAGS: ReadonlySet<string> = new Set(liquidTagNames());
const FILTERS: ReadonlySet<string> = new Set(liquidFilterNames());

/** What completion knows about the template being edited. */
export interface CompletionData {
  declared: readonly TemplateFormVariable[];
  /** The test data, as the Data panel holds it. */
  sample: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What a value is, in a word a person reads beside a completion. */
function kindOf(value: unknown): string {
  if (Array.isArray(value)) return "list";
  if (isRecord(value)) return "object";
  return typeof value;
}

/** Every variable a template can use, each once. */
export function variableCompletions(data: CompletionData): Completion[] {
  const seen = new Map<string, Completion>();
  const add = (label: string, detail?: string) => {
    if (label && !seen.has(label)) {
      seen.set(label, { label, type: "variable", detail });
    }
  };
  for (const variable of data.declared) {
    add(variable.name, variable.description || undefined);
  }
  for (const variable of BUILT_IN_VARIABLES) {
    add(variable.name, variable.description);
  }
  for (const [key, value] of Object.entries(data.sample)) {
    add(key, kindOf(value));
  }
  return [...seen.values()];
}

/**
 * The properties under `path` in the test data. A list stands for its items,
 * so `order.lines.` completes an item's keys.
 */
export function propertyCompletions(
  sample: Record<string, unknown>,
  path: readonly string[]
): Completion[] {
  let at: unknown = sample;
  for (const key of path) {
    if (Array.isArray(at)) at = at[0];
    at = isRecord(at) ? at[key] : undefined;
  }
  if (Array.isArray(at)) at = at[0];
  if (!isRecord(at)) return [];
  return Object.entries(at).map(([label, value]) => ({
    label,
    type: "property",
    detail: kindOf(value),
  }));
}

/** A loop tag, opening (with its variable and list) or closing. */
const LOOP_TAG =
  /\{%-?\s*(for|tablerow|endfor|endtablerow)\b(?:\s+(\w+)\s+in\s+([\w.]+))?/g;

/**
 * The loops open at the end of `text`, as each one's variable and the path
 * of the list it loops over. An inner loop's variable shadows an outer one's.
 */
export function openLoops(text: string): Map<string, string[]> {
  const stack: [string, string[]][] = [];
  for (const [, tag, name, list] of text.matchAll(LOOP_TAG)) {
    if (tag.startsWith("end")) stack.pop();
    else if (name && list) stack.push([name, list.split(".")]);
  }
  return new Map(stack);
}

/**
 * `path` with a loop variable at its head replaced by the list it loops
 * over: `line.sku` inside `{% for line in order.lines %}` is
 * `order.lines.sku`, which completes from an item of `order.lines`.
 */
export function throughLoops(
  path: readonly string[],
  loops: ReadonlyMap<string, string[]>
): string[] {
  let resolved = [...path];
  // Bounded: a loop over its own variable would otherwise never stop.
  for (let depth = 0; depth < 8; depth++) {
    const list = loops.get(resolved[0] ?? "");
    if (!list) break;
    resolved = [...list, ...resolved.slice(1)];
  }
  return resolved;
}

/** Whether completion at `from` names a tag: the first word after `{%`. */
function atTagName(context: CompletionContext, from: number): boolean {
  const before = context.state.sliceDoc(Math.max(0, from - 40), from);
  return /\{%-?\s*$/.test(before);
}

/**
 * Whether the engine would refuse what a completion names. The language
 * offers a tag as a keyword where a tag's name goes, and a filter as a
 * function; anything else (a variable, `in`, `forloop`) stays.
 */
function isUnavailable(option: Completion, tagName: boolean): boolean {
  if (option.type === "function") return !FILTERS.has(option.label);
  if (option.type === "keyword" && tagName) return !TAGS.has(option.label);
  return false;
}

/**
 * The completion source for one template: the language's own, given its
 * variables and properties, with what the engine removes taken out.
 */
export function emailCompletionSource(
  data: CompletionData
): (context: CompletionContext) => CompletionResult | null {
  const source = liquidCompletionSource({
    variables: variableCompletions(data),
    properties: (path, state, context) =>
      propertyCompletions(
        data.sample,
        throughLoops(path, openLoops(state.sliceDoc(0, context.pos)))
      ),
  });
  return context => {
    const result = source(context);
    if (!result) return null;
    const tagName = atTagName(context, result.from);
    return {
      ...result,
      options: result.options.filter(option => !isUnavailable(option, tagName)),
    };
  };
}
