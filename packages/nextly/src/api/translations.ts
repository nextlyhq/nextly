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
  canReadEntity,
  type ReadAccessCaller,
} from "../auth/entity-read-access";
import type { AuthContext } from "../auth/middleware";
import { container } from "../di";
import type { CollectionRegistryService } from "../domains/collections/services/collection-registry-service";
import type { UserContext } from "../domains/collections/services/collection-types";
import {
  TRANSLATION_FILTER_STATES,
  type TranslationFilterState,
} from "../domains/i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../domains/i18n/config/types";
import { isValidLocale } from "../domains/i18n/resolve-locale";
import {
  byMostRecentlyUpdated,
  eligibleCollections,
  notConsultedSources,
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
 * Which of these collections this caller may read at all.
 *
 * Asked of `canReadEntity`, which is the SAME decision the row read makes, and
 * whose own docblock says reproducing any of it would be a second
 * implementation to keep in step. That is exactly what a permission-only
 * approximation is: `checkAccess` resolves a code-defined `access.read` — `true`
 * or a callback — BEFORE falling back to stored grants, so a collection
 * authorized purely in code has no `slug:read` pair to find. Filtering on those
 * pairs removed it before the row read could allow it, and its outstanding work
 * vanished from the worklist without any refusal being reported.
 *
 * Coarse only in WHAT it decides — whether a collection is worth querying at
 * all. The per-row rules inside `listEntries` still decide which documents come
 * back, and both are needed: this keeps unreadable collections out of the cap,
 * that keeps another author's titles out of the answer.
 */
async function readableCollections(
  auth: AuthContext,
  caller: { user: UserContext },
  slugs: readonly string[]
): Promise<Set<string>> {
  const readCaller: ReadAccessCaller = {
    userId: auth.userId,
    authMethod: auth.authMethod === "api-key" ? "api-key" : "session",
    permissions: auth.permissions,
    roles: caller.user.roles ?? [],
  };
  const verdicts = await Promise.all(
    slugs.map(async slug => ({
      slug,
      allowed: await canReadEntity(slug, readCaller),
    }))
  );
  return new Set(verdicts.filter(v => v.allowed).map(v => v.slug));
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
    caller,
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
      // A FAILED read is not an empty collection, and the difference is the
      // whole point of this endpoint. `listEntries` answers a broken query or a
      // throwing read hook with `{ success: false, data: null }`, and treating
      // that as "no rows" reports the collection as having nothing outstanding
      // — an absence standing in for an answer, on a screen whose only job is
      // to say where the work is. The collection is named as unconsulted
      // instead, and one failure does not empty the screen for every collection
      // that answered.
      if (result?.success !== true || result.data === null) {
        return { slug: coll.slug, rows: [] as TranslationWorkRow[] };
      }
      const docs = (result.data.docs ?? []) as Record<string, unknown>[];
      const rows = docs.map(
        (doc): TranslationWorkRow => ({
          collection: coll.slug,
          collectionLabel: coll.label,
          id: worklistId(doc),
          title: worklistTitle(doc, useAsTitle),
          updatedAt: worklistUpdatedAt(doc.updatedAt ?? doc.updated_at),
        })
      );
      return { slug: null, rows };
    })
  );

  // Named here rather than only at the cap, because both are the same claim:
  // this answer did not cover that collection.
  const unreadable = perCollection
    .map(r => r.slug)
    .filter((slug): slug is string => slug !== null);
  const notConsulted = notConsultedSources(skippedCollections, unreadable);

  // Merged BEFORE the slice, which is the whole reason this fans out on the
  // server: ordered across collections rather than within each one.
  const merged = perCollection.flatMap(r => r.rows).sort(byMostRecentlyUpdated);
  const rows = merged.slice(0, limit);

  // The canonical list envelope, with synthetic single-page meta — the same
  // shape `webhooks` uses for a list its service does not paginate.
  //
  // `total` is what the fan-out FOUND, before the slice, so a caller can see
  // that the rows on screen are not all of them: fifty-one outstanding
  // documents return fifty rows and a total of fifty-one, and the screen can
  // say so. Reporting `rows.length` there instead would present a truncated
  // backlog as a complete one — the same lie as an unconsulted collection,
  // one level down.
  //
  // It is still a floor rather than a census: each collection is asked for at
  // most `limit`, so a site far past that has more outstanding work than any
  // single request can count. Naming a floor is honest; naming it as a total
  // would not be, which is why the field the screen reads for completeness is
  // `notConsulted` rather than this number.
  return respondList(
    rows,
    {
      total: merged.length,
      page: 1,
      limit,
      totalPages: 1,
      // FALSE, always. This endpoint takes no `page` and always returns the
      // same first slice, so a consumer following `hasNext` would request a
      // second page and receive the same rows forever. Incompleteness is a
      // different fact from pagination and travels in `notConsulted`, which is
      // why that field exists.
      hasNext: false,
      hasPrev: false,
      // Named, so the screen can say WHICH. Omitted entirely when the answer
      // covered everything, so the field's presence is itself the signal.
      ...(notConsulted.length === 0 ? {} : { notConsulted }),
    },
    { headers: PRIVATE_NO_STORE_HEADERS }
  );
});
