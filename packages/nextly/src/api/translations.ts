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

import {
  apiKeyScopeAllows,
  type AuthenticatedScope,
} from "../auth/authenticated-scope";
import type { AuthContext } from "../auth/middleware";
import { container } from "../di";
import type { CollectionRegistryService } from "../domains/collections/services/collection-registry-service";
import {
  TRANSLATION_FILTER_STATES,
  type TranslationFilterState,
} from "../domains/i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../domains/i18n/config/types";
import { isValidLocale } from "../domains/i18n/resolve-locale";
import {
  byMostRecentlyUpdated,
  eligibleCollections,
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
  isSuperAdmin,
  listEffectivePermissions,
} from "../services/lib/permissions";

import {
  authenticatedRead,
  readCaller,
  PRIVATE_NO_STORE_HEADERS,
} from "./authenticated-read";
import { respondList } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseState(raw: string | null): TranslationFilterState {
  // Defaulted rather than required: "what is missing" is the question the
  // worklist exists for, and asking a translator to name a state before they
  // can see any work is a form to fill in before a list.
  if (raw === null || raw === "") return "missing";
  const match = TRANSLATION_FILTER_STATES.find(s => s === raw);
  if (match === undefined) {
    throw NextlyError.validation({
      errors: [
        {
          path: "state",
          code: "invalid_state",
          message: `Unknown translation state "${raw}". Expected one of: ${TRANSLATION_FILTER_STATES.join(", ")}.`,
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
 * Which collections this caller may read at all, or `undefined` for a
 * super-admin (meaning "no filter").
 *
 * Coarse on purpose. It decides which collections are worth QUERYING; the
 * per-row rules inside `listEntries` still decide which documents come back.
 * Both are needed — this one keeps unreadable collections from consuming the
 * cap, and the per-row one keeps another author's titles out of the answer.
 */
async function readableCollections(
  auth: AuthContext,
  scope: AuthenticatedScope | undefined,
  slugs: readonly string[]
): Promise<Set<string> | undefined> {
  // An API KEY is judged on its own stamped grants, in both directions: a key
  // without the grant is denied however privileged its owner, and a key with it
  // is allowed however unprivileged. Asking the owner's RBAC here — which is
  // what this did — let collections outside the key's reach consume the capped
  // slots and put their slugs in `skippedCollections`, while the per-row checks
  // correctly refused their rows. The coarse filter and the row checks have to
  // come from ONE decision or they disagree about what exists.
  if (scope?.actorType === "apiKey") {
    return new Set(
      slugs.filter(slug => apiKeyScopeAllows(scope, "read", slug) === true)
    );
  }
  if (await isSuperAdmin(auth.userId)) return undefined;
  const pairs = await listEffectivePermissions(auth.userId);
  return new Set(
    pairs.filter(p => p.endsWith(":read")).map(p => p.split(":")[0] ?? "")
  );
}

/**
 * The app's configured languages, or `undefined` where localization is off.
 *
 * Read from the registered service config the same way the entity guards read
 * it, so "which languages exist" has one answer.
 */
function configuredLocalization(): SanitizedLocalizationConfig | undefined {
  if (!container.has("config")) return undefined;
  return container.get<{ localization?: SanitizedLocalizationConfig }>("config")
    .localization;
}

/**
 * Refuse a language the app does not have.
 *
 * Not pedantry: an unconfigured code has no rows in any companion table, so the
 * `NOT EXISTS` predicate matches EVERYTHING. `locale=esp` would report every
 * document on the site as untranslated — a typo rendered as a full backlog,
 * which is both alarming and completely wrong, and nothing in the response
 * would hint that the language was the problem.
 */
function assertConfiguredLocale(locale: string): void {
  const localization = configuredLocalization();
  if (localization === undefined) {
    throw NextlyError.validation({
      errors: [
        {
          path: "locale",
          code: "localization_not_configured",
          message: "This app has no localization configured.",
        },
      ],
    });
  }
  if (!isValidLocale(localization, locale)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "locale",
          code: "unknown_locale",
          message: `Unknown locale "${locale}". Configured: ${localization.locales
            .map(l => l.code)
            .join(", ")}.`,
        },
      ],
    });
  }
}

/** Every collection that HAS a language dimension, with what the list needs to name it. */
async function localizedCollections(): Promise<
  (LocalizedCollectionRef & {
    useAsTitle: string | undefined;
    hasStatus: boolean;
  })[]
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
      hasStatus: c.status === true,
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
  const { auth, searchParams } = await authenticatedRead(req);
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
  assertConfiguredLocale(locale);
  const handler = container.get<CollectionsHandler>("collectionsHandler");
  const caller = await readCaller(auth);

  // Narrowed BEFORE the cap, in two steps, and the order is the point.
  //
  // A lifecycle state is a question a statusless collection cannot answer:
  // `buildTranslationStatusCondition` deliberately produces no condition there,
  // so the query returns every document and the worklist presents all of them
  // as being in the state that was asked for.
  //
  // And capping the raw registry list lets collections the caller cannot read
  // consume the alphabetically-first slots, pushing a readable collection into
  // `skippedCollections` — where its work is never queried AND its slug is
  // named back to someone with no right to know it exists.
  const localized = await localizedCollections();
  const readable = await readableCollections(
    auth,
    caller.authenticatedScope,
    localized.map(c => c.slug)
  );
  const eligible = eligibleCollections(localized, state, readable);
  const { queried, skippedCollections } = planWorklistFanOut(eligible);
  const bySlug = new Map(eligible.map(c => [c.slug, c]));

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
        user: caller.user,
        ...(caller.authenticatedScope === undefined
          ? {}
          : { authenticatedScope: caller.authenticatedScope }),
        // The reserved key is not part of `WhereFilter`'s published shape — the
        // list extractor pulls it off the top level before the clause is typed —
        // so the cast is at the ONE call site that knows that, not in the helper.
        where: translatedFilter(locale, state) as never,
        limit,
        sort: "-updatedAt",
        // Nothing here follows a relationship, and expanding them would turn
        // one list into a page of joins per row.
        depth: 0,
        // The lifecycle scope is stated, because the default is not the one a
        // worklist wants. Without it `resolveStatusFilter` applies the
        // untrusted-read default of `published` to the PARENT table, so a
        // document still in draft is absent from every state — including
        // `missing`, which is precisely the document a translator needs before
        // it is published. This widens what LIFECYCLE is visible, not who may
        // see it: the caller's access context above is unchanged, and the admin
        // entry list asks for the same scope for the same reason.
        status: "all" as const,
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

  // The canonical list envelope, with synthetic single-page meta — the same
  // shape `webhooks` uses for a list its service does not paginate. This read
  // is capped rather than paged, so `page`/`totalPages` are 1 and there is no
  // next page to offer.
  //
  // `total` is the number of rows RETURNED, which is all this request can
  // honestly claim: the fan-out is capped per collection and across
  // collections, so more outstanding work may exist than was counted. That is
  // exactly what `hasNext` reports here — not "there is another page to
  // request", but "this answer is known to be incomplete" — and it is why
  // `skippedCollections` is carried in the row set's own metadata rather than
  // left for the caller to infer from a number.
  return respondList(
    rows,
    {
      total: rows.length,
      page: 1,
      limit,
      totalPages: 1,
      hasNext: rows.length === limit || skippedCollections.length > 0,
      hasPrev: false,
      // Named, so the screen can say WHICH. Omitted entirely when the fan-out
      // reached everything, so the field's presence is itself the signal.
      ...(skippedCollections.length === 0
        ? {}
        : { notConsulted: skippedCollections }),
    },
    { headers: PRIVATE_NO_STORE_HEADERS }
  );
});
