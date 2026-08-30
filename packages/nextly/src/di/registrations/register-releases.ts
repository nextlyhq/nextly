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
