/**
 * The component store, read the way the published renderer reads it.
 *
 * One read for every caller that asks which definitions a page draws: the
 * publish-readiness notice, and the editor's Layout regions. Each says only
 * whom it reads as; everything else the renderer decides is decided here once,
 * so the two cannot come to disagree with it, or with each other.
 *
 * @module component-store-source
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type { ComponentSource } from "@nextlyhq/blocks-react";

import { chunked, ID_BATCH_SIZE } from "./id-batches";

/**
 * Whom a store read is made as.
 *
 * The system, with BOTH identity channels cleared, stated rather than
 * omitted: `mergeConfig` spreads the pooled reader's defaults UNDER the call,
 * so an omitted key restores whatever identity the instance was booted with,
 * and an `afterRead` hook branching on the caller would then hand the read a
 * definition the anonymous visitor never sees. Or a person, with their own
 * rights applied.
 */
export type StoreReading = SystemReading | PersonReading;

/** The system's reading, with both identity channels cleared. */
export interface SystemReading {
  overrideAccess: true;
  user: undefined;
  req: undefined;
}

/** A person's reading, with their own rights applied. */
export interface PersonReading {
  overrideAccess: false;
  user: unknown;
  actor?: unknown;
}

/** The system, as the renderer reads what a visitor's page embeds. */
export const AS_THE_SYSTEM: SystemReading = {
  overrideAccess: true,
  user: undefined,
  req: undefined,
};

/** What one store read asks, before whom it is made as. */
interface StoreReadArgs {
  collection: string;
  where: { id: { in: string[] } };
  limit: number;
  status: "published";
  locale?: string | undefined;
}

/** The one Direct API read a store source makes, as `R`. */
export interface StoreSourceDirectApi<R extends StoreReading> {
  find(args: R & StoreReadArgs): Promise<{ items: unknown[] }>;
}

/**
 * A stored block value as a document, or `null` when it is not one.
 *
 * Decodes a STRING first, and that is not defensiveness. A post-commit hook
 * receives the value as the adapter persisted it: JSON columns come back as
 * text on SQLite and on any adapter that stores them that way, and the write
 * path parses them AFTER the hooks have run. An object-only test therefore
 * finds no documents at all on those adapters, and the check reports nothing
 * for every page — silently, because finding nothing to look at and finding
 * nothing wrong are the same answer here.
 *
 * A string that does not parse is not a document, and neither is a parsed value
 * without a node list.
 */
export function asDocument(value: unknown): BlockDocument | null {
  const decoded = typeof value === "string" ? parseJson(value) : value;
  return typeof decoded === "object" &&
    decoded !== null &&
    Array.isArray((decoded as { nodes?: unknown }).nodes)
    ? (decoded as BlockDocument)
    : null;
}

/** `JSON.parse`, answering `null` rather than throwing on stored text. */
function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * The store, shaped as the source the render's discovery asks.
 *
 * One field, named the way the renderer names it, because that is the document
 * the renderer reads: a store with a second blocks field would otherwise have
 * references in a field nothing renders counted against the page.
 *
 * Chunked because a collection query is CLAMPED to `PAGINATION_DEFAULTS.maxLimit`
 * (500) and returns a subset silently, while a document may reference far more
 * instances than that. One unbounded query answers for the first page only, and
 * every published component missing from it reads as unpublished — a warning
 * manufactured by the read rather than by the data.
 *
 * Relationship DEPTH is left unstated, which is what the renderer's own
 * component read does. Forcing it to zero would hand an `afterRead` hook bare
 * ids where the render gives it expanded relationships, so a hook whose blocks
 * output depends on one produces a different component graph here than the page
 * actually draws — and this check would then miss an unpublished component, or
 * name one no visitor meets.
 *
 * In the language being drawn, as the renderer reads it: a localized
 * component's definition differs by language.
 */
export function publishedStoreSource<R extends StoreReading>(
  nextly: StoreSourceDirectApi<R>,
  store: {
    /** The RESOLVED slug definitions are stored under. */
    collection: string;
    /** The field holding a component's document. */
    field: string;
    /** The language being drawn, as the renderer reads it; none is the default. */
    locale?: string | undefined;
    reading: R;
  }
): ComponentSource {
  const { collection, field, locale, reading } = store;
  return async (ids: readonly string[]) => {
    const found = new Map<string, BlockDocument>();
    for (const chunk of chunked(ids, ID_BATCH_SIZE)) {
      const read: StoreReadArgs = {
        collection,
        where: { id: { in: [...chunk] } },
        limit: chunk.length,
        status: "published",
        ...(locale === undefined || locale === "" ? {} : { locale }),
      };
      const page = await nextly.find({ ...reading, ...read });
      for (const item of page.items) {
        const row = item as Record<string, unknown> | null;
        const id = row?.id;
        // Handed over WHOLE and unjudged, exactly as the renderer's own source
        // hands it over. Whether the stored value is a readable document is the
        // pipeline's question, and it answers it with reasons a store cannot:
        // an id present with an unreadable value is a definition somebody
        // published and cannot be read, and that is not the same as absent.
        if (typeof id !== "string") continue;
        // PRESENT even when the value will not read as a document. The row came
        // back under a published scope, so somebody published it, and dropping
        // it here would report the component as one nobody published — a
        // diagnosis republishing cannot repair. The resolver keeps those apart
        // by asking presence and readability separately, and reports the second
        // as `unreadable`; handing the raw value over is what lets it.
        //
        // Decoded first all the same: an adapter storing JSON as text hands
        // back a string, and a string is unreadable to the resolver for a
        // reason that has nothing to do with the data.
        const stored = row?.[field];
        const decoded = asDocument(stored);
        found.set(id, (decoded ?? stored) as BlockDocument);
      }
    }
    return found;
  };
}
