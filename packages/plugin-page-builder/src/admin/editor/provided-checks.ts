"use client";

/**
 * Other plugins' page checks, as the editor's Page checks list runs them:
 * each provider's findings about the page being edited, asked of the
 * provided-checks route and turned into checks beside the builder's own.
 *
 * A provider runs on the server and reads what it reads there: the page as
 * the editor holds it, or the saved entry. So its findings are asked again
 * once the author pauses editing, after each save, and each time Page
 * settings closes, where its fixes usually are. A provider that didn't
 * run is listed as not run, as a built-in check that throws is.
 *
 * @module admin/editor/provided-checks
 */
import {
  CORE_PAGE_CHECKS,
  type PageCheck,
  type PageCheckResult,
} from "@nextlyhq/builder";
import {
  useDocumentActions,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import type { PageCheckFinding } from "@nextlyhq/plugin-sdk/blocks";
import { useEffect, useMemo, useRef, useState } from "react";

import { PAGE_BUILDER_PLUGIN_NAME } from "../../library-contract";
// The CONTRACT, not the route: the route reads the server's registry.
import {
  PROVIDED_CHECKS_ROUTE_PATH,
  type ProvidedChecksItem,
  type ProvidedChecksRequest,
} from "../../page-checks-provided-contract";

import { usePaused } from "./use-paused";

/** A provider's finding as the list shows it, its fix in the builder's terms. */
export function providedResult(finding: PageCheckFinding): PageCheckResult {
  const { fix, ...rest } = finding;
  if (fix === undefined) return rest;
  if ("settingsTab" in fix) return { ...rest, settingsTab: fix.settingsTab };
  return { ...rest, fix: { tab: fix.tab, id: fix.id } };
}

/** One provider's answer as a check the list runs beside the builder's own. */
export function providedCheck(item: ProvidedChecksItem): PageCheck {
  return {
    id: `provided:${item.provider}`,
    group: item.group,
    run: () => {
      // Named in the list as not run, as a built-in check that throws is.
      if (!item.ran) throw new Error(`${item.provider} did not run`);
      return item.findings.map(providedResult);
    },
  };
}

/** How long the author pauses editing before the providers are asked again. */
const ASK_AFTER_PAUSE_MS = 1000;

/** The providers' answers, or none where the route could not be asked. */
async function askProviders(
  body: ProvidedChecksRequest
): Promise<readonly ProvidedChecksItem[]> {
  const answer = await writePluginRoute<{ items?: unknown }>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: PROVIDED_CHECKS_ROUTE_PATH,
    method: "POST",
    body,
  });
  return Array.isArray(answer?.items)
    ? (answer.items as ProvidedChecksItem[])
    : [];
}

/**
 * The checks the editor's Page checks list runs: the builder's own, and
 * each provider's, asked when the page opens, after each save, and each
 * time Page settings closes (`settingsClosed`).
 */
export function useProvidedChecks({
  page,
  document,
  locale,
  settingsClosed,
}: {
  /** The page being edited; none for any other document. */
  readonly page: { readonly collection: string; readonly id: string } | null;
  readonly document: unknown;
  readonly locale: string | undefined;
  readonly settingsClosed: number;
}): readonly PageCheck[] {
  const storedAt = useDocumentActions()?.storedAt ?? null;
  const [items, setItems] = useState<readonly ProvidedChecksItem[]>([]);
  const edited = usePaused(document, ASK_AFTER_PAUSE_MS);
  // The page as it stands when asked, without asking on every keystroke.
  const latest = useRef(document);
  latest.current = document;
  const collection = page?.collection;
  const id = page?.id;
  useEffect(() => {
    if (collection === undefined || id === undefined) {
      setItems([]);
      return;
    }
    let live = true;
    askProviders({
      collection,
      entryId: id,
      ...(locale === undefined ? {} : { locale }),
      document: latest.current,
    })
      .then(found => {
        if (live) setItems(found);
      })
      .catch(() => {
        // A list that can't be asked keeps the built-in checks only.
        if (live) setItems([]);
      });
    return () => {
      live = false;
    };
  }, [collection, id, locale, storedAt, settingsClosed, edited]);
  return useMemo(
    () => [...CORE_PAGE_CHECKS, ...items.map(providedCheck)],
    [items]
  );
}
