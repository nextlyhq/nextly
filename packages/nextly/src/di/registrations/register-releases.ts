/**
 * The content-releases service, and the two permission questions it asks.
 *
 * The releases domain has had a repository, a materialisation pass and a
 * registered drain since #1323, and no way for anything outside the server
 * process to reach them. Registering the service is what turns the three seeded
 * permissions from a vocabulary the admin displays into checks the server runs.
 *
 * Both checks are injected rather than imported by the domain. The domain owns
 * WHICH authority each operation requires; where the answer comes from is a
 * wiring decision, and keeping it here is what lets the boundary be tested
 * exhaustively without a permission store — the cases worth covering are the
 * refusals, and a refusal test that needs RBAC seeded tends not to be written.
 *
 * @module di/registrations/register-releases
 */

import { apiKeyWriteAllowed } from "../../auth/authenticated-scope";
import { runDetachedFromRequest } from "../../auth/caller-scope";
import { nextly } from "../../direct-api/nextly";
import type { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import {
  linkFieldKeysVisibleTo,
  releaseLinkReads,
} from "../../domains/collections/release-links";
import type { JobRegistry } from "../../domains/jobs/job-registry";
import { runSweepNow } from "../../domains/jobs/jobs-runner";
import { registerNoticeKind } from "../../domains/notices/notice-kinds";
import { registerCoreReleaseCheckSources } from "../../domains/releases/readiness/core-sources";
import { recordReleaseActivity } from "../../domains/releases/release-activity";
import { RELEASE_STOPPED_NOTICE } from "../../domains/releases/release-stopped-notice";
import type { ReleaseTargetCaller } from "../../domains/releases/release-targets";
import { RELEASES_DRAIN_JOB } from "../../domains/releases/releases-drain-job";
import { ReleasesRepository } from "../../domains/releases/releases-repository";
import {
  RELEASES_RESOURCE,
  ReleasesService,
  scopeKeyOf,
} from "../../domains/releases/services/releases-service";
import type { SingleRegistryService } from "../../domains/singles/services/single-registry-service";
import { NextlyError } from "../../errors";
import type { CacheRevalidator } from "../../revalidation/types";
import type { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import {
  resolveDocumentVisibilityScope,
  visibleDocuments,
} from "../../services/lib/document-visibility";
import { hasPermission } from "../../services/lib/permissions";
import { container } from "../container";

import {
  releaseDocumentChecks,
  singleRowExists,
} from "./release-document-checks";
import type { RegistrationContext } from "./types";

export function registerReleaseServices({
  adapter,
  logger,
}: RegistrationContext): void {
  // Core's checks, which every release's readiness, scheduling and Publish now
  // ask. Registered with the feature, so a boot that has releases has them.
  registerCoreReleaseCheckSources();
  // The notice a stopped release's owner is given, which the one transition
  // into `blocked` records: registered with the feature, so no boot can stop
  // a release without being able to tell its owner.
  registerNoticeKind(RELEASE_STOPPED_NOTICE);

  container.registerSingleton<ReleasesService>(
    "releasesService",
    () =>
      new ReleasesService({
        // WITH the registered revalidator. Without it, scheduling clears only
        // the in-process transition memo and never flushes the affected
        // document tags — so a page rendered before the release was scheduled
        // stays cached with no transition bound and keeps serving pre-release
        // content past the instant. The repository takes it optionally, which is
        // exactly why omitting it here would have been silent.
        repository: new ReleasesRepository(
          adapter,
          container.has("cacheRevalidator")
            ? container.get<CacheRevalidator>("cacheRevalidator")
            : undefined,
          // The opt-out and extra tags a release's flush must honour: each
          // registry's slugs and `revalidate` settings, one query apiece,
          // resolved per call for the reason the targets below are.
          async () => {
            const [collections, singles] = await Promise.all([
              container.has("collectionRegistryService")
                ? container
                    .get<CollectionRegistryService>("collectionRegistryService")
                    .getAllRevalidateConfigs()
                : [],
              container.has("singleRegistryService")
                ? container
                    .get<SingleRegistryService>("singleRegistryService")
                    .getAllRevalidateConfigs()
                : [],
            ]);
            return { collections, singles };
          }
        ),

        // The system resource, whose three authorities are seeded by
        // `permission-seed-service`. `hasPermission` fails CLOSED — it returns
        // false on any error rather than throwing — which is the behaviour a
        // gate wants: an unreachable permission store must not read as consent.
        // What a document must be to join a release, asked of the content API
        // and the schema registries. Resolved lazily, per call, for the
        // reason the document check below is: the services it reads are
        // registered elsewhere, and resolving them here would make this depend
        // on registration order.
        targets: {
          readDocument: (target, caller) =>
            // A read the caller is refused answers like a document that is
            // not there: the two are one answer, or an add would tell a
            // caller which ids exist where it may not look.
            nullWhenRefused(async () => {
              // A Single's ordinary read CREATES its row when there is none,
              // so it can never answer "not there" and would leave a blank
              // row behind a refused add. Its row is looked for first, by a
              // read that writes nothing.
              if (
                target.scopeKind === "single" &&
                !(await singleRowExists(adapter, target.scopeSlug, logger))
              ) {
                return null;
              }
              // `status: "all"`: a release most often publishes a DRAFT, and a
              // read that defaulted to published would refuse exactly the
              // document the release exists for.
              const access = contentReadAccess(caller);
              const found =
                target.scopeKind === "single"
                  ? await nextly.findSingle({
                      slug: target.scopeSlug as never,
                      status: "all",
                      ...access,
                    } as never)
                  : await nextly.findByID({
                      collection: target.scopeSlug as never,
                      id: target.entryId,
                      status: "all",
                      ...access,
                    } as never);
              return found ?? null;
            }),
          declaresLifecycle: async (scopeKind, scopeSlug) => {
            const key =
              scopeKind === "single"
                ? "singleRegistryService"
                : "collectionRegistryService";
            if (!container.has(key)) return false;
            const registry = container.get<{
              getCollectionBySlug?: (
                slug: string
              ) => Promise<{ status?: boolean } | null>;
              getSingleBySlug?: (
                slug: string
              ) => Promise<{ status?: boolean } | null>;
            }>(key);
            const record = await (scopeKind === "single"
              ? registry.getSingleBySlug?.(scopeSlug)
              : registry.getCollectionBySlug?.(scopeSlug));
            return record?.status === true;
          },
        },

        canManageReleases: (userId, authority) =>
          hasPermission(userId, authority, RELEASES_RESOURCE),

        // Publish now runs the runner's OWN releases drain job, through the
        // jobs runner and under its claim, rather than a pass of its own: two
        // runs of the engine on a shared document can only be kept apart by
        // one claim. The job reports its own outcome (`register-jobs`), so a
        // document that could not be written now is logged exactly as a
        // scheduled run logs it.
        //
        // The registry is resolved HERE, once, while this registration's
        // factory builds the service, rather than on each Publish now.
        // Services can be cleared and registered again while a Publish now
        // from this registration is still running; resolving per call would
        // then pair this adapter with the next registration's registry, whose
        // drain writes through another adapter. It cannot cycle: building the
        // job registry resolves the document-lock and webhook services, never
        // this one.
        runDrainNow: drainNowWith(
          adapter,
          container.has("jobRegistry")
            ? container.get<JobRegistry>("jobRegistry")
            : undefined
        ),
        // Publish now answers a drain it could not start with the release as
        // it stands; this is where that failure is reported.
        logger,

        // What the readiness checks ask of a member's document and author,
        // answered as the release's run would answer it.
        checks: releaseDocumentChecks(adapter, logger),

        // The display names of the collections and Singles a reader's hidden
        // documents are in, read from the registries as the admin reads them.
        // A collection no longer registered is left out, and its count keeps
        // the slug alone.
        scopeLabels: async scopes => {
          const labels = new Map<
            string,
            { singular: string; plural: string }
          >();
          const distinct = new Map(
            scopes.map(scope => [scopeKeyOf(scope), scope])
          );
          await Promise.all(
            [...distinct].map(async ([key, scope]) => {
              const named = await scopeLabelsOf(
                scope.scopeKind,
                scope.scopeSlug
              );
              if (named) labels.set(key, named);
            })
          );
          return labels;
        },

        // Which members' documents a reader may read: the list views' own
        // question (`visibleDocuments`), batched for the whole set. The
        // registry and the configured languages are resolved per call, as the
        // list views resolve them per query, so a collection registered or
        // removed since boot is judged as it is now.
        readableMembers: async (members, actor) => {
          // Release reads refuse an anonymous caller before they get here; one
          // that arrives anyway may read none of them.
          if (actor.userId === null) return new Set<string>();
          const caller: ReadCaller = {
            user: {
              id: actor.userId,
              ...(actor.userRoles ? { roles: actor.userRoles } : {}),
            },
            ...(actor.authenticatedScope
              ? { authenticatedScope: actor.authenticatedScope }
              : {}),
          };
          const readable = await visibleDocuments(
            members,
            member =>
              member.scopeKind === "collection" || member.scopeKind === "single"
                ? {
                    kind: member.scopeKind,
                    slug: member.scopeSlug,
                    entryId: member.entryId,
                    locale: member.locale,
                  }
                : null,
            caller,
            await resolveDocumentVisibilityScope()
          );
          return new Set(readable.map(member => member.id));
        },

        // Renames and deletions go to the activity log through the settings
        // seam, which resolves the log from the container per call, so this
        // depends on no registration order.
        recordActivity: recordReleaseActivity,

        // What the link check reads of content, held by this service so a
        // call reads through the registration that built it. Soft, so
        // scheduling, Publish now and the drain never ask it.
        linkReads: releaseLinkReads(adapter),

        // Which link fields of each scanned document a reader may view:
        // the document the links were read from, with the field read rules,
        // its own and its components', applied for the reader by the read
        // path's own judges.
        visibleLinkFields: async (scans, actor) => {
          const none = new Map<string, ReadonlySet<string>>();
          if (actor.userId === null) return none;
          // The reader whole, as a read's field rules see them: a rule may
          // ask more of the person than an id. Nobody to read as, such as a
          // deactivated user, is shown no field.
          const user = await releaseDocumentChecks(adapter, logger).actingAs(
            actor.userId
          );
          if (user === null) return none;
          const caller = {
            user: {
              ...user,
              ...(actor.userRoles ? { roles: actor.userRoles } : {}),
            } as Record<string, unknown>,
            ...(actor.authenticatedScope
              ? { authenticatedScope: actor.authenticatedScope }
              : {}),
          };
          return linkFieldKeysVisibleTo(scans, caller);
        },

        // The document's OWN authority, asked with the same operation the
        // ordinary write path uses. Adding a document to a release is a deferred
        // publish of it, so this is the check that stops a release from becoming
        // a way to perform a write the caller could not perform now.
        //
        // Resolved lazily, per call. The RBAC service is registered by
        // `register-auth`, and resolving at registration time would make this
        // depend on an ordering between two registrations rather than on the
        // container — the first reordering would break it silently.
        canActOnDocument: async ({
          userId,
          scopeSlug,
          action,
          authenticatedScope,
          userRoles,
        }) => {
          if (!container.has("rbacAccessControlService")) {
            // No permission store means no basis for saying yes. A minimal boot
            // without RBAC can still construct this service; it simply cannot
            // authorize anyone into a release.
            return false;
          }
          const rbac = container.get<RBACAccessControlService>(
            "rbacAccessControlService"
          );

          // TWO questions, because two different principals are involved.
          //
          // The AUTHOR is who performs the write later. `createJobContentApi`
          // strips `actor` from every bound call, so the key's scope is GONE at
          // materialisation and the recorded author's own grants are the only
          // thing that can authorize it. A member admitted on a key's authority
          // alone is one the drain will refuse forever, leaving the release
          // scheduled with content that never appears.
          //
          // The run writes the status alone, a publish or an unpublish judged
          // by that action's own grant and rule, not update's: the release
          // admits exactly the author the run's write would.
          const authorMay = await rbac.checkAccess({
            userId,
            operation: action,
            resource: scopeSlug,
          });
          if (!authorMay) return false;

          // And a scoped API key must hold the grants ITSELF, or a narrow key
          // borrows the owner's authority to schedule a write it was never
          // given. `null` means the caller is not a key, and the author check
          // above is then the whole answer.
          const asUser = { id: userId, roles: userRoles };
          const keyMayAct = await apiKeyWriteAllowed(
            authenticatedScope,
            action,
            scopeSlug,
            asUser,
            rbac
          );
          return keyMayAct ?? true;
        },
      })
  );
}

/**
 * The content API's access fields for reading a release target as its caller.
 *
 * A trusted caller reads unchecked; anyone else reads as themselves, whole: a
 * scoped key travels as `actor`, so it is judged by its own grants rather than
 * its owner's, and the role set travels on the user, so a rule that reads
 * roles sees the caller's rather than none.
 */
export function contentReadAccess(
  caller: ReleaseTargetCaller
): Record<string, unknown> {
  if (caller.trusted) return { overrideAccess: true };
  return {
    overrideAccess: false,
    ...(caller.userId === null
      ? {}
      : {
          user: {
            id: caller.userId,
            ...(caller.userRoles ? { roles: caller.userRoles } : {}),
          },
        }),
    // Always stated, `undefined` included: left out, the content API fills
    // `actor` from the instance's defaults, and a caller with no key of its
    // own would be judged by a default key's grants.
    actor: caller.authenticatedScope,
  };
}

/**
 * Publish now's drain run, bound to one registration's adapter and registry.
 *
 * A boot that registered no job registry has nothing to run the drain with,
 * so nothing runs and the release is left scheduled: it is due, and whatever
 * runs this installation's releases sends it out on its next pass.
 */
export function drainNowWith(
  adapter: RegistrationContext["adapter"],
  registry: JobRegistry | undefined
): (options: { maxDurationMs: number }) => Promise<unknown> {
  return async ({ maxDurationMs }) => {
    if (registry === undefined) return;
    // Outside the request's caller scope. The drain writes each document as
    // the member's author, and the access gate reads a pinned scope when a
    // write names none: left in place, an API key that asked for Publish now
    // would be judged in each author's stead, refusing a document its author
    // may publish or admitting one they may not. A scheduled pass runs on
    // nobody's request, and Publish now's run must be judged the same way.
    await runDetachedFromRequest(() =>
      runSweepNow(adapter, registry, RELEASES_DRAIN_JOB, { maxDurationMs })
    );
  };
}

/** A read, with a refusal or an absence both answered as `null`. */
async function nullWhenRefused<T>(
  read: () => Promise<T | null>
): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (
      NextlyError.is(error) &&
      (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * A collection's or Single's display names, from its registry: a
 * collection's own singular and plural, a Single's one label as both. `null`
 * when it is not registered, or its registry is not.
 */
function scopeLabelsOf(
  scopeKind: string,
  scopeSlug: string
): Promise<{ singular: string; plural: string } | null> {
  return scopeKind === "single"
    ? singleLabels(scopeSlug)
    : collectionLabels(scopeSlug);
}

/** A Single's one label, as both its singular and its plural. */
async function singleLabels(
  slug: string
): Promise<{ singular: string; plural: string } | null> {
  if (!container.has("singleRegistryService")) return null;
  const single = await container
    .get<{
      getSingleBySlug: (slug: string) => Promise<{ label?: string } | null>;
    }>("singleRegistryService")
    .getSingleBySlug(slug);
  return single?.label
    ? { singular: single.label, plural: single.label }
    : null;
}

/** A collection's own singular and plural. */
async function collectionLabels(
  slug: string
): Promise<{ singular: string; plural: string } | null> {
  if (!container.has("collectionRegistryService")) return null;
  const collection = await container
    .get<{
      getCollectionBySlug: (
        slug: string
      ) => Promise<{ labels?: { singular?: string; plural?: string } } | null>;
    }>("collectionRegistryService")
    .getCollectionBySlug(slug);
  const { singular, plural } = collection?.labels ?? {};
  return singular && plural ? { singular, plural } : null;
}
