/**
 * A collection list's custom source as its inspector reads, words and
 * writes it: a named query a developer registered, and the inputs an author
 * gives it.
 *
 * What is JUDGED is the engine's: `judgeNamedParams` is the one judgement of
 * a list's inputs against its query, the one the save and the run use, and
 * every sentence is the engine's `NAMED_QUERY_TEXT`, so what the inspector
 * says and what a save refuses are one judgement in one set of words. This
 * module adds only what an editor needs on top of that:
 *
 * - which inputs need a value an author must give, as the group's note
 *   names them;
 * - what each input shows while it is empty, which is what an empty input
 *   means ("Today", "Any venue", its default);
 * - whether a draft of the inputs can be written yet, and the one write that
 *   makes a custom source a list's source, clearing every other part of it.
 *
 * Pure, so each rule is tested without a panel.
 *
 * @module named-query-model
 */
import {
  judgeNamedParams,
  NAMED_QUERY_TEXT,
  namedQueryParamNeedsInput,
  type NamedParamProblem,
  type NamedQueryDeclaration,
  type NamedQueryHiddenRead,
  type NamedQueryNeed,
  type NamedQueryParam,
  type NamedQueryParamValue,
  type NamedQuerySource,
} from "@nextlyhq/blocks-engine";

import { dayWords } from "./list-query-model";

/** One custom source the site offers: a registered query, without its run. */
export interface CustomSource {
  readonly declaration: NamedQueryDeclaration;
  /**
   * The collections it reads that visitors can read nothing of, as the
   * server judged them with the engine's `namedQueryHiddenReads`.
   */
  readonly readsHidden: readonly NamedQueryHiddenRead[];
}

/** The site's custom sources, as the engine looks a list's query up. */
export function customSourceLookup(
  sources: readonly CustomSource[]
): NamedQuerySource {
  const byName = new Map(
    sources.map(source => [source.declaration.name, source.declaration])
  );
  return { declarationOf: name => byName.get(name) };
}

/** A query's inputs, by key, in the order it declares them. */
export function inputsOf(
  declaration: NamedQueryDeclaration
): [string, NamedQueryParam][] {
  return Object.entries(declaration.params ?? {});
}

/** Whether an input is picked from a list rather than typed. */
function chosen(param: NamedQueryParam): boolean {
  return (
    param.type === "choice" || param.type === "day" || param.type === "entry"
  );
}

/**
 * The inputs an author must give a value to before the query can run: those
 * required with no default, in the query's order. One with a default never
 * shows as empty, so it is never among them.
 */
function neededInputs(
  declaration: NamedQueryDeclaration
): [string, NamedQueryParam][] {
  return inputsOf(declaration).filter(([, param]) =>
    namedQueryParamNeedsInput(param)
  );
}

/** Whether picking the query must wait for an input before it is written. */
export function needsInput(declaration: NamedQueryDeclaration): boolean {
  return neededInputs(declaration).length > 0;
}

/**
 * The Inputs group's note: the inputs the query needs, and, while one of
 * them is still empty, that nothing on the page changes until it is set.
 * Past two needed inputs, each needed label carries a dot instead
 * ({@link marksNeeded}), and the note says what the dot means.
 */
export function inputsNote(
  declaration: NamedQueryDeclaration,
  missing: readonly NamedParamProblem[]
): string {
  const needed = neededInputs(declaration);
  const needs: NamedQueryNeed[] = needed.map(([, param]) => ({
    label: param.label,
    chosen: chosen(param),
  }));
  return NAMED_QUERY_TEXT.inputsNote(declaration.label, needs, {
    others: inputsOf(declaration).length > needed.length,
    waiting: missing.some(problem => problem.kind === "missing"),
  });
}

/** Whether the needed inputs' labels carry a dot, as the note says past two. */
export function marksNeeded(declaration: NamedQueryDeclaration): boolean {
  return neededInputs(declaration).length > 2;
}

/** A label as it sits mid-sentence: its first letter lowercased. */
function inSentence(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** "Choose a city", for an input that needs one picked. */
function choosePrompt(param: NamedQueryParam): string {
  return `Choose a ${inSentence(param.label)}`;
}

/** "Any venue", for an optional input that narrows nothing while empty. */
function anyPrompt(param: NamedQueryParam): string {
  return `Any ${inSentence(param.label)}`;
}

/**
 * What an input shows while it is empty: what empty means for it. Its
 * default where it has one ("Today", "30", a choice's name), a prompt to
 * choose where it is needed, and otherwise that it narrows nothing ("Any
 * venue"), or the developer's own placeholder for text.
 */
export function emptyWords(param: NamedQueryParam): string | undefined {
  const needed = namedQueryParamNeedsInput(param);
  switch (param.type) {
    case "text":
      return param.placeholder ?? param.default;
    case "number":
      return param.default === undefined ? undefined : String(param.default);
    case "boolean":
      return undefined;
    case "choice": {
      if (needed) return choosePrompt(param);
      const fallback = param.options.find(
        option => option.value === param.default
      );
      return fallback?.label ?? anyPrompt(param);
    }
    case "day":
      if (param.default === "today") return "Today";
      if (param.default !== undefined) return dayWords(param.default);
      return needed ? choosePrompt(param) : anyPrompt(param);
    case "entry":
      return needed ? choosePrompt(param) : anyPrompt(param);
  }
}

/** A query's inputs as a list stores them: one literal per input set. */
export type StoredParams = Readonly<Record<string, NamedQueryParamValue>>;

/**
 * The inputs with one set, or emptied: an emptied input (`undefined`) is
 * left out, never stored as `null`, so it reads its default. Each control
 * says when it is empty; an empty string is a value, as a choice may
 * declare `""` among its options.
 */
export function withInput(
  params: StoredParams,
  key: string,
  value: NamedQueryParamValue | undefined
): StoredParams {
  const next: Record<string, NamedQueryParamValue> = { ...params };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

/**
 * A draft of a query's inputs judged as a save would: its problems, each by
 * input, and whether it can be written. Judged without a today of its own,
 * as the save is, so a day defaulting to today counts as set.
 */
export function judgedDraft(
  declaration: NamedQueryDeclaration,
  params: StoredParams
): {
  readonly problems: readonly NamedParamProblem[];
  readonly writable: boolean;
  /** Stored inputs the query no longer takes, which are left out. */
  readonly unknown: readonly string[];
} {
  const judged = judgeNamedParams(declaration, params);
  return {
    problems: judged.problems,
    writable: judged.problems.length === 0,
    unknown: judged.unknown,
  };
}

/**
 * The one write that makes a custom source the list's source: its name and
 * inputs, with the collection, the related source, the filters and the sort
 * removed in the same edit, so it is one undo step and never stored beside
 * another source. Pages go too: a custom source's list is not split into
 * pages yet, which its save refuses. No inputs set stores none.
 */
export function namedSourceChanges(
  name: string,
  params: StoredParams
): Record<string, unknown> {
  return {
    namedQuery: Object.keys(params).length === 0 ? { name } : { name, params },
    collection: undefined,
    relation: undefined,
    filters: undefined,
    sort: undefined,
    paginate: undefined,
  };
}

/** The inputs a stored list holds, as the note under a removed query lists them. */
export function keptInputs(
  params: StoredParams
): (readonly [string, NamedQueryParamValue])[] {
  return Object.entries(params);
}

/** What a list of custom sources is searched by: its name and its line. */
export function sourceSearchText(declaration: NamedQueryDeclaration): string {
  return declaration.description === undefined
    ? declaration.label
    : `${declaration.label} ${declaration.description}`;
}
