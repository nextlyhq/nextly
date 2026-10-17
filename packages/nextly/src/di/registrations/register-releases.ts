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
import { nextly } from "../../direct-api/nextly";
import type { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import type { JobRegistry } from "../../domains/jobs/job-registry";
import { runSweepNow } from "../../domains/jobs/jobs-runner";
import type { ReleaseTargetCaller } from "../../domains/releases/release-targets";
import { RELEASES_DRAIN_JOB } from "../../domains/releases/releases-drain-job";
import { ReleasesRepository } from "../../domains/releases/releases-repository";
import {
  RELEASES_RESOURCE,
  ReleasesService,
} from "../../domains/releases/services/releases-service";
import { resolveSingleForRequest } from "../../domains/singles/services/ensure-runtime-table";
import { NextlyError } from "../../errors";
import type { CacheRevalidator } from "../../revalidation/types";
import type { DynamicSingleRecord } from "../../schemas/dynamic-singles/types";
import { hasPermission } from "../../services/lib/permissions";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerReleaseServices({
  adapter,
  logger,
}: RegistrationContext): void {
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
            : undefined
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
          // An ordinary lifecycle write needs the base `update` grant as well as
          // the lifecycle verb, so both are asked. Checking only `publish` would
          // admit a caller who may publish but may not write the document.
          const authorMay =
            (await rbac.checkAccess({
              userId,
              operation: "update",
              resource: scopeSlug,
            })) &&
            (await rbac.checkAccess({
              userId,
              operation: action,
              resource: scopeSlug,
            }));
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
          if (keyMayAct === null) return true;
          const keyMayUpdate = await apiKeyWriteAllowed(
            authenticatedScope,
            "update",
            scopeSlug,
            asUser,
            rbac
          );
          return keyMayAct && keyMayUpdate === true;
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
function drainNowWith(
  adapter: RegistrationContext["adapter"],
  registry: JobRegistry | undefined
): (options: { maxDurationMs: number }) => Promise<unknown> {
  return async ({ maxDurationMs }) => {
    if (registry === undefined) return;
    await runSweepNow(adapter, registry, RELEASES_DRAIN_JOB, { maxDurationMs });
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
 * Whether a Single has its stored row, asked of its table directly: a read
 * that cannot create the row the way the Single's content read does. `false`
 * for a Single that is not registered or whose table is not there yet.
 */
async function singleRowExists(
  adapter: RegistrationContext["adapter"],
  slug: string,
  logger: RegistrationContext["logger"]
): Promise<boolean> {
  if (!container.has("singleRegistryService")) return false;
  // Resolved the way every request-scoped Single read opens: the registry row,
  // and its runtime table registered in THIS process. A worker that booted
  // before a UI-defined Single existed has the table in the database but not
  // in its schema registry, and a query there would fail rather than answer.
  // The logger carries the reason when that registration cannot be made.
  const single = await resolveSingleForRequest(
    adapter,
    container.get<{
      getSingleBySlug(slug: string): Promise<DynamicSingleRecord | null>;
    }>("singleRegistryService"),
    slug,
    logger
  );
  const table = single?.tableName;
  if (table === undefined || !(await adapter.tableExists(table))) return false;
  const rows = await adapter.select<{ id: string }>(table, {
    columns: ["id"],
    limit: 1,
  });
  return rows.length > 0;
}
