/**
 * Editing a collection list's custom source in place: the draft of its
 * values, which parts it declares, what it still shows while it is read, and
 * the change of source a choice makes.
 *
 * @module list-query-named-source
 */
import {
  NAMED_QUERY_TEXT,
  type ListQuery,
  type NamedQueryParamValue,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import {
  relatedShownOf,
  type ListQueryFieldProps,
  type ListQueryReading,
} from "./list-query-reading";
import {
  sourceChanges,
  type ShownNamed,
  type SourceChoice,
} from "./list-query-source";
import {
  judgedDraft,
  namedSourceChanges,
  needsInput,
  withInput,
  type CustomSource,
  type StoredParams,
} from "./named-query-model";

/** Whether a new source changes what the list stores. */
function changesSource(
  query: ListQuery,
  changes: Readonly<Record<string, unknown>>
): boolean {
  return (
    changes.collection !== query.collection ||
    JSON.stringify(changes.relation) !== JSON.stringify(query.relation) ||
    JSON.stringify(changes.namedQuery) !== JSON.stringify(query.namedQuery)
  );
}

/**
 * A custom source picked, or its inputs changed, that cannot run yet: kept
 * here and never written, so the list keeps what it stores and the draft is
 * never a page that cannot be saved. For one list, by its id.
 */
interface NamedDraft {
  readonly nodeId: string;
  readonly name: string;
  readonly params: StoredParams;
}

/**
 * The inputs a list may store for a query: only those it declares, so a
 * write leaves out an input the query no longer takes, as its run does.
 */
function declaredOnly(
  source: CustomSource,
  params: StoredParams
): StoredParams {
  const declared = source.declaration.params ?? {};
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => Object.hasOwn(declared, key))
  );
}

/** The custom source shown: the draft over what is stored, if any. */
function shownNamedOf(
  query: ListQuery,
  draft: NamedDraft | undefined,
  customs: readonly CustomSource[] | undefined
): ShownNamed | undefined {
  const find = (name: string) =>
    customs?.find(each => each.declaration.name === name);
  if (draft !== undefined) {
    return {
      name: draft.name,
      params: draft.params,
      source: find(draft.name),
      drafted: true,
      loading: customs === undefined,
    };
  }
  const stored = query.namedQuery;
  if (stored === undefined) return undefined;
  return {
    name: stored.name,
    params: stored.params,
    source: find(stored.name),
    drafted: false,
    loading: customs === undefined,
  };
}

/**
 * What the canvas still draws while a new source waits for an input: the
 * stored source in the words the Source control shows it in. Nothing for a
 * list with no source, which draws its template.
 */
function storedSourceWords(reading: ListQueryReading): string | undefined {
  const { query, related, collections, customs } = reading;
  const stored = query.namedQuery;
  if (stored !== undefined) {
    return (
      customs.find(each => each.declaration.name === stored.name)?.declaration
        .label ?? stored.name
    );
  }
  const relation = relatedShownOf(query, related);
  if (relation !== undefined) return relation;
  if (query.collection === undefined) return undefined;
  return (
    collections.find(each => each.slug === query.collection)?.label ??
    query.collection
  );
}

/**
 * The canvas's tag for a list whose new source waits: set while it waits,
 * and cleared once it is written or abandoned, once the inspector shows
 * another list, and once it is gone. Each tag is cleared through the
 * function that set it, which names its own list.
 */
function useStillShowing(
  nodeId: string,
  tag: ((words: string | undefined) => void) | undefined,
  words: string | undefined
): void {
  const latest = React.useRef(tag);
  latest.current = tag;
  const shown = React.useRef<
    | {
        readonly nodeId: string;
        readonly words: string;
        readonly clear: () => void;
      }
    | undefined
  >(undefined);
  React.useEffect(() => {
    const held = shown.current;
    if (held?.nodeId === nodeId && held.words === words) return;
    held?.clear();
    shown.current = undefined;
    const set = latest.current;
    if (words === undefined || set === undefined) return;
    set(words);
    shown.current = { nodeId, words, clear: () => set(undefined) };
  }, [nodeId, words]);
  React.useEffect(() => () => shown.current?.clear(), []);
}

/** The draft of a custom source, dropped when what the list stores changes. */
function useNamedDraft(
  nodeId: string,
  query: ListQuery
): readonly [
  NamedDraft | undefined,
  (draft: Omit<NamedDraft, "nodeId"> | undefined) => void,
] {
  const [draft, setDraft] = React.useState<NamedDraft | undefined>(undefined);
  // An undo, a redo or a write elsewhere changes what is stored under a
  // draft; the draft would then describe a list that no longer exists.
  const storedText = JSON.stringify([
    query.collection,
    query.relation,
    query.namedQuery,
  ]);
  React.useEffect(() => setDraft(undefined), [storedText, nodeId]);
  const set = React.useCallback(
    (next: Omit<NamedDraft, "nodeId"> | undefined) =>
      setDraft(next === undefined ? undefined : { ...next, nodeId }),
    [nodeId]
  );
  return [draft?.nodeId === nodeId ? draft : undefined, set];
}

/** The tag the canvas shows while a draft waits: what the list still draws. */
function stillWords(
  draft: NamedDraft | undefined,
  reading: ListQueryReading
): string | undefined {
  if (draft === undefined) return undefined;
  const words = storedSourceWords(reading);
  return words === undefined ? undefined : NAMED_QUERY_TEXT.stillShowing(words);
}

/** A list's custom source as the inspector edits it: shown, picked and set. */
export interface NamedEditing {
  readonly named: ShownNamed | undefined;
  readonly pickSource: (pick: SourceChoice["pick"]) => void;
  readonly setInput: (
    key: string,
    value: NamedQueryParamValue | undefined
  ) => void;
}

/**
 * The custom source a list shows and the edits that change its source: a
 * source picked or an input set is written once the query can run, as one
 * write of the props, and kept here until then, the canvas told to tag the
 * list with what it still draws.
 */
export function useNamedEditing(
  nodeId: string,
  reading: ListQueryReading,
  commit: (changes: Readonly<Record<string, unknown>>) => void,
  onStillShowing: ListQueryFieldProps["onStillShowing"]
): NamedEditing {
  const { query } = reading;
  const [draft, setDraft] = useNamedDraft(nodeId, query);
  const named = shownNamedOf(query, draft, reading.customsRead);
  useStillShowing(nodeId, onStillShowing, stillWords(draft, reading));
  const pickCustom = (source: CustomSource) => {
    const name = source.declaration.name;
    setDraft(undefined);
    if (query.namedQuery?.name === name) return;
    // A query with an input that needs a value waits for it: chosen on
    // screen, nothing written, the canvas still drawing what is stored.
    if (needsInput(source.declaration)) setDraft({ name, params: {} });
    else commit(namedSourceChanges(name, {}));
  };
  const pickSource = (pick: SourceChoice["pick"]) => {
    if (pick.kind === "custom") {
      pickCustom(pick.source);
      return;
    }
    setDraft(undefined);
    const changes = sourceChanges(query, pick);
    if (changesSource(query, changes)) commit(changes);
  };
  const setInput = (key: string, value: NamedQueryParamValue | undefined) => {
    const source = named?.source;
    if (named === undefined || source === undefined) return;
    const params = withInput(named.params, key, value);
    if (!judgedDraft(source.declaration, params).writable) {
      setDraft({ name: named.name, params });
      return;
    }
    setDraft(undefined);
    const kept = declaredOnly(source, params);
    // The source and its inputs in one write, so it is one undo step: a
    // new source is a change even when its inputs equal the stored ones.
    const stored = query.namedQuery;
    if (
      named.name !== stored?.name ||
      JSON.stringify(kept) !== JSON.stringify(stored.params)
    ) {
      commit(namedSourceChanges(named.name, kept));
    }
  };
  return { named, pickSource, setInput };
}
