"use client";

/**
 * What a visitor reads of the page being edited, read for applying its
 * visibility conditions: asked the first time the author applies them, and
 * again when they are applied to another page or in another language.
 *
 * @module admin/editor/page-conditions-read
 */

import type { PreviewedEntry } from "@nextlyhq/builder/shell";
import { useEffect, useState } from "react";

import { readConditionsPreview } from "../conditions-preview-client";

/** The page being edited: its collection and its saved id, if it has one. */
export interface PageConditionsSource {
  readonly collection: string | undefined;
  readonly id: string | undefined;
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
  /** Whether there is a saved page to read at all. */
  readonly available: boolean;
}

/** The read's answer for one page in one language. */
interface Answer {
  readonly key: string;
  readonly previewed: PreviewedEntry;
  readonly noun: string;
}

/**
 * What a visitor reads of the page, once `wanted` (the author applies the
 * conditions). A page never saved has nothing to read, and says so through
 * `available`. Only a visitor's values are ever read: the route answers the
 * page's published values and public fields, nothing the editor alone reads.
 */
export function usePageConditionsRead(
  source: PageConditionsSource | undefined,
  wanted: boolean
): PageConditionsRead {
  const collection = source?.collection;
  const id = source?.id;
  const locale = source?.locale;
  const available = collection !== undefined && id !== undefined;
  const key = available ? `${collection}\0${id}\0${locale ?? ""}` : "";
  const [answer, setAnswer] = useState<Answer | undefined>(undefined);
  useEffect(() => {
    if (!wanted || !available || answer?.key === key) return;
    let live = true;
    readConditionsPreview({
      collection,
      id,
      ...(locale === undefined ? {} : { locale }),
    }).then(
      read => {
        if (!live) return;
        setAnswer({
          key,
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
        if (!live) return;
        setAnswer({
          key,
          noun: "page",
          previewed: { kind: "none", reason: "unavailable" },
        });
      }
    );
    return () => {
      live = false;
    };
  }, [wanted, available, key, answer?.key, collection, id, locale]);
  const current = answer?.key === key ? answer : undefined;
  return {
    previewed: current?.previewed,
    noun: current?.noun ?? "page",
    available,
  };
}
