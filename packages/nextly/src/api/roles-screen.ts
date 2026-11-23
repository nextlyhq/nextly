/**
 * What the roles screen shows for each collection and Single.
 *
 * `GET /roles/screen` answers, for every registered collection and Single:
 * its slug and kind, the label the admin shows it by, the plugin that
 * contributes it (or none), and the access operations whose code declares a
 * rule. The screen sets one level per entity from this, and marks an entity
 * whose code also narrows who may act on it.
 *
 * The entity list and the labels come from one read of each registry, a
 * projection of only the slug and label columns, so the two cannot
 * describe different moments: a slug added or removed between two separate
 * reads would otherwise be left out, or listed under no label. Each slug's kind
 * is decided by `contentKinds`, the precedence `registeredContentSnapshot()`
 * applies for `GET /me/capabilities`.
 *
 * @module api/roles-screen
 */

import { z } from "zod";

import {
  closedMarkOf,
  noteStoredClosedMark,
  refreshStoredClosedMarks,
  type ClosedToSuperAdminMark,
} from "../auth/access/closed-to-super-admin";
import { declaresRule } from "../auth/access/decide";
import {
  COLLECTION_ACTIONS,
  SINGLE_ACTIONS,
} from "../auth/access/route-gate-adapters";
import { getRBACService } from "../auth/code-access";
import { validateOrigin } from "../auth/csrf/validate";
import { buildAuthRouterDeps } from "../auth/handlers/deps-bridge";
import { countsOf } from "../auth/handlers/unknown-source";
import { authRateLimiter } from "../auth/middleware/rate-limiter";
import { getService } from "../di";
import { buildAuditLogWriter } from "../domains/audit/audit-log-writer";
import { changingRoleGrants } from "../domains/auth/services/role-grants-changed";
import { expireContentAfterGrantsChange } from "../domains/flush-content-change";
import { writeStoredClosedMark } from "../domains/meta/closed-to-super-admin-marks";
import { collectPluginContributedSlugs } from "../domains/webhooks/recording-provenance";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { env } from "../lib/env";
import { bootedPlugins } from "../route-handler/auth-handler";
import { isSuperAdmin } from "../services/lib/permissions";
import { contentKinds } from "../services/lib/registered-content-slugs";

import { PRIVATE_NO_STORE_HEADERS } from "./authenticated-read";
import { readJsonBody } from "./read-json-body";
import {
  respondAction,
  respondList,
  SKIP_DATE_FORMATTING_HEADER,
} from "./response-shapes";
import {
  requireRouteAuthentication,
  requireRoutePermission,
} from "./route-auth";
import { withErrorHandler } from "./with-error-handler";

/** One collection or Single, as the roles screen shows it. */
export interface RolesScreenEntity {
  slug: string;
  kind: "collection" | "single";
  /** The label the admin shows it by; a Single has one form only. */
  labels: { singular: string; plural?: string };
  /** The plugin that contributes it, or null for the app's own. */
  plugin: string | null;
  /** The operations whose code-defined access declares a rule. */
  declaredRules: string[];
  /**
   * For a collection, whether it is closed to super-admin and where that is
   * set; absent for a Single, which cannot be closed.
   *
   * @experimental
   */
  closedToSuperAdmin?: ClosedToSuperAdminMark;
}

/**
 * The plugin each contributed slug belongs to, by kind.
 *
 * Membership is the plugins' own contribution lists, read through
 * `collectPluginContributedSlugs`, which resolves each to the slug that lands
 * in the config, renames included; it is asked one plugin at a time so each
 * slug keeps its plugin's name. `admin.group` is not read: it is a display
 * label a plugin may leave out or share.
 */
function pluginsBySlug(kind: "collections" | "singles"): Map<string, string> {
  const owners = new Map<string, string>();
  // The plugins the runtime booted with, which an app whose route was created
  // without a config still has.
  for (const plugin of bootedPlugins()) {
    for (const slug of collectPluginContributedSlugs([plugin], kind)) {
      if (!owners.has(slug)) owners.set(slug, plugin.name);
    }
  }
  return owners;
}

export const getRolesScreen = withErrorHandler(async (req: Request) => {
  // The screen edits roles, so it asks what reading the roles list asks.
  await requireRoutePermission(req, "read", "roles");
  await getCachedNextly();

  // A registry that cannot be read refuses the request rather than leaving
  // its entities unlisted, read as having no access to set.
  const [collections, singles] = await Promise.all([
    getService("collectionRegistryService").getAllLabels(),
    getService("singleRegistryService").getAllLabels(),
  ]);
  const kinds = contentKinds(
    collections.map(collection => collection.slug),
    singles.map(single => single.slug)
  );
  const pluginCollections = pluginsBySlug("collections");
  const pluginSingles = pluginsBySlug("singles");
  const rules = getRBACService();

  /** The operations whose code declares a rule for `slug`. */
  const declaredRulesOf = (
    slug: string,
    operations: readonly (typeof COLLECTION_ACTIONS)[number][]
  ): string[] => {
    const target = rules?.getRegisteredTarget(slug);
    return target
      ? operations.filter(operation => declaresRule(target, operation))
      : [];
  };

  // The marks set in the admin as they stand, not as last read here.
  await refreshStoredClosedMarks();
  const items: RolesScreenEntity[] = [];
  for (const { slug, labels } of collections) {
    if (kinds.get(slug) !== "collection") continue;
    items.push({
      slug,
      kind: "collection",
      labels,
      plugin: pluginCollections.get(slug) ?? null,
      declaredRules: declaredRulesOf(slug, COLLECTION_ACTIONS),
      closedToSuperAdmin: closedMarkOf(slug),
    });
  }
  for (const { slug, label } of singles) {
    // A slug a collection also holds is that collection's.
    if (kinds.get(slug) !== "single") continue;
    items.push({
      slug,
      kind: "single",
      labels: { singular: label },
      plugin: pluginSingles.get(slug) ?? null,
      declaredRules: declaredRulesOf(slug, SINGLE_ACTIONS),
    });
  }
  items.sort((a, b) => a.slug.localeCompare(b.slug));

  return respondList(
    items,
    {
      total: items.length,
      page: 1,
      limit: items.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    },
    {
      // Labels are configuration, not stored dates: one that happens to read
      // as a timestamp is shown as registered, not rewritten into a timezone.
      headers: {
        ...PRIVATE_NO_STORE_HEADERS,
        [SKIP_DATE_FORMATTING_HEADER]: "1",
      },
    }
  );
});

/** How many changes of the mark one account may try in a window. */
const PASSWORD_TRIES_PER_WINDOW = 10;

/** The window those tries are counted in: 15 minutes. */
const PASSWORD_TRIES_WINDOW_MS = 15 * 60 * 1000;

/** What a change of a collection's closed-to-super-admin mark sends. */
const closedMarkChange = z.strictObject({
  collection: z.string().min(1),
  closed: z.boolean(),
  /** The super-admin's own password, entered again for this change. */
  password: z.string().min(1),
});

/**
 * `PATCH /roles/screen/closed-to-super-admin`: closes a collection to
 * super-admin, or opens it to them again.
 *
 * Only a super-admin, signed in with a session, may: a key cannot enter a
 * password. The request must come from the site's own origin, and the
 * super-admin's password is asked again and checked before anything changes,
 * so a session left open, or a stolen session cookie, cannot remove the mark.
 * A collection whose code sets the mark is refused: the code decides it. The
 * change and the stored marks are written in one transaction, then the audit
 * log records who changed it, when, the collection, and its value before and
 * after. A change to what it already is writes nothing.
 *
 * @experimental
 */
export const setClosedToSuperAdmin = withErrorHandler(async (req: Request) => {
  const caller = await requireRouteAuthentication(req);
  if (caller.authMethod !== "session") {
    throw NextlyError.personOnly({
      doing: "close a collection to super-admin",
      logContext: { authMethod: caller.authMethod },
    });
  }
  if (!validateOrigin(req, env.NEXTLY_ALLOWED_ORIGINS_PARSED ?? [])) {
    throw NextlyError.csrfFailed({
      logContext: { reason: "closed-to-super-admin-cross-site" },
    });
  }
  if (!(await isSuperAdmin(caller.userId))) {
    throw NextlyError.forbidden({
      logContext: { reason: "closed-to-super-admin-not-super-admin" },
    });
  }
  const parsed = closedMarkChange.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: parsed.error.issues.map(issue => ({
        path: issue.path.join("."),
        code: "INVALID",
        message: `${issue.message}.`,
      })),
    });
  }
  const { collection, closed, password } = parsed.data;
  await getCachedNextly();

  const collections = await getService(
    "collectionRegistryService"
  ).getAllLabels();
  if (!collections.some(entry => entry.slug === collection)) {
    throw NextlyError.notFound({ logContext: { collection } });
  }
  await refreshStoredClosedMarks();
  if (closedMarkOf(collection).setIn === "code") {
    throw NextlyError.conflict({
      reason: "state",
      message:
        "This collection's code says whether it is closed to super-admin, so it can't be changed here.",
      logContext: { collection },
    });
  }
  // A session holder cannot guess the password here: each account gets a
  // few tries a window, counted where core's sign-in limits are counted, so
  // every instance shares them.
  const { authRateLimit } = buildAuthRouterDeps(
    getService as (name: string) => unknown
  );
  const attempt = await authRateLimiter(countsOf(authRateLimit)).check(
    `closed-to-super-admin:${caller.userId}`,
    PASSWORD_TRIES_PER_WINDOW,
    PASSWORD_TRIES_WINDOW_MS
  );
  if (!attempt.allowed) {
    throw NextlyError.rateLimited({
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((attempt.resetAt.getTime() - Date.now()) / 1000)
      ),
      logContext: { reason: "closed-to-super-admin-password-tries" },
    });
  }
  // The password before anything is read for the change, and before
  // anything is written.
  await getService("authService").confirmPassword(caller.userId, password);

  const adapter = getService("adapter");
  const meta = getService("metaService");
  let before = false;
  // A read cached before a close must not be served after it, a super-admin's
  // included, and a cached read is not keyed by the mark: so a change expires
  // every cached content read, as a change of grants does. The expiry is
  // queued before the write (`changingRoleGrants`), so it is owed even if
  // this process stops right after the commit; withdrawn where nothing
  // changed.
  await changingRoleGrants(async () => {
    await adapter.transaction(async tx => {
      before = await writeStoredClosedMark(
        meta,
        tx.getDrizzle(),
        collection,
        closed
      );
    });
    noteStoredClosedMark(collection, closed);
    if (before !== closed) await expireContentAfterGrantsChange();
  });
  if (before !== closed) {
    await buildAuditLogWriter(getService as (name: string) => unknown).write({
      kind: "collection-super-admin-access-changed",
      actorUserId: caller.userId,
      userAgent: req.headers.get("user-agent"),
      metadata: {
        collection,
        before: before ? "closed" : "open",
        after: closed ? "closed" : "open",
        source: "admin",
      },
    });
  }
  return respondAction(
    closed
      ? "The collection is closed to super-admin."
      : "The collection is open to super-admin.",
    { item: { collection, closedToSuperAdmin: closedMarkOf(collection) } }
  );
});
