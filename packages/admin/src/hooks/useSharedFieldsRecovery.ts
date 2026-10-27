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
  /**
   * Show the live values of these fields once the reloaded document arrives,
   * keeping every other edit.
   */
  adoptTaken: (fields: readonly string[]) => void;
  /**
   * Run the recovery inside the editor's own write gate: refused, without
   * running, while the editor's writes are held (the document is someone
   * else's, or a past version is on screen) or a save is in flight; and
   * while it runs, the editor's own saves and publishes are held in turn.
   */
  run: <T>(work: () => Promise<T>) => Promise<T>;
}

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
   * reloaded document has arrived.
   */
  onTaken: () => unknown;
}): (error: unknown, form: RefusedForm) => boolean {
  const { scope, locale, fields, save, onTaken } = args;
  const { getLocale, defaultLocale } = useLocalization();
  // A string, so the effect below follows the document's address rather than
  // the scope object, which callers build afresh on every render.
  const toastId = scope ? refusalToastId(scope, locale) : null;

  // The document and language the editor shows now. An action taken before
  // the editor moved keeps running: dismissing its toast does not stop a
  // request already in flight, and the form it holds is a live reference to
  // whatever is on screen, not to the document it was refused for.
  const onScreen = useRef(toastId);

  // The toast's action saves this editor's form; once the editor shows
  // another document or language, or none, that form is not the refused one.
  useEffect(() => {
    onScreen.current = toastId;
    return () => {
      if (toastId) toast.dismiss(toastId);
    };
  }, [toastId]);

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
      const take = async () => {
        try {
          // The whole sequence inside the editor's write gate, through to
          // the reloaded document: a Publish between the take and the reload
          // would still send the value the take replaced.
          await form.run(async () => {
            // Read now, not when refused: edits made since are part of it.
            const saved = await save(await form.pendingChangeNow());
            const { item } = await versionApi.takeLiveSharedValues(
              scope,
              locale
            );
            // Before the reload, so the document it brings is the one the
            // form takes the live values from. Only while the editor still
            // shows the document and language this was refused for: moving to
            // a language already loaded keeps the same form, and showing this
            // language's live values in it would overwrite the other one's
            // edits. The take itself named its own document and language, so
            // it stands either way, and the reload below brings it to
            // whatever is on screen.
            if (onScreen.current === refusedFor) form.adoptTaken(item.taken);
            // The save committed even when a hook after it failed: the
            // author hears about both, on the one toast.
            toastMutationResult(
              takenMessage(item, language, labelOf),
              saved?.warnings
            );
            await onTaken();
          });
        } catch (failure) {
          toast.error(
            apiErrorMessage(failure, "The live values couldn't be taken.")
          );
        }
      };

      toast.error(
        `${named} ${one ? "was" : "were"} published by someone else after this change began.`,
        {
          id: refusalToastId(scope, locale),
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
