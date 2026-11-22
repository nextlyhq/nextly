"use client";

/**
 * What the server adds about an entry for its editor: where the site serves
 * it, and who made and changed it.
 *
 * Asked of the entry read (`?details=1`) because the admin can work out
 * neither itself: a type's address may come from a plugin, the site's address
 * is a setting most editors may not read, and who changed an entry is kept in
 * records no editor reads directly. The server answers only a signed-in admin
 * user whose read of the entry it grants, so a caller learns nothing here that
 * reading the entry did not allow.
 *
 * Keyed under the entry's own detail key, so whatever refreshes the entry
 * after a save refreshes this too. A Single's are read the same way, from
 * the Single's own read and under its own document key.
 *
 * Asked by what draws the answer (the address chip under the title, and the
 * side panel), not by the editor around them: a document view such as the
 * page builder covers both, so opening one makes no request for details it
 * does not show. Both ask under one key, so the entry page reads them once.
 *
 * @module components/features/entries/EntryForm/entry-details-read
 */

import { useQuery } from "@tanstack/react-query";

import { singleDocumentKeys } from "@admin/hooks/queries/useSingles";
import { protectedApi } from "@admin/lib/api/protectedApi";
import { entryKeys } from "@admin/services/entryApi";

/** Who made or changed an entry, as the server names them: never by email. */
export interface EntryChanger {
  kind: "person" | "apiKey" | "release" | "agent" | "principal" | "system";
  /** A person's name as their account gives it now; null where it gives none. */
  name: string | null;
  principalKind?: string;
  /** Set where a person is named by nobody because their account is gone. */
  gone?: true;
}

/** Where the site serves an entry, as the server resolves it. */
export interface EntryAddress {
  /** The site's address (`https://example.com/`), or null while it is unset. */
  site: string | null;
  /** The entry's path as it is saved (`/blog/pricing`). */
  path: string;
  /** The path either side of the slug, where the slug fills one part of it. */
  aroundSlug?: { before: string; after: string };
}

/** What the server adds about an entry for its editor. */
export interface EntryDetails {
  createdBy: EntryChanger | null;
  updatedBy: EntryChanger | null;
  updatedAt: string | null;
  /** Null where the entry's type has no public address. */
  address: EntryAddress | null;
}

/** The document whose details are read. */
export interface EntryDetailsTarget {
  /** Whether `collectionSlug` names a collection or a Single. */
  scope?: "collection" | "single";
  /** The collection's slug, or the Single's. */
  collectionSlug: string;
  /** The entry's id; for a Single, its document's, once it exists. */
  entryId: string | undefined;
  locale: string | undefined;
}

/**
 * The entry's details, once it exists; undefined while they load, before the
 * first save, where the server answered none, or where nothing is named.
 */
export function useEntryDetails(
  target: EntryDetailsTarget | undefined
): EntryDetails | undefined {
  const scope = target?.scope ?? "collection";
  const collectionSlug = target?.collectionSlug ?? "";
  const entryId = target?.entryId;
  const locale = target?.locale;
  const { data } = useQuery({
    queryKey: [
      ...(scope === "single"
        ? singleDocumentKeys.detail(collectionSlug)
        : entryKeys.detail(collectionSlug, entryId ?? "")),
      "details",
      { locale: locale ?? null },
    ],
    queryFn: async () => {
      // The live row, not a working draft over it: the address the chip
      // opens is the one served now, and the slug being edited is drawn in
      // its place from the form.
      const query = new URLSearchParams({
        details: "1",
        depth: "0",
        status: "all",
      });
      if (locale) query.set("locale", locale);
      const entry = await protectedApi.get<{ _details?: EntryDetails }>(
        scope === "single"
          ? `/singles/${collectionSlug}?${query.toString()}`
          : `/collections/${collectionSlug}/entries/${entryId}?${query.toString()}`
      );
      // Kept under its own key in the cached value, so a write that patches
      // every read of the entry in the cache leaves the details as they are.
      return { _details: entry._details ?? null };
    },
    enabled: Boolean(collectionSlug) && Boolean(entryId),
    staleTime: 60_000,
  });
  return data?._details ?? undefined;
}

/** How each kind that is not a named person is said. */
const KIND_WORDS: Record<Exclude<EntryChanger["kind"], "person">, string> = {
  apiKey: "an API key",
  release: "a release",
  agent: "an agent",
  principal: "a plugin",
  system: "the system",
};

/**
 * Who, in words: a person by their name, "a former user" once the account is
 * gone, "a user" for an account with no name, and anything else by its kind.
 * Null where nobody is recorded, so the caller shows the date alone.
 */
export function changerWords(
  changer: EntryChanger | null | undefined
): string | null {
  if (!changer) return null;
  if (changer.kind === "person") {
    return changer.name || (changer.gone ? "a former user" : "a user");
  }
  return KIND_WORDS[changer.kind] ?? null;
}

/** The site's address joined to a path, with one `/` between them. */
function onSite(site: string, path: string): string {
  return `${site.replace(/\/+$/, "")}${path}`;
}

/** A URL as the chip shows it: no scheme. */
function withoutScheme(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
}

/** What the address chip says, copies and opens. */
export interface AddressChipText {
  /** The text drawn before the slug (the site's host and any path before it). */
  before: string;
  /** The slug as the form holds it now; undefined where it is not part of the address. */
  slug: string | undefined;
  /** The text drawn after the slug. */
  after: string;
  /** What Copy writes: the full URL where the site's address is set, else the path. */
  copied: string;
  /** The live page, where it can be opened: a published entry on a site with an address. */
  live: string | undefined;
}

/**
 * The chip's text for an entry: the site's address without its scheme, then
 * the path, with the slug in it as the form holds it now. Where the type has
 * no public address, the slug alone. Undefined where there is neither.
 */
export function addressChipText({
  address,
  slug,
  published,
}: {
  address: EntryAddress | null | undefined;
  /** The slug as the form holds it; undefined where the entry has no slug. */
  slug: string | undefined;
  published: boolean;
}): AddressChipText | undefined {
  if (!address) {
    if (slug === undefined) return undefined;
    return { before: "", slug, after: "", copied: slug, live: undefined };
  }
  const path =
    address.aroundSlug && slug !== undefined
      ? `${address.aroundSlug.before}${slug}${address.aroundSlug.after}`
      : address.path;
  const site = address.site;
  const host = site === null ? "" : withoutScheme(site).replace(/\/+$/, "");
  const parts =
    address.aroundSlug && slug !== undefined
      ? {
          before: `${host}${address.aroundSlug.before}`,
          slug,
          after: address.aroundSlug.after,
        }
      : { before: `${host}${address.path}`, slug: undefined, after: "" };
  return {
    ...parts,
    copied: site === null ? path : onSite(site, path),
    // The page that is live now: its saved path, not an edit not yet saved.
    live: published && site !== null ? onSite(site, address.path) : undefined,
  };
}
