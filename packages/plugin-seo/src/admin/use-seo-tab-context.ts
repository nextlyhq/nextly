/**
 * The page's levels, read from the plugin's route as the author types: once
 * as the tab opens, then again a moment after the document stops changing.
 * The whole document is sent, the tab's own values included: the route
 * leaves those out of the automatic levels itself, and the page's structured
 * data reads them (an article is described with its chosen share image).
 *
 * @module admin/use-seo-tab-context
 */
import { writePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useRef, useState } from "react";

import {
  SEO_PLUGIN_NAME,
  SEO_RESOLVE_PATH,
  type SeoTabContext,
} from "../tab/contract";

/** How long the document stays unchanged before the levels are read again. */
const SETTLE_MS = 300;

/** Which document the tab is on. */
export interface SeoTabDocument {
  kind: "collection" | "single";
  slug: string;
  locale: string | null;
}

/** The levels last read, and whether a read is under way or failed. */
export interface SeoTabContextState {
  context: SeoTabContext | undefined;
  status: "ready" | "loading" | "failed";
}

export function useSeoTabContext(
  target: SeoTabDocument | null,
  document: Readonly<Record<string, unknown>>
): SeoTabContextState {
  const [state, setState] = useState<SeoTabContextState>({
    context: undefined,
    status: "loading",
  });
  // What was last answered or is being asked, so an unchanged request is not
  // sent again.
  const asked = useRef<string | null>(null);
  // Whether the first read has been sent: every later one waits for the
  // document to settle, a read cut short included.
  const started = useRef(false);
  const kind = target?.kind;
  const slug = target?.slug;
  const locale = target?.locale ?? null;
  // Another document or language: its levels are not this one's, so none
  // are shown until its own are read.
  const targetKey = `${kind ?? ""}\u0000${slug ?? ""}\u0000${locale ?? ""}`;
  const [shownFor, setShownFor] = useState(targetKey);
  if (shownFor !== targetKey) {
    setShownFor(targetKey);
    setState({ context: undefined, status: "loading" });
  }

  useEffect(() => {
    if (kind === undefined || slug === undefined) return undefined;
    const body = { kind, slug, locale, document };
    const key = JSON.stringify(body);
    if (key === asked.current) return undefined;
    const controller = new AbortController();
    let settled = false;
    const timer = setTimeout(
      () => {
        started.current = true;
        asked.current = key;
        writePluginRoute<SeoTabContext>({
          plugin: SEO_PLUGIN_NAME,
          path: SEO_RESOLVE_PATH,
          body,
          signal: controller.signal,
        }).then(
          context => {
            settled = true;
            if (context !== undefined) setState({ context, status: "ready" });
          },
          () => {
            settled = true;
            if (controller.signal.aborted) return;
            // Asked again on the next change rather than taken as answered.
            asked.current = null;
            setState(was => ({ context: was.context, status: "failed" }));
          }
        );
      },
      started.current ? SETTLE_MS : 0
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
      // A request stopped before its answer is asked again.
      if (!settled && asked.current === key) asked.current = null;
    };
  }, [kind, slug, locale, document]);

  return state;
}
