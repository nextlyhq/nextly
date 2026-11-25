"use client";

/**
 * Which translations publishing the chosen languages would leave out of date, before it is done.
 *
 * A translation goes out of date when the live value it was made from changes, so each chosen
 * language other translations were made from is read twice, as it is live and as its pending
 * change has it, and the fields that differ are the ones the publish changes. Nothing is read
 * where no translation was made from a chosen language, and a read that fails predicts nothing:
 * the publish does not wait for it.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/usePredictedOutOfDate
 */

import { useQueries } from "@tanstack/react-query";

import type { PartsTarget } from "@admin/hooks/queries/usePublishParts";
import { singleDocumentKeys } from "@admin/hooks/queries/useSingles";
import { entryApi, entryKeys } from "@admin/services/entryApi";
import { singleApi } from "@admin/services/singleApi";

import { sameFormValue } from "../../versions/same-form-value";

import {
  predictOutOfDate,
  type OutOfDateCount,
  type TranslationOverview,
} from "./out-of-date";

/** A document's values in one language, by field name. */
type Values = Readonly<Record<string, unknown>>;

/** One language of the document as its readers are served it, and as its pending change has it. */
interface Copies {
  live: Values;
  draft: Values;
}

/** The document in `locale` alone, as stored, so two reads of one value compare equal. */
function readCopy(
  target: PartsTarget,
  locale: string,
  draft: boolean
): Promise<Values> {
  const options = { locale, fallbackLocale: "none", depth: 0, draft };
  return target.kind === "collection"
    ? entryApi.findByID(target.slug, target.id, options)
    : singleApi.getDocument(target.slug, options);
}

async function readCopies(
  target: PartsTarget,
  locale: string
): Promise<Copies> {
  const [live, draft] = await Promise.all([
    readCopy(target, locale, false),
    readCopy(target, locale, true),
  ]);
  return { live, draft };
}

/**
 * The fields some translation was made from `source` in, as the overview names them, where that
 * translation is not out of date already.
 */
function fieldsMadeFrom(
  source: string,
  languages: readonly string[],
  overview: TranslationOverview | undefined
): string[] {
  const names = languages.flatMap(locale =>
    Object.entries(overview?.[locale]?.fields ?? {})
      .filter(
        ([, origin]) =>
          origin.sourceLocale === source && origin.outOfDate !== true
      )
      .map(([name]) => name)
  );
  return [...new Set(names)];
}

/** Those of `names` the pending change holds another value of; a path by its top-level field. */
function changedFields(names: readonly string[], copies: Copies): Set<string> {
  return new Set(
    names.filter(name => {
      const field = name.split(".")[0];
      return !sameFormValue(copies.live[field], copies.draft[field]);
    })
  );
}

export interface UsePredictedOutOfDateOptions {
  target: PartsTarget;
  /** The site's languages, in order. */
  languages: readonly string[];
  /** The languages being published that are live with a pending change. */
  chosen: readonly string[];
  /** The document's translation overview, where the person may read it. */
  overview: TranslationOverview | undefined;
  enabled: boolean;
}

/** The translations publishing `chosen` would leave out of date, as far as it can be told. */
export function usePredictedOutOfDate({
  target,
  languages,
  chosen,
  overview,
  enabled,
}: UsePredictedOutOfDateOptions): readonly OutOfDateCount[] {
  const sources = (enabled ? chosen : [])
    .map(locale => ({
      locale,
      fields: fieldsMadeFrom(locale, languages, overview),
    }))
    .filter(source => source.fields.length > 0);
  const detailKey =
    target.kind === "collection"
      ? entryKeys.detail(target.slug, target.id)
      : singleDocumentKeys.detail(target.slug);
  const reads = useQueries({
    queries: sources.map(({ locale }) => ({
      // Under the document's detail key, so a save reads them again. Its last part is an object
      // naming no read's `locale`, so a write that seeds the document into its language's reads
      // passes these two copies by.
      queryKey: [...detailKey, "published-and-pending", { of: locale }],
      queryFn: () => readCopies(target, locale),
      // What a language's pending change holds moves with every save.
      staleTime: 0,
      retry: false,
    })),
  });
  const edited = new Map<string, ReadonlySet<string>>();
  sources.forEach(({ locale, fields }, at) => {
    const read = reads[at];
    if (read?.isSuccess === true) {
      edited.set(locale, changedFields(fields, read.data));
    }
  });
  return predictOutOfDate({ languages, overview, edited });
}
