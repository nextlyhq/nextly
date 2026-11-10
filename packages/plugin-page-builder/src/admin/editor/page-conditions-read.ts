"use client";

/**
 * What a visitor reads of the page being edited, read for applying its
 * visibility conditions: asked each time the author applies them, so the page
 * is checked as it is published now.
 *
 * @module admin/editor/page-conditions-read
 */

import type { PreviewedEntry } from "@nextlyhq/builder/shell";
import { useEffect, useState } from "react";

import { readConditionsPreview } from "../conditions-preview-client";

/** The page being edited: its collection and its id. */
export interface PageConditionsSource {
  readonly collection: string;
  readonly id: string;
  readonly locale: string | undefined;
}

/** What the read answered, as the switch reads it. */
export interface PageConditionsRead {
  /**
   * The page as a visitor reads it, shaped as the entry a template previews
   * so the one conditions preview reads both; `undefined` until asked.
   */
  readonly previewed: PreviewedEntry | undefined;
  /** What one of the page's collection's entries is called, lower case. */
  readonly noun: string;
  /**
   * Whether this attempt's read failed (a dropped connection, an expired
   * session): the switch says so, and applying the conditions again asks
   * again, since a failure is never kept as an answer.
   */
  readonly failed: boolean;
}

/** The read's answer for one page in one language, on one attempt. */
interface Answer {
  readonly key: string;
  readonly previewed: PreviewedEntry;
  readonly noun: string;
}

/**
 * What a visitor reads of the page, read each time the author applies the
 * conditions (`wanted` and a new `attempt`), so the page as published since
 * is what they are checked against. Only a visitor's values are ever read: the route answers the
 * page's published values and public fields, nothing the editor alone reads.
 */
export function usePageConditionsRead(
  source: PageConditionsSource | undefined,
  wanted: boolean,
  /** How many times the author has applied the conditions, so each asks anew after a failure. */
  attempt: number
): PageConditionsRead {
  const collection = source?.collection;
  const id = source?.id;
  const locale = source?.locale;
  const key =
    source === undefined
      ? ""
      : `${source.collection}\0${source.id}\0${locale ?? ""}`;
  const [answer, setAnswer] = useState<Answer | undefined>(undefined);
  // The attempt that failed, for this page and language; never an answer.
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const tried = `${key}#${String(attempt)}`;
  useEffect(() => {
    if (!wanted || collection === undefined || id === undefined) return;
    if (answer?.key === tried || failure === tried) return;
    let live = true;
    readConditionsPreview({
      collection,
      id,
      ...(locale === undefined ? {} : { locale }),
    }).then(
      read => {
        if (!live) return;
        setAnswer({
          key: tried,
          noun: read.noun.toLowerCase(),
          previewed: {
            kind: "entry",
            collection,
            id,
            title: "",
            publicValues: read.publicValues,
            // Never read: the conditions are judged as a visitor reads.
            editorValues: {},
            fields: read.fields,
          },
        });
      },
      () => {
        if (live) setFailure(tried);
      }
    );
    return () => {
      live = false;
    };
  }, [wanted, key, tried, answer?.key, failure, collection, id, locale]);
  // An answer stands for the attempt that read it: applying the conditions
  // again reads the page again, so a publish or a changed field since shows.
  // Until the new answer lands, the last one for this page stands in, unless
  // the new read failed, which is said instead.
  const fresh = answer?.key === tried;
  const failed = wanted && !fresh && failure === tried;
  const current =
    !failed && (fresh || answer?.key.startsWith(`${key}#`) === true)
      ? answer
      : undefined;
  return {
    previewed: current?.previewed,
    noun: current?.noun ?? "page",
    failed,
  };
}
