/**
 * What an editor's read of an entry adds about it (`?details=1`): where the
 * site serves it, and who made and changed it.
 *
 * Answered on the server because the admin can ask neither itself: a type
 * made in the Schema Builder gets its address from a plugin, the site's
 * address is a setting most editors may not read, and who changed an entry is
 * read from records no editor reads directly.
 *
 * Who is personal data. The read path attaches these details only to a
 * signed-in admin user, and only once the read itself has been granted, so a
 * caller is told about an entry only what reading it allowed. Who is a name
 * and a kind, never an email address.
 *
 * @module domains/collections/services/entry-details
 * @experimental
 */
import { container } from "../../../di/container";
import type { GeneralSettingsService } from "../../../services/general-settings/general-settings-service";
import {
  addressFrom,
  declaredFor,
} from "../../public-addresses/public-address";
import {
  documentChangers,
  type DocumentChangers,
} from "../../versions/document-changers";

import { asNavigableUrl } from "./preview-url-resolver";

/**
 * @experimental Where the site serves an entry: the site's address where one
 * is set, and the entry's path. Where the entry's slug fills part of the
 * path, the text either side of it, so an editor's unsaved slug can be shown
 * in its place.
 */
export interface EntryAddressDetails {
  /** The site's address (`https://example.com/`), or null while it is unset. */
  site: string | null;
  /** The entry's path as it is saved (`/blog/pricing`). */
  path: string;
  /** The path around the slug, where the slug fills exactly one part of it. */
  aroundSlug?: { before: string; after: string };
}

/** @experimental What `?details=1` adds to an entry read, as `_details`. */
export interface EntryDetails extends DocumentChangers {
  /** Null where the entry's type has no public address, or no value fills it yet. */
  address: EntryAddressDetails | null;
}

/** The field whose value is an entry's slug. */
const SLUG_FIELD = "slug";

/**
 * Stands in for the slug while the path is filled a second time, to find the
 * text either side of it. Letters only, so filling and encoding leave it as
 * it is.
 */
const SLUG_MARK = "nextlyslugmarkqz";

/**
 * The site's address, as the General settings hold it: only one a browser
 * can be sent to, and null while it is unset. Deliberately not the
 * application's own URL: an address the site has not been given is shown as
 * not set, not guessed.
 */
async function siteAddress(): Promise<string | null> {
  const settings = await container
    .get<GeneralSettingsService>("generalSettingsService")
    .getSettings();
  const configured = settings.siteUrl?.trim();
  if (!configured) return null;
  return asNavigableUrl(configured)?.toString() ?? null;
}

/**
 * The text either side of the slug in `path`, where filling the address with
 * a mark in the slug's place gives the mark exactly once; undefined otherwise
 * (the slug is not part of the address, or the entry's own address field
 * gives it).
 */
function aroundSlugOf(
  path: string,
  marked: string | null
): EntryAddressDetails["aroundSlug"] {
  if (marked === null) return undefined;
  const at = marked.indexOf(SLUG_MARK);
  if (at < 0 || marked.indexOf(SLUG_MARK, at + 1) >= 0) return undefined;
  const before = marked.slice(0, at);
  const after = marked.slice(at + SLUG_MARK.length);
  // Only where the saved path reads the same either side, so the two can
  // never disagree about where the slug sits.
  if (!path.startsWith(before) || !path.endsWith(after)) return undefined;
  return { before, after };
}

/** Where the site serves `entry`, or null where it has no address. */
async function entryAddress(
  collection: string,
  entry: Readonly<Record<string, unknown>>,
  locale: string | undefined
): Promise<EntryAddressDetails | null> {
  const type = { kind: "collection" as const, slug: collection };
  const declared = await declaredFor(type, locale);
  const address = addressFrom(type, declared, entry);
  if (address.status !== "resolved") return null;
  const marked = addressFrom(type, declared, {
    ...entry,
    [SLUG_FIELD]: SLUG_MARK,
  });
  const aroundSlug = aroundSlugOf(
    address.path,
    marked.status === "resolved" ? marked.path : null
  );
  return {
    site: await siteAddress(),
    path: address.path,
    ...(aroundSlug === undefined ? {} : { aroundSlug }),
  };
}

/**
 * What `?details=1` adds to an entry already read and granted. Each part that
 * fails is left empty: the details decorate the read and never fail it.
 *
 * @experimental
 */
export async function entryDetails(args: {
  collection: string;
  entry: Readonly<Record<string, unknown>> & { id?: unknown };
  locale: string | undefined;
}): Promise<EntryDetails> {
  const [address, changers] = await Promise.all([
    entryAddress(args.collection, args.entry, args.locale).catch(() => null),
    documentChangers({
      scopeKind: "collection",
      slug: args.collection,
      entryId: String(args.entry.id),
      locale: args.locale ?? null,
    }),
  ]);
  return { address, ...changers };
}
