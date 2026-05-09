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
 *
 * `AccessControlService` is created inline inside the `CollectionService`
 * factory because it only exists as a dependency of that one consumer.
 */

import { AuthService } from "../../domains/auth/services/auth-service";
import { ApiKeyService } from "../../services/auth/api-key-service";
import { PermissionSeedService } from "../../services/auth/permission-seed-service";
import { RBACAccessControlService } from "../../services/auth/rbac-access-control-service";
import type { EmailService } from "../../services/email/email-service";
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
