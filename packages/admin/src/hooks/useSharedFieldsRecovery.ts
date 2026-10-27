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
 * in the form. Before taking, the refused values are saved as the pending
 * change (without publishing); the reload would otherwise replace them.
 *
 * The toast stays until it is acted on or closed: an action in a toast that
 * vanishes on a timer can be missed.
 *
 * @module hooks/useSharedFieldsRecovery
 */

import { useCallback } from "react";

import { toast } from "@admin/components/ui";
import { useLocalization } from "@admin/hooks/useLocalization";
import { apiErrorMessage, isApiError } from "@admin/lib/api/parseApiError";
import { fieldLabel, humanizeFieldName } from "@admin/lib/field-label";
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
 * A handler for a failed save or publish: when the failure is the
 * out-of-date refusal, it shows the refusal with "Take the live values" and
 * answers true; otherwise it answers false and the caller reports the error
 * as before. `saveRefused` saves the refused request's values as the pending
 * change, without publishing, before the live values are taken.
 */
export function useSharedFieldsRecovery(args: {
  /** The document; null while it has no id yet. */
  scope: VersionScope | null;
  /** The language being edited; absent means the default. */
  locale?: string;
  /** The document's fields, for their labels. */
  fields: readonly LabelledFieldConfig[];
  /** Reload the editor once the live values are taken. */
  onTaken: () => void;
}): (error: unknown, saveRefused: () => Promise<unknown>) => boolean {
  const { scope, locale, fields, onTaken } = args;
  const { getLocale, defaultLocale } = useLocalization();

  return useCallback(
    (error: unknown, saveRefused: () => Promise<unknown>) => {
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

      const take = async () => {
        try {
          await saveRefused();
          const { item } = await versionApi.takeLiveSharedValues(scope, locale);
          toast.success(takenMessage(item, language, labelOf));
          onTaken();
        } catch (failure) {
          toast.error(
            apiErrorMessage(failure, "The live values couldn't be taken.")
          );
        }
      };

      toast.error(
        `${named} ${one ? "was" : "were"} published by someone else after this change began.`,
        {
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
    [scope, locale, fields, onTaken, getLocale, defaultLocale]
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
