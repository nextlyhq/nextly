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
import { getAdapterFromDI } from "../dispatcher/helpers/di";
import type { CollectionRegistryService } from "../domains/collections/services/collection-registry-service";
import type { UserContext } from "../domains/collections/services/collection-types";
import {
  COMPANION_TABLE_SUFFIX,
  COMPANION_UPDATED_AT_COLUMN,
} from "../domains/i18n/companion-columns";
import {
  TRANSLATION_FILTER_STATES,
  type TranslationFilterState,
} from "../domains/i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../domains/i18n/config/types";
import { isValidLocale } from "../domains/i18n/resolve-locale";
import { resolveCompanionColumn } from "../domains/i18n/runtime/companion-readiness";
import {
  authorizationGroups,
  countIsTrustworthy,
  byMostRecentlyUpdated,
  classifyForWorklist,
  hasTranslatableFields,
  notConsultedSources,
  planWorklistFanOut,
  translatedFilter,
  worklistTotal,
  worklistTotalPages,
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
  // One decision, then bounded groups — never one flat `Promise.all` over every
  // localized collection. `canReadEntity` resolves a session caller through the
  // per-user super-admin cache, and a simultaneous cold start makes every call
  // miss it at once, turning one question into N permission reads issued in
  // parallel against the pool. See `authorizationGroups` for why the first runs
  // alone.
  //
  // Every candidate is still decided. Bounding the COUNT rather than the
  // concurrency would leave collections with no verdict, and there is nothing
  // safe to do with one: naming it as unconsulted discloses a collection the
  // caller may not read, and dropping it silently is the "nothing to do there"
  // lie this endpoint exists to prevent.
  const allowed = new Set<string>();
  for (const group of authorizationGroups(slugs)) {
    const verdicts = await Promise.all(
      group.map(async slug => ({
        slug,
        allowed: await canReadEntity(slug, readCaller),
      }))
    );
    for (const verdict of verdicts) {
      if (verdict.allowed) allowed.add(verdict.slug);
    }
  }
  return allowed;
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

/**
 * Every collection that can actually ANSWER this question, with what the list
 * needs to name it.
 *
 * `localized: true` is not sufficient, and the gap is not hypothetical: a
 * collection may carry the flag while every field on it is non-localizable (a
 * numbers-only collection) or explicitly `localized: false`. No companion table
 * is generated for such a collection, so `buildTranslationStatusCondition` is
 * never reached — the caller returns `undefined` for a missing companion — and
 * a filter that produces NO condition does not narrow the query. Every document
 * in it would come back and be reported as outstanding work in whichever state
 * was asked for.
 *
 * That is the same failure shape `assertConfiguredLocale` guards one door up: a
 * predicate that silently matches everything, presented as a backlog. Both are
 * refused before the query rather than explained after it.
 *
 * The test is `resolveLocalizedFieldNames(...).length > 0`, which is not merely
 * a similar rule — it is the SAME expression `buildCompanionSchema` evaluates
 * before returning `null`. Eligibility here and companion existence there
 * therefore cannot drift apart into two answers. Asking costs nothing: the
 * fields are already on the registry record, so this narrows the candidate set
 * before any authorization or query work is done.
 */
async function localizedCollections(): Promise<
  (LocalizedCollectionRef & {
    useAsTitle: string | undefined;
    hasStatus: boolean;
    tableName: string;
  })[]
> {
  const registry = container.get<CollectionRegistryService>(
    "collectionRegistryService"
  );
  const all = await registry.getAllCollections();
  return all
    .filter(c => c.localized === true && hasTranslatableFields(c.fields ?? []))
    .map(c => ({
      slug: c.slug,
      label: c.labels?.plural ?? c.slug,
      useAsTitle: c.admin?.useAsTitle,
      hasStatus: c.status === true,
      // The physical main table, carried so the staleness probe can name the companion without
      // loading a schema. Required on the record, so there is nothing to fall back to.
      tableName: c.tableName,
    }));
}

/**
 * How many capability probes run at once.
 *
 * Each probe is a live-schema introspection — several catalogue queries per table — and this runs
 * once per collection. `Promise.all` over every collection is the shape `drift-check` already had
 * to abandon: against a pool of five, ten collections saturated it and queued requests behind the
 * connection timeout. Three keeps the wall-time win over serial without competing with the
 * fan-out's own reads, which follow immediately after.
 */
const STALENESS_PROBE_CONCURRENCY = 3;

/**
 * Ask each collection's translations table whether it physically records when a language was
 * written, which is what the staleness question compares.
 *
 * 🔴 Scoped to collections the caller can READ before anything reaches the database. A probe for a
 * collection whose rows this caller may never see is work whose answer is discarded, and on a site
 * with many collections that is the difference between a handful of introspections and one per
 * collection.
 *
 * 🔴 A failed probe is NOT an absent column. `resolveCompanionColumn` propagates rather than
 * swallowing, precisely so a transient fault cannot be mistaken for a schema fact — so the failure
 * is caught HERE, at the collection boundary, and the slug is reported as one this answer did not
 * cover. Letting it reject the whole fan-out would discard every healthy collection's rows over
 * one bad catalogue read; letting it read as `false` would tell the operator to migrate a table
 * that is already migrated.
 */
async function resolveStalenessCapability<
  T extends LocalizedCollectionRef & { tableName: string },
>(
  collections: readonly T[],
  readable: ReadonlySet<string> | undefined
): Promise<{
  collections: (T & { canAnswerStaleness: boolean })[];
  probeFailed: string[];
}> {
  const asked = collections.filter(
    c => readable === undefined || readable.has(c.slug)
  );
  const adapter = getAdapterFromDI();
  // No connection, no question. Reporting every collection as unable to answer is the honest
  // reading and the conservative one: the alternative is claiming they can, which would emit SQL
  // naming a column nothing has checked for.
  if (!adapter) {
    return {
      collections: asked.map(c => ({ ...c, canAnswerStaleness: false })),
      probeFailed: [],
    };
  }

  const resolved: (T & { canAnswerStaleness: boolean })[] = [];
  const probeFailed: string[] = [];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < asked.length) {
      const c = asked[cursor++];
      try {
        resolved.push({
          ...c,
          canAnswerStaleness: await resolveCompanionColumn(
            adapter,
            `${c.tableName}${COMPANION_TABLE_SUFFIX}`,
            COMPANION_UPDATED_AT_COLUMN
          ),
        });
      } catch {
        probeFailed.push(c.slug);
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(STALENESS_PROBE_CONCURRENCY, asked.length) },
      worker
    )
  );
  return { collections: resolved, probeFailed };
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
  // 🔴 Resolved ONLY for the state that reads it. The probe introspects, and a negative verdict is
  // deliberately not remembered, so asking for every state would put one catalogue read per
  // collection on every worklist request for a capability four of the five states never consult.
  //
  // For `stale` it is unavoidable and the cost is accepted: this is an admin screen that already
  // fans out one query per collection, a collection that CAN answer is remembered and costs
  // nothing after the first ask, and the cost ends when the operator migrates.
  const staleCapability =
    state === "stale"
      ? await resolveStalenessCapability(localized, readable)
      : null;
  const withStaleCapability = staleCapability?.collections ?? localized;

  // Classified once. The two lists are complements of one decision, so deriving them from two
  // calls would let them disagree about a collection.
  const { eligible, unanswerable } = classifyForWorklist(
    withStaleCapability,
    state,
    readable
  );
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
        // The coarse read gate was already decided for this collection, by
        // `canReadEntity` above — the canonical decision, and the reason this
        // collection is in `queried` at all. Attesting it here elides ONLY that
        // redundant re-check: `checkCollectionAccess` skips the RBAC/code-access
        // gate under `routeAuthorized` and still evaluates the stored rules
        // (owner-only, role-based, custom) against the real user, which is what
        // keeps another author's titles out of this list.
        //
        // Not merely wasted work. A code-defined `access.read` callback may do
        // asynchronous external work, so running it twice per collection doubles
        // that load — and a transient failure on the second call would refuse a
        // collection the first call allowed, reporting it as unconsulted for no
        // reason the operator could see.
        routeAuthorized: true,
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
        return { slug: coll.slug, rows: [] as TranslationWorkRow[], total: 0 };
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
      // The collection's OWN count of matching documents, not the length of the
      // page it returned. The count query applies the same `_translated`
      // predicate as the rows beside it — `listEntries` forwards
      // `translationFilter` to it precisely so the two agree — so this is the
      // real size of this collection's backlog, including the part beyond
      // `limit` that these rows do not contain.
      //
      // And a count that contradicts its own rows did not run. `listEntries`
      // answers a failed COUNT beside successful rows with `success: true` and
      // `totalDocs: 0`, so believing it would report a collection's whole
      // backlog as however many rows happened to fit — the same lie as an
      // unconsulted collection, arriving through the one path that still had a
      // silent fallback. Such a collection is named as unconsulted and its rows
      // are left out, so `notConsulted` keeps ONE meaning: this answer did not
      // cover that collection. Half-covering it — rows on screen, no honest
      // size — invites exactly the belief that the rows are all of it.
      if (!countIsTrustworthy(result.data.totalDocs, rows.length)) {
        return { slug: coll.slug, rows: [] as TranslationWorkRow[], total: 0 };
      }
      return { slug: null, rows, total: result.data.totalDocs };
    })
  );

  // Named here rather than only at the cap, because both are the same claim:
  // this answer did not cover that collection.
  const unreadable = perCollection
    .map(r => r.slug)
    .filter((slug): slug is string => slug !== null);
  // A collection whose capability probe failed belongs HERE and not in `unanswerable`: nothing
  // was learned about its schema, so "run the migration" would be advice about a table that may
  // already be migrated. "This answer did not cover it, look again" is the whole of what is known.
  const notConsulted = notConsultedSources(
    skippedCollections,
    unreadable,
    staleCapability?.probeFailed ?? []
  );

  // Merged BEFORE the slice, which is the whole reason this fans out on the
  // server: ordered across collections rather than within each one.
  const merged = perCollection.flatMap(r => r.rows).sort(byMostRecentlyUpdated);
  const rows = merged.slice(0, limit);

  // The canonical list envelope, with synthetic single-page meta — the same
  // shape `webhooks` uses for a list its service does not paginate.
  //
  // `total` is each collection's OWN count of matching documents, summed, never
  // the number of rows this response happens to carry — see `worklistTotal`.
  const total = worklistTotal(
    perCollection.map(r => r.total),
    merged.length
  );
  return respondList(
    rows,
    {
      total,
      page: 1,
      limit,
      // DERIVED from the total, never asserted as 1. Claiming a single page
      // beside a total larger than `limit` says the rows in hand are all of
      // them — the same lie the summed total was added to remove, one field
      // along. See `worklistTotalPages` for why this sits beside `hasNext:
      // false` rather than contradicting it.
      totalPages: worklistTotalPages(total, limit),
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
      // Kept apart from `notConsulted` on the wire for the same reason the service keeps them
      // apart: this is the one with a remedy. A screen that merges them tells an operator to
      // look again when what they need to do is migrate.
      ...(unanswerable.length === 0
        ? {}
        : {
            unanswerable,
            // 🔴 WHICH remedy, decided where the environment is known. `nextly migrate` applies
            // migration FILES, and a development database managed by the sync/HMR loop has no
            // migration history containing this column — so that advice can leave the notice
            // unchanged after the developer follows it. Core already makes this exact split in
            // `companionNotReadyMessage`; this carries the same distinction to a screen that
            // cannot see `NODE_ENV`.
            //
            // A discriminator rather than a sentence: the wording is an admin string and belongs
            // with the other admin strings, while which case applies is a server fact.
            unanswerableRemedy:
              process.env.NODE_ENV === "production"
                ? ("migrate" as const)
                : ("sync" as const),
          }),
    },
    { headers: PRIVATE_NO_STORE_HEADERS }
  );
});
