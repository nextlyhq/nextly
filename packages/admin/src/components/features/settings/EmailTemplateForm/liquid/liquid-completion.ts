/**
 * What the email editor completes: the variables a template can use, their
 * nested properties, Liquid's tags and its filters.
 *
 * Variables come from the template's declarations, the built-ins every email
 * gets, and the keys of the test data, so a value the author can see in the
 * Data panel is one they can complete. Properties come from the test data's
 * shape: `order.` completes `order`'s keys, and a list completes the keys of
 * its first item, which is what a `for` loop's variable holds.
 *
 * Tags and filters are the language's, less what Nextly's engine removes
 * (`nextly/src/domains/email/services/liquid-engine.ts`): offering one would
 * suggest something every save of it refuses.
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

/**
 * The tags Nextly's engine removes: they load files, or write a value without
 * escaping it. Mirrors `REMOVED_TAGS` in the server's engine.
 */
export const REMOVED_TAGS: ReadonlySet<string> = new Set([
  "include",
  "render",
  "layout",
  "block",
  "echo",
  "liquid",
  "cycle",
]);

/** The filter the engine removes: it would skip the output's escaping. */
export const REMOVED_FILTERS: ReadonlySet<string> = new Set(["raw"]);

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
 * so `order.lines.` and a loop over `order.lines` both complete an item's
 * keys.
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

/**
 * Whether a completion names a tag or filter the engine has removed. The
 * language offers tags as keywords and filters as functions; a variable that
 * happens to share a removed tag's name is the author's, and stays.
 */
function isRemoved(option: Completion): boolean {
  if (option.type === "keyword") return REMOVED_TAGS.has(option.label);
  if (option.type === "function") return REMOVED_FILTERS.has(option.label);
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
    properties: path => propertyCompletions(data.sample, path),
  });
  return context => {
    const result = source(context);
    if (!result) return null;
    return {
      ...result,
      options: result.options.filter(option => !isRemoved(option)),
    };
  };
}
