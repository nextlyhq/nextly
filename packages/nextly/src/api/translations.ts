/**
 * The translation worklist endpoint.
 *
 *   GET /api/translations?locale=es&state=missing&limit=50
 *
 * One language's outstanding work across every localized collection. Read-only,
 * and authenticated like the dashboard — this answers "what needs translating",
 * which is a question any signed-in author may ask; WHICH documents come back
 * is decided per row by the collection's own read rules.
 *
 * The fan-out, the cap and the merge live in
 * `domains/i18n/services/translation-worklist-service`. This module is the HTTP
 * shape around them: parse, authorize, delegate, respond.
 *
 * @module api/translations
 * @since 1.0.0
 */

import { container } from "../di";
import type { CollectionRegistryService } from "../domains/collections/services/collection-registry-service";
import type { UserContext } from "../domains/collections/services/collection-types";
import type { TranslationFilterState } from "../domains/i18n/companion-join";
import {
  byMostRecentlyUpdated,
  planWorklistFanOut,
  translatedFilter,
  worklistId,
  worklistTitle,
  worklistUpdatedAt,
  type LocalizedCollectionRef,
  type TranslationWorkRow,
} from "../domains/i18n/services/translation-worklist-service";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import type { CollectionsHandler } from "../services/collections-handler";

import {
  authenticatedRead,
  PRIVATE_NO_STORE_HEADERS,
} from "./authenticated-read";
import { respondData } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * The states a worklist may be asked for.
 *
 * The SAME four the entry table's language filter already offers, read from the
 * one place that defines them. A worklist with a vocabulary of its own would
 * describe the same document differently depending on which screen asked.
 */
const WORKLIST_STATES: readonly TranslationFilterState[] = [
  "missing",
  "translated",
  "draft",
  "published",
];

function parseState(raw: string | null): TranslationFilterState {
  // Defaulted rather than required: "what is missing" is the question the
  // worklist exists for, and asking a translator to name a state before they
  // can see any work is a form to fill in before a list.
  if (raw === null || raw === "") return "missing";
  const match = WORKLIST_STATES.find(s => s === raw);
  if (match === undefined) {
    throw NextlyError.validation({
      errors: [
        {
          path: "state",
          code: "invalid_state",
          message: `Unknown translation state "${raw}". Expected one of: ${WORKLIST_STATES.join(", ")}.`,
        },
      ],
    });
  }
  return match;
}

function parseLimit(raw: string | null): number {
  if (raw === null || raw === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
}

/**
 * The caller, in the shape the access rules read.
 *
 * `roles` carries through because a role-based read rule matches on it. It is
 * the difference between a worklist that is short because the work is done and
 * one that is short because nothing matched.
 */
function worklistUser(auth: { userId: string; roles?: string[] }): UserContext {
  return {
    id: auth.userId,
    ...(auth.roles === undefined ? {} : { roles: auth.roles }),
  };
}

/** Every collection that HAS a language dimension, with what the list needs to name it. */
async function localizedCollections(): Promise<
  (LocalizedCollectionRef & { useAsTitle: string | undefined })[]
> {
  const registry = container.get<CollectionRegistryService>(
    "collectionRegistryService"
  );
  const all = await registry.getAllCollections();
  return all
    .filter(c => c.localized === true)
    .map(c => ({
      slug: c.slug,
      label: c.labels?.plural ?? c.slug,
      useAsTitle: c.admin?.useAsTitle,
    }));
}

/**
 * GET /api/translations
 *
 * Query params:
 *   - locale: required. The language being worked on.
 *   - state:  one of missing | translated | draft | published (default: missing)
 *   - limit:  1..200 (default: 50)
 */
export const getTranslationWorklist = withErrorHandler(async (req: Request) => {
  const auth = await authenticatedRead(req);
  const { searchParams } = auth;
  const locale = searchParams.get("locale");
  // Required, and refused rather than defaulted to the site default: a worklist
  // for a language nobody asked about is a list of work that is not theirs.
  if (locale === null || locale === "") {
    throw NextlyError.validation({
      errors: [
        {
          path: "locale",
          code: "required",
          message:
            "A `locale` is required: the worklist answers for one language.",
        },
      ],
    });
  }
  const state = parseState(searchParams.get("state"));
  const limit = parseLimit(searchParams.get("limit"));

  await getCachedNextly();
  const handler = container.get<CollectionsHandler>("collectionsHandler");
  const collections = await localizedCollections();
  const { queried, skippedCollections } = planWorklistFanOut(collections);
  const bySlug = new Map(collections.map(c => [c.slug, c]));

  const perCollection = await Promise.all(
    queried.map(async coll => {
      const result = await handler.listEntries({
        collectionName: coll.slug,
        // The caller's own context, ROLES INCLUDED. Read rules are evaluated
        // as this user, and a role-based rule matches on `role`/`roles`: pass
        // the id alone and such a collection matches nothing and reads as
        // "fully translated" — a silent, reassuring lie rather than an error.
        // Filtering by collection alone (the dashboard's model) would go the
        // other way and list every author's titles to a self-scoped role.
        user: worklistUser(auth),
        // The reserved key is not part of `WhereFilter`'s published shape — the
        // list extractor pulls it off the top level before the clause is typed —
        // so the cast is at the ONE call site that knows that, not in the helper.
        where: translatedFilter(locale, state) as never,
        limit,
        sort: "-updatedAt",
        // Nothing here follows a relationship, and expanding them would turn
        // one list into a page of joins per row.
        depth: 0,
      });
      const useAsTitle = bySlug.get(coll.slug)?.useAsTitle;
      // A refused or failed read contributes nothing rather than failing the
      // whole worklist: one collection the caller may not read must not empty
      // the screen for every collection they may.
      const docs = (result?.data?.docs ?? []) as Record<string, unknown>[];
      return docs.map(
        (doc): TranslationWorkRow => ({
          collection: coll.slug,
          collectionLabel: coll.label,
          id: worklistId(doc),
          title: worklistTitle(doc, useAsTitle),
          updatedAt: worklistUpdatedAt(doc.updatedAt ?? doc.updated_at),
        })
      );
    })
  );

  // Merged BEFORE the slice, which is the whole reason this fans out on the
  // server: ordered across collections rather than within each one.
  const rows = perCollection.flat().sort(byMostRecentlyUpdated).slice(0, limit);

  return respondData(
    { rows, skippedCollections, locale, state },
    { headers: PRIVATE_NO_STORE_HEADERS }
  );
});
