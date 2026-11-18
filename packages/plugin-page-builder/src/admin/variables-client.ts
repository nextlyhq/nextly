/**
 * The Variables tab's reads through the plugin's variable routes: how widely
 * variables are used, where one is used, and counting the site's pages now.
 * Removing a variable stays a save of the whole tokens section, which the
 * server refuses while a dropped variable is used; "Clean up unused…"
 * removes many through the clean-up route, which judges each on its own.
 *
 * The routes' answers are read into the builder's own types here, so the tab
 * knows nothing of the transport.
 *
 * @module @nextlyhq/plugin-page-builder/admin/variables-client
 */
import type {
  TokensPanelProps,
  VariableReach,
  VariablesAccess,
  VariablesUsage,
  VariableUsesPage,
} from "@nextlyhq/builder/shell";
import {
  apiErrorMessage,
  readPluginRoute,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useMemo } from "react";

import {
  PAGE_BUILDER_PLUGIN_NAME,
  VARIABLE_CLEAN_UP_ROUTE_PATH,
  variableUsagePath,
  variableWhereUsedPath,
  VARIABLE_USAGE_IDS_MAX,
  type VariableCleanUpAnswer,
  type VariableCleanUpRequest,
  type VariableKept,
  type VariableTaken,
  type VariablesUsageResponse,
  type VariableUseItem,
} from "../library-contract";
import { readStoredJson } from "../stored-json";
import { withTakenBack } from "../variables-without";

import {
  documentBuilderPath,
  singleBuilderPath,
} from "./editor/builder-address";
import {
  countSiteUsage,
  usesPageFrom,
  type UsesList,
} from "./shared-styles-client";

/** The usage answer as the tab reads it: each variable's usage by identity. */
function usageFromResponse(
  body: VariablesUsageResponse | undefined
): VariablesUsage {
  if (body === undefined) throw new Error("The usage read answered nothing.");
  // Own entries only, into a Map, so an identity such as `__proto__` is a
  // variable like any other rather than a key of the object's prototype.
  const variables = new Map<string, VariableReach>(
    Object.entries(body.variables)
  );
  return {
    whole: body.whole,
    counting: body.counting,
    mayCount: body.mayCount,
    variables,
  };
}

/**
 * Where a place's Page Builder view opens: a collection's document by its
 * collection and id; a Single's one document, which the route names by the
 * Single's slug with no id, by its slug. Nothing for a shared style, which
 * opens in the Design panel, nor a block type's default style, which has
 * nowhere to open.
 */
function placeAddress(item: VariableUseItem): string | undefined {
  if (item.kind === "shared-style" || item.kind === "block-default") {
    return undefined;
  }
  return item.id === ""
    ? singleBuilderPath(item.collection)
    : documentBuilderPath(item.collection, item.id);
}

/**
 * One where-used page as the tab reads it. A document carries where its Page
 * Builder view opens; a shared style or a block type's default style carries
 * none.
 */
function usesFromResponse(
  body: UsesList<VariableUseItem> | undefined,
  page: number
): VariableUsesPage {
  // No fixed last page: the variables route bounds its list by the places
  // the site has (`variableUsesPagesMax` there), past the shared styles'
  // cap, and says no page follows its last.
  return usesPageFrom(body, { page }, item => {
    const href = placeAddress(item);
    return {
      id: item.id,
      title: item.title,
      // Kept: an id is unique only within its collection.
      collection: item.collection,
      kind: item.kind,
      // A look's block type, which names it with its id.
      ...(item.blockType === undefined ? {} : { blockType: item.blockType }),
      ...(href === undefined ? {} : { href }),
    };
  });
}

/**
 * The variable routes, bound for the tab, with the ways to a shared style
 * or a block look that uses one: `openSharedStyle`, when the host can open
 * Shared styles, and `openLook`, when it can edit a look in the inspector.
 */
export function useVariablesClient(
  openSharedStyle?: (classId: string) => void,
  openLook?: VariablesAccess["openLook"]
): VariablesAccess {
  const usage = useCallback(
    async (ids: readonly string[], signal: AbortSignal) =>
      usageFromResponse(
        await readPluginRoute<VariablesUsageResponse>({
          plugin: PAGE_BUILDER_PLUGIN_NAME,
          path: variableUsagePath(ids),
          signal,
        })
      ),
    []
  );

  const uses = useCallback(
    async (id: string, page: number, signal: AbortSignal) =>
      usesFromResponse(
        await readPluginRoute<UsesList<VariableUseItem>>({
          plugin: PAGE_BUILDER_PLUGIN_NAME,
          path: variableWhereUsedPath(id, page),
          signal,
        }),
        page
      ),
    []
  );

  return useMemo(
    () => ({
      usage,
      uses,
      // The shared styles' count: one count fills every usage index.
      count: countSiteUsage,
      ...(openSharedStyle === undefined ? {} : { openSharedStyle }),
      ...(openLook === undefined ? {} : { openLook }),
    }),
    [usage, uses, openSharedStyle, openLook]
  );
}

/** What "Clean up unused…" came to, as the Colours tab reads it. */
export type CleanUpResult = Awaited<
  ReturnType<NonNullable<TokensPanelProps["onCleanUp"]>>
>;

/**
 * Where a kept colour is used now, from the first page of its where-used
 * list: its first place by name, then how many more; nothing where the list
 * names no place, as for a colour another variable or a Site text row uses,
 * which the route's own words already name.
 */
function whereWords(
  name: string,
  places: VariableUsesPage
): string | undefined {
  const [first] = places.items;
  if (first === undefined) return undefined;
  const at =
    first.kind === "shared-style"
      ? `by the shared style ${first.title}`
      : first.kind === "block-default"
        ? `by ${first.title}'s built-in look`
        : `on ${first.title}`;
  const more = places.total - 1 + places.hidden;
  const rest =
    more <= 0 ? "" : ` and ${more} more ${more === 1 ? "place" : "places"}`;
  return `${name} is used ${at}${rest}.`;
}

/** A kept colour, said with where it is used where its list can say. */
async function keptWhere(
  kept: VariableKept,
  uses: VariablesAccess["uses"]
): Promise<VariableKept> {
  try {
    const places = await uses(kept.id, 1, new AbortController().signal);
    const words = whereWords(kept.name, places);
    return words === undefined ? kept : { ...kept, reason: words };
  } catch {
    // The route's own words stand: they say why it was kept.
    return kept;
  }
}

/** Undo's two halves of a clean-up: the stored section before and after it. */
export interface CleanUpHalves {
  readonly before: unknown;
  readonly after: unknown;
}

/** What a clean-up came to, and the halves of its step where any went. */
export interface CleanUpAnswer {
  readonly result: CleanUpResult;
  readonly halves?: CleanUpHalves;
}

/** One request's answer, or why it was refused. */
type Sent =
  | { readonly answer: VariableCleanUpAnswer }
  | { readonly refused: string };

/** Asks the clean-up route to remove these colours, at most a page of them. */
async function sendCleanUp(ids: readonly string[]): Promise<Sent> {
  try {
    const answer = await writePluginRoute<{
      readonly item?: VariableCleanUpAnswer;
    }>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: VARIABLE_CLEAN_UP_ROUTE_PATH,
      body: { ids } satisfies VariableCleanUpRequest,
    });
    return answer?.item === undefined
      ? { refused: "The clean-up answered without saying what it removed." }
      : { answer: answer.item };
  } catch (refused) {
    return {
      refused: apiErrorMessage(refused, "The colours could not be removed."),
    };
  }
}

/** The colours in pages the route takes, in order. */
function pagesOf(ids: readonly string[]): string[][] {
  const pages: string[][] = [];
  for (let at = 0; at < ids.length; at += VARIABLE_USAGE_IDS_MAX) {
    pages.push(ids.slice(at, at + VARIABLE_USAGE_IDS_MAX));
  }
  return pages;
}

/**
 * Every page's answers added up, in turn. A page refused whole stops there:
 * what earlier pages removed stands, and it and the pages after are kept,
 * with its refusal as their reason.
 */
async function sentInTurn(
  ids: readonly string[]
): Promise<{ answer: VariableCleanUpAnswer } | { refused: string }> {
  const pages = pagesOf(ids);
  const removed: string[] = [];
  const kept: VariableKept[] = [];
  const taken: VariableTaken[] = [];
  let section: { value: unknown } | undefined;
  for (const [at, page] of pages.entries()) {
    const sent = await sendCleanUp(page);
    if ("refused" in sent) {
      if (at === 0) return sent;
      const rest = pages.slice(at).flat();
      kept.push(...rest.map(id => ({ id, name: id, reason: sent.refused })));
      break;
    }
    removed.push(...sent.answer.removed);
    kept.push(...sent.answer.kept);
    taken.push(...sent.answer.taken);
    if ("section" in sent.answer) section = { value: sent.answer.section };
  }
  return {
    answer: {
      removed,
      kept,
      taken,
      ...(section === undefined ? {} : { section: section.value }),
    },
  };
}

/**
 * Undo's halves, from what the server answered: the section as the last
 * removal wrote it, and that section with what each removal took put back.
 * Nothing where no colour went.
 */
function halvesOf(answer: VariableCleanUpAnswer): CleanUpHalves | undefined {
  const after = readStoredJson(answer.section);
  if (answer.taken.length === 0 || !isRecord(after)) return undefined;
  return { before: withTakenBack(after, answer.taken), after };
}

/** Whether a stored value is a section to put variables back into. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Remove these colours through the clean-up route, each judged on its own,
 * fifty to a request: what went, and what stayed with where it is used now;
 * the halves of the step that takes it back, built from what the server
 * took out; or the refusal of the whole request in its own words.
 */
export async function cleanUpUnused(
  ids: readonly string[],
  uses: VariablesAccess["uses"]
): Promise<CleanUpAnswer> {
  const sent = await sentInTurn(ids);
  if ("refused" in sent) {
    return { result: { kind: "refused", reason: sent.refused } };
  }
  const { answer } = sent;
  const halves = halvesOf(answer);
  return {
    result: {
      kind: "done",
      removed: answer.removed,
      kept: await Promise.all(answer.kept.map(kept => keptWhere(kept, uses))),
    },
    ...(halves === undefined ? {} : { halves }),
  };
}
