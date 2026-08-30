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
import type { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import { ReleasesRepository } from "../../domains/releases/releases-repository";
import {
  RELEASES_RESOURCE,
  ReleasesService,
} from "../../domains/releases/services/releases-service";
import type { CacheRevalidator } from "../../revalidation/types";
import { hasPermission } from "../../services/lib/permissions";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerReleaseServices({
  adapter,
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
        canManageReleases: (userId, authority) =>
          hasPermission(userId, authority, RELEASES_RESOURCE),

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

          // A scoped API key is judged by its OWN grants, and by the full
          // question the ordinary write path asks: the `{action}-{slug}` grant
          // AND the code-defined access rule, evaluated against the key rather
          // than its owner. Checking only the permission slug here would be a
          // partial answer that reads like a complete one — and resolving from
          // the owner at all is how a narrow key ends up scheduling a publish
          // it was never granted, materialised later as a privileged person.
          //
          // `null` means the caller is not a key, so the ordinary resolution
          // below applies.
          const byKey = await apiKeyWriteAllowed(
            authenticatedScope,
            action,
            scopeSlug,
            { id: userId, roles: userRoles },
            rbac
          );
          if (byKey !== null) return byKey;

          return rbac.checkAccess({
            userId,
            operation: action,
            resource: scopeSlug,
          });
        },
      })
  );
}
