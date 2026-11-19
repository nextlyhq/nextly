/**
 * Auth / RBAC domain DI registrations.
 *
 * Registers the auth services used across the platform:
 * - PermissionSeedService — auto-generates CRUD permissions for
 *   collections and singles on create/update. Wired into several
 *   other services via `setPermissionSeedService()`.
 * - RBACAccessControlService — unified evaluator that merges
 *   code-defined access functions with DB role/permission checks.
 *   Stateless; receives collection/single access registrations later
 *   in the orchestrator.
 * - ApiKeyService — full API key lifecycle, authentication, and
 *   permission resolution.
 * - AuthService — user registration, password reset / change, email
 *   verification. Consumed by the auth route handlers via deps-bridge.ts.
 */

import { linkingPolicyFromAuthConfig } from "../../domains/auth/linking-policy";
import { ApiKeyService } from "../../domains/auth/services/api-key-service";
import { AuthService } from "../../domains/auth/services/auth-service";
import { IdentityService } from "../../domains/auth/services/identity-service";
import { PermissionSeedService } from "../../domains/auth/services/permission-seed-service";
import { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import type { EmailService } from "../../services/email/email-service";
import { ServiceContainer } from "../../services/index";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerAuthServices(ctx: RegistrationContext): void {
  const { adapter, logger } = ctx;

  // PermissionSeedService — auto-generates CRUD permissions for
  // collections and singles.
  container.registerSingleton<PermissionSeedService>(
    "permissionSeedService",
    () => new PermissionSeedService(adapter, logger)
  );

  // RBACAccessControlService — stateless unified access control.
  // Merges code-defined access functions with DB role/permission checks.
  // Collection/single access registration happens later in the orchestrator
  // after the config is fully known.
  container.registerSingleton<RBACAccessControlService>(
    "rbacAccessControlService",
    () => new RBACAccessControlService()
  );

  // ApiKeyService — API key lifecycle, authentication, permission cache.
  container.registerSingleton<ApiKeyService>(
    "apiKeyService",
    () => new ApiKeyService(adapter, logger)
  );

  // IdentityService — core's own external identities: the listing and the
  // unlink of what one account holds. The app's auth configuration has no
  // provider keys to read yet, so the policy is the one a configuration
  // naming none resolves to: no key is enabled, and an unlink counts no
  // identity as a way in — a password-less account keeps its last one.
  // The provisioning branch's role lookup and account creation are the
  // service container's own role and users services, the ones the rest of
  // the app's writes go through.
  container.registerSingleton<IdentityService>("identityService", () => {
    const services = new ServiceContainer(adapter);
    return new IdentityService(adapter, logger, {
      linkingPolicy: linkingPolicyFromAuthConfig(undefined),
      roles: services.roles,
      users: services.users,
    });
  });

  // AuthService — user registration, password reset/change, email
  // verification. Email service is looked up lazily so we tolerate
  // boot orders where email registration has not completed yet.
  container.registerSingleton<AuthService>("authService", () => {
    const emailService = container.has("emailService")
      ? container.get<EmailService>("emailService")
      : undefined;
    return new AuthService(adapter, logger, emailService);
  });
}
