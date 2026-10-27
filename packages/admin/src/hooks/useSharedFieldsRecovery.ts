/**
 * The way out of a publish refused because someone else published newer
 * values for fields every language shares.
 *
 * The refusal changes nothing, and the author's own edits are still in their
 * pending change. Retyping the live values into the form and pressing Publish
 * does not help, since the server judges the stored change; so the refusal
 * itself offers the one step that does: taking the live values into this
 * language's change. That is recorded as a save of the change, so History
 * holds the value it replaced, and the editor reloads to show the result.
 *
 * The refused request saved nothing, so what the author typed may exist only
 * in the form. Before taking, the form is saved as the pending change (without
 * publishing), as it is when the action is taken rather than as it was
 * refused: the author may have kept editing, and the reload would otherwise
 * replace those edits. Once taken, the form shows the live values of the
 * fields taken: the reloaded document has the same identity as the one on
 * screen, so the editor would otherwise keep the stale value it held, and the
 * next Publish would put it back live.
 *
 * The toast stays until it is acted on or closed: an action in a toast that
 * vanishes on a timer can be missed. There is one per document and language,
 * a newer refusal replacing an older one, and it closes when the editor leaves
 * that document or language, whose form its action would no longer reach.
 *
 * @module hooks/useSharedFieldsRecovery
 */

import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import { toast } from "@admin/components/ui";
import { useLocalization } from "@admin/hooks/useLocalization";
import { apiErrorMessage, isApiError } from "@admin/lib/api/parseApiError";
import { fieldLabel, humanizeFieldName } from "@admin/lib/field-label";
import {
  type HookWarning,
  toastMutationResult,
} from "@admin/lib/mutation-warnings";
import {
  type TakenLiveValues,
  versionApi,
  type VersionScope,
} from "@admin/services/versionApi";

/** The out-of-date fields a refusal names, and how many it only counts. */
export interface OutOfDateSharedFields {
  fields: string[];
  hiddenCount: number;
}

/**
 * The out-of-date shared fields a publish was refused over, or null when the
 * error is any other.
 */
export function outOfDateSharedFields(
  error: unknown
): OutOfDateSharedFields | null {
  if (!isApiError(error) || error.status !== 409) return null;
  const data = error.data;
  if (data?.reason !== "shared-fields-out-of-date") return null;
  const fields = Array.isArray(data.fields)
    ? data.fields.filter((name): name is string => typeof name === "string")
    : [];
  const hiddenCount =
    typeof data.hiddenCount === "number" && data.hiddenCount > 0
      ? data.hiddenCount
      : 0;
  return { fields, hiddenCount };
}

/** "Article Count", "Article Count and Rating", "A, B and 1 field you can't view". */
export function fieldList(labels: readonly string[], hiddenCount = 0): string {
  const named = [...labels];
  if (hiddenCount > 0) {
    named.push(
      `${hiddenCount} ${hiddenCount === 1 ? "field" : "fields"} you can't view`
    );
  }
  if (named.length <= 1) return named[0] ?? "";
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

interface LabelledFieldConfig {
  name?: string;
  label?: unknown;
}

/**
 * The editor's form, as the recovery reaches it when its action is taken.
 */
export interface RefusedForm {
  /**
   * The form's values now, as a save of the pending change sends them (no
   * status, so nothing is published). Rejects when the form's own checks
   * refuse them, which the form then shows.
   */
  pendingChangeNow: () => Promise<Record<string, unknown>>;
  /** Tell the editor its form was saved as the pending change. */
  saved: () => void;
  /**
   * Run the recovery inside the editor's own write gate: refused, without
   * running, while the editor's writes are held (the document is someone
   * else's, or a past version is on screen) or a save is in flight; and
   * while it runs, the editor's own saves and publishes are held in turn.
   * Once it has run, the form starts afresh from the document on screen.
   */
  run: <T>(work: () => Promise<T>) => Promise<T>;
}

/** How a recovery's hold ends when the editor moves to another document. */
const LET_GO = new Error("The editor moved to another document.");

/** What a recovery says when the editor moved before it could save. */
const MOVED_BEFORE_SAVE = new Error(
  "Nothing was taken: the editor moved to another language or document. Publish again from the one you meant to take them into."
);

/** The refusal toast of one document in one language. */
function refusalToastId(scope: VersionScope, locale?: string): string {
  const document =
    scope.kind === "collection"
      ? [scope.kind, scope.slug, scope.entryId]
      : [scope.kind, scope.slug, scope.documentId];
  return JSON.stringify(["shared-fields-out-of-date", ...document, locale]);
}

/**
 * A handler for a failed save or publish: when the failure is the
 * out-of-date refusal, it shows the refusal with "Take the live values" and
 * answers true; otherwise it answers false and the caller reports the error
 * as before. The action saves the form's values, read when it is taken, as
 * the pending change, takes the live values, and has the form show them.
 */
export function useSharedFieldsRecovery(args: {
  /** The document; null while it has no id yet. */
  scope: VersionScope | null;
  /** The language being edited; absent means the default. */
  locale?: string;
  /** The document's fields, for their labels. */
  fields: readonly LabelledFieldConfig[];
  /**
   * Save values as the pending change, without publishing. Answers with the
   * warnings of anything that failed after the write, which the success toast
   * carries, as a save's does.
   */
  save: (
    values: Record<string, unknown>
  ) => Promise<{ warnings?: readonly HookWarning[] } | undefined>;
  /**
   * Reload the editor once the live values are taken, answering when the
   * reloaded document has arrived and rejecting when it couldn't be loaded.
   */
  onTaken: () => Promise<unknown>;
}): (error: unknown, form: RefusedForm) => boolean {
  const { scope, locale, fields, save, onTaken } = args;
  const { getLocale, defaultLocale } = useLocalization();
  // A string, so the effect below follows the document's address rather than
  // the scope object, which callers build afresh on every render.
  const toastId = scope ? refusalToastId(scope, locale) : null;
  // The document and language the editor shows at this render, read when a
  // recovery is about to save: the form it reads is whichever is on screen.
  const onScreen = useRef(toastId);
  onScreen.current = toastId;

  // The toast's action saves this editor's form; once the editor shows
  // another document or language, or none, that form is not the refused one.
  useEffect(() => {
    return () => {
      if (toastId) toast.dismiss(toastId);
    };
  }, [toastId]);

  // The recoveries still holding the form, by their toast: the document each
  // was for, and what lets it go. Kept across a move to another language in
  // place, since the same form stays held, and across a moment with no
  // document while one loads. Let go when the editor shows another document,
  // which the form then starts afresh from, or goes, taking the form with it.
  const holding = useRef(
    new Map<string, { document: string; letGo: () => void }>()
  );
  const documentKey = scope ? JSON.stringify(scope) : null;
  // The document the editor shows now, known or not.
  const shownDocument = useRef(documentKey);
  useEffect(() => {
    if (documentKey !== null) shownDocument.current = documentKey;
    if (documentKey === null) return;
    for (const [id, hold] of holding.current) {
      if (hold.document === documentKey) continue;
      toast.dismiss(id);
      hold.letGo();
      holding.current.delete(id);
    }
  }, [documentKey]);
  useEffect(() => {
    const held = holding.current;
    return () => {
      for (const [id, hold] of held) {
        toast.dismiss(id);
        hold.letGo();
      }
      // A reload still in flight offers nothing more.
      held.clear();
    };
  }, []);

  return useCallback(
    (error: unknown, form: RefusedForm) => {
      const stale = outOfDateSharedFields(error);
      if (!stale || !scope) return false;
      const labelOf = (name: string) => {
        const field = fields.find(f => f.name === name);
        return field?.name
          ? fieldLabel(field as Parameters<typeof fieldLabel>[0])
          : humanizeFieldName(name);
      };
      const code = locale || defaultLocale;
      const language = getLocale(code)?.label ?? code;
      const named = fieldList(stale.fields.map(labelOf), stale.hiddenCount);
      const one = stale.fields.length + stale.hiddenCount === 1;

      const refusedFor = refusalToastId(scope, locale);
      // Said while the recovery holds the editor, from the action through to
      // the reloaded document: the editor's fields are read-only meanwhile.
      const taking = `${refusedFor}:taking`;
      // The form is released only once the reloaded document is in it: a
      // release before would leave the value the take replaced on screen,
      // for the next Publish to send. So a reload that fails holds the form,
      // and says what happened, until a reload succeeds.
      // The document the recovery was refused for, and takes into.
      const forDocument = JSON.stringify(scope);
      const reloaded = async (): Promise<void> => {
        try {
          await onTaken();
          return;
        } catch {
          // Offered again below, as often as it fails.
        }
        // Let go already, by a move to another document or the editor
        // going: nothing is left to reload into, unless the editor has come
        // back to this document, which still lacks the live values.
        if (
          !holding.current.has(taking) &&
          shownDocument.current !== forDocument
        ) {
          throw LET_GO;
        }
        // Short of the editor leaving this document, the only way out is a
        // reload by the recovery itself that succeeds: nothing else the editor
        // receives proves the live values are in it, since a take keeps the
        // document's version.
        await new Promise<void>((resolve, reject) => {
          holding.current.set(taking, {
            document: forDocument,
            // Ends the recovery without starting the form afresh: no reload
            // succeeded, and the form now shows another document anyway.
            letGo: () => reject(LET_GO),
          });
          // One reload at a time: a second, finishing after the first has
          // released the form, would offer a reload nothing holds any more.
          let reloading = false;
          const offer = () => {
            // Only while this recovery still holds the form.
            if (!holding.current.has(taking)) return;
            toast.error(
              "The live values were taken and saved, but the editor couldn't load them.",
              {
                id: taking,
                description:
                  "It stays read-only until it has them, so the next publish can't send the old values.",
                duration: Number.POSITIVE_INFINITY,
                // Not closed by a swipe or a close button: its Reload is the
                // hold's only way out.
                dismissible: false,
                action: {
                  label: "Reload",
                  onClick: event => {
                    // Kept: the toast now says the reload is under way, and
                    // the action would otherwise close it.
                    event.preventDefault();
                    if (reloading) return;
                    reloading = true;
                    toast.loading("Loading the live values…", { id: taking });
                    onTaken().then(
                      () => {
                        reloading = false;
                        resolve();
                      },
                      () => {
                        reloading = false;
                        offer();
                      }
                    );
                  },
                },
              }
            );
          };
          offer();
        });
      };
      const take = async () => {
        // Whether this call got through the gate and holds the form: a call
        // the gate refused leaves another's hold and toast alone.
        let holds = false;
        try {
          // The whole sequence inside the editor's write gate, through to
          // the reloaded document: a Publish between the take and the reload
          // would still send the value the take replaced.
          await form.run(async () => {
            holds = true;
            holding.current.set(taking, {
              document: forDocument,
              letGo: () => undefined,
            });
            toast.loading("Taking the live values…", { id: taking });
            // Read now, not when refused: edits made since are part of it.
            const values = await form.pendingChangeNow();
            // The form is the one on screen: if the editor has moved to
            // another language or document since the action, what was read
            // belongs there, not to the change this refusal was for. Checked
            // with nothing awaited before the save, so no move slips between.
            if (onScreen.current !== refusedFor) throw MOVED_BEFORE_SAVE;
            const saved = await save(values);
            form.saved();
            const { item } = await versionApi.takeLiveSharedValues(
              scope,
              locale
            );
            // Said once both have committed, before the reload, so a reload
            // that fails can't hide that they did. The save committed even
            // when a hook after it failed: the author hears about both, on
            // the one toast.
            toastMutationResult(
              takenMessage(item, language, labelOf),
              saved?.warnings
            );
            await reloaded();
          });
        } catch (failure) {
          // Let go by a move: nothing failed that the author must hear of.
          if (failure === LET_GO) return;
          // Moved before it saved: nothing was written, which it says plainly.
          if (failure === MOVED_BEFORE_SAVE) {
            toast.error(MOVED_BEFORE_SAVE.message);
            return;
          }
          toast.error(
            apiErrorMessage(failure, "The live values couldn't be taken.")
          );
        } finally {
          if (holds) {
            holding.current.delete(taking);
            toast.dismiss(taking);
          }
        }
      };

      toast.error(
        `${named} ${one ? "was" : "were"} published by someone else after this change began.`,
        {
          // The same key the move check compares against.
          id: refusedFor,
          description: `Nothing was published. Take the live values into ${language}, then publish again.`,
          duration: Number.POSITIVE_INFINITY,
          closeButton: true,
          action: {
            label: "Take the live values",
            onClick: () => {
              void take();
            },
          },
        }
      );
      return true;
    },
    [scope, locale, fields, save, onTaken, getLocale, defaultLocale]
  );
}

/**
 * Reload an editor's document after the live values are taken: answers once
 * it is back, and rejects when it isn't, which React Query's own answer
 * doesn't say. The recovery holds the form until it answers.
 */
export async function reloadDocument(
  queryClient: QueryClient,
  queryKey: QueryKey
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey });
  // Judged by what the editor's reads now hold, not by the refetch's answer:
  // a refetch that failed answers all the same, and one paused while offline
  // answers as if it had run. The document is back only when every read of
  // it the editor has open fetched.
  const notBack = queryClient
    .getQueryCache()
    .findAll({ queryKey, type: "active" })
    .some(
      query =>
        query.state.status === "error" || query.state.fetchStatus === "paused"
    );
  if (notBack) throw new Error("The document couldn't be reloaded.");
}

/** What the success toast says the take did. */
export function takenMessage(
  taken: TakenLiveValues,
  language: string,
  labelOf: (name: string) => string
): string {
  return (
    [
      takenSentence(taken, language, labelOf),
      copyByHandSentence(taken, labelOf),
      leftOutSentence(taken, labelOf),
    ]
      .filter(Boolean)
      .join(" ") || `${language} was already up to date.`
  );
}

function takenSentence(
  taken: TakenLiveValues,
  language: string,
  labelOf: (name: string) => string
): string {
  const hidden = taken.hiddenTaken ?? 0;
  if (taken.taken.length === 0 && hidden === 0) return "";
  return `${language} now uses the live ${fieldList(
    taken.taken.map(labelOf),
    hidden
  )}. Its earlier value is in History.`;
}

function copyByHandSentence(
  taken: TakenLiveValues,
  labelOf: (name: string) => string
): string {
  const byHand = taken.copyByHand;
  if (!byHand || byHand.fields.length === 0) return "";
  return `Copy ${fieldList(byHand.fields.map(labelOf))} by hand: ${byHand.reason}`;
}

/** Fields still out of date that the caller may not change. */
function leftOutSentence(
  taken: TakenLiveValues,
  labelOf: (name: string) => string
): string {
  const byHand = new Set(taken.copyByHand?.fields ?? []);
  const named = taken.outOfDate.filter(name => !byHand.has(name));
  const hidden = taken.hiddenOutOfDate ?? 0;
  const count = named.length + hidden;
  if (count === 0) return "";
  return `${fieldList(named.map(labelOf), hidden)} can't be changed by you and still ${
    count === 1 ? "needs" : "need"
  } someone who can.`;
}
