"use client";

/**
 * When the edit page can ask for its entry, and whether in its held-draft
 * view: before the collection's schema has arrived, where the navigation's
 * list of collections already says it.
 *
 * The entry's reads are keyed by whether they read the held draft, and a save
 * writes to the key the schema says (`readsHeldDraft`), so the reads used to
 * wait for the schema. The navigation's list, read with the admin's first
 * request, carries each collection's lifecycle and versions settings, which
 * say whether it keeps drafts. Where it does, the reads start with it, beside
 * the schema's read rather than after it. Once the schema has arrived it
 * decides, so a collection whose schema says otherwise (drafts asked for, and
 * held back by a rule only the schema reports) is read again in the view the
 * schema names, the one a save writes to.
 *
 * The other parts of the read's key are waited for too: the site's languages,
 * and the person's permissions, which say whether the read asks every
 * language's state. A read started before either would be asked again.
 *
 * @module hooks/queries/entry-read-start
 */
import { useBrandingStatus } from "@admin/context/providers/BrandingProvider";
import { useUpdateAnswer } from "@admin/hooks/useUpdateAnswer";
import { readsHeldDraft } from "@admin/lib/held-draft";
import type { ApiCollection } from "@admin/types/entities";

import { NAV_COLLECTIONS_PARAMS, useCollections } from "./useCollections";

/** What a collection's schema says about its drafts. */
type DraftsOfSchema = Parameters<typeof readsHeldDraft>[0];

/**
 * Whether a listed collection keeps drafts, as its registry record says: the
 * lifecycle on and drafts on. `undefined` where the record does not say.
 */
export function listedKeepsDrafts(
  listed: Pick<ApiCollection, "status"> & { versions?: unknown }
): boolean | undefined {
  if (typeof listed.status !== "boolean") return undefined;
  const { versions } = listed;
  if (versions === null) return false;
  if (typeof versions !== "object" || versions === undefined) return undefined;
  const drafts = (versions as { drafts?: { enabled?: unknown } }).drafts;
  return listed.status && drafts?.enabled === true;
}

/** When the entry's reads start, and in which view. */
export interface EntryReadStart {
  /** Whether the reads may be asked now. */
  ready: boolean;
  /** Whether they read the held draft; meaningful once `ready`. */
  draft: boolean;
}

/**
 * When the edit page's entry reads start for `slug`, and whether they read
 * its held draft, with `schema` once it has arrived.
 */
export function useEntryReadStart(
  slug: string | undefined,
  schema: DraftsOfSchema | undefined
): EntryReadStart {
  // The navigation's own request, read from the cache: never sent from here.
  const { data: listed } = useCollections(NAV_COLLECTIONS_PARAMS, {
    enabled: false,
  });
  const { isPending: languagesPending } = useBrandingStatus();
  const permissionsKnown = useUpdateAnswer(slug ?? "") !== "unknown";
  const keyKnown = !languagesPending && permissionsKnown;
  if (schema !== undefined) {
    return { ready: keyKnown, draft: readsHeldDraft(schema) };
  }
  const row = listed?.items.find(each => each.name === slug);
  const draft = row === undefined ? undefined : listedKeepsDrafts(row);
  return draft === undefined
    ? { ready: false, draft: false }
    : { ready: keyKnown, draft };
}
