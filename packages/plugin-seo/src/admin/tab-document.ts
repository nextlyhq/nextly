/**
 * Which document the SEO tab is on, from its place's context and the entry
 * the page read: the resolver judges the address it records against the
 * document holding it, so a saved entry and a Single are named by their ids.
 */
import {
  useDocumentLocale,
  type DocumentTabProps,
} from "@nextlyhq/plugin-sdk/admin";
import { useMemo } from "react";

import type { SeoTabDocument } from "./use-seo-tab-context";

/** The id of the document the page read, where it read one. */
function readId(entry: Readonly<Record<string, unknown>> | undefined) {
  const id = entry?.id;
  return typeof id === "string" && id !== "" ? id : null;
}

/** Which document the tab is on: none at a place that edits none. */
export function documentOf(
  context: DocumentTabProps["context"],
  entry: Readonly<Record<string, unknown>> | undefined,
  locale: string | null
): SeoTabDocument | null {
  if ("single" in context) {
    return { kind: "single", slug: context.single, locale, id: readId(entry) };
  }
  if ("collection" in context) {
    return {
      kind: "collection",
      slug: context.collection,
      locale,
      id: context.entryId,
    };
  }
  return null;
}

/** Which document and language the tab shows, as one key. */
export function documentKeyOf(target: SeoTabDocument): string {
  return [target.kind, target.slug, target.id, target.locale].join(":");
}

/**
 * The document the tab is on, in the language shown, with its key: none at a
 * place that edits none. Only the id of the entry read is watched, not the
 * whole entry.
 */
export function useTabDocument(
  context: DocumentTabProps["context"],
  entry: Readonly<Record<string, unknown>> | undefined
): { target: SeoTabDocument | null; documentKey: string } {
  const locale = useDocumentLocale()?.code ?? null;
  const id = readId(entry);
  return useMemo(() => {
    const target = documentOf(
      context,
      id === null ? undefined : { id },
      locale
    );
    return {
      target,
      documentKey: target === null ? "" : documentKeyOf(target),
    };
  }, [context, id, locale]);
}
