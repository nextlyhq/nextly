"use client";

/**
 * What a new page would get, read for the New page dialog as the author
 * types: the collection's name and choices, and the address the page would
 * take. Asked again once typing pauses; the last answer stays on screen
 * meanwhile, so the dialog never blanks between two.
 *
 * @module admin/new-page/new-page-facts
 */
import { readPluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useRef, useState } from "react";

import { PAGE_BUILDER_PLUGIN_NAME } from "../../library-contract";
import { newPagePath, type NewPageFacts } from "../../pages-write-contract";

/** How long typing pauses before the address is asked about again. */
export const NEW_PAGE_ASK_PAUSE_MS = 250;

/** What the dialog asks about: a collection, its title and a typed address. */
export interface NewPageAsk {
  readonly collection: string;
  readonly title: string;
  /** The typed address, once the author changed it; absent while it follows the title. */
  readonly slug?: string;
}

/** The read's state: its last answer, and whether that answer is for what is typed now. */
export interface NewPageFactsRead {
  readonly facts: NewPageFacts | undefined;
  /** Whether {@link facts} answers the ask as it stands. */
  readonly current: boolean;
  readonly failed: boolean;
  readonly retry: () => void;
}

/** The ask as one key, so an answer can be matched to what it was for. */
function keyOf(ask: NewPageAsk): string {
  return JSON.stringify([ask.collection, ask.title.trim(), ask.slug ?? null]);
}

export function useNewPageFacts(ask: NewPageAsk): NewPageFactsRead {
  const key = keyOf(ask);
  const [answer, setAnswer] = useState<
    { key: string; facts: NewPageFacts } | undefined
  >(undefined);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(ask);
  latest.current = ask;
  // The collection asked about first is read at once; a title or address
  // typed after waits for the typing to pause.
  const first = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    const asked = latest.current;
    const wait = first.current ? 0 : NEW_PAGE_ASK_PAUSE_MS;
    first.current = false;
    const timer = setTimeout(() => {
      readPluginRoute<NewPageFacts>({
        plugin: PAGE_BUILDER_PLUGIN_NAME,
        path: newPagePath({
          collection: asked.collection,
          title: asked.title.trim(),
          ...(asked.slug === undefined ? {} : { slug: asked.slug }),
        }),
        signal: controller.signal,
      })
        .then(facts => {
          if (controller.signal.aborted) return;
          if (facts === undefined || typeof facts !== "object") {
            setFailedFor(key);
            return;
          }
          setFailedFor(null);
          setAnswer({ key, facts });
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailedFor(key);
        });
    }, wait);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, attempt]);

  // An answer for another collection says nothing true about this one.
  const sameCollection =
    answer !== undefined && answer.facts.collection.slug === ask.collection;
  return {
    facts: sameCollection ? answer.facts : undefined,
    current: answer?.key === key,
    failed: failedFor === key,
    retry: () => setAttempt(count => count + 1),
  };
}
