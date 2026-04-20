/**
 * Direct API Namespace Context
 *
 * Defines the `NextlyContext` interface consumed by every namespace factory
 * under `./namespaces/`. The `Nextly` core class implements this interface
 * (with `@internal` accessors) so each namespace module can reach the services
 * and default config it needs without holding a reference to the concrete
 * class.
 *
 * Every member is marked `@internal`: these are implementation details of the
 * Direct API, not public API. Namespace modules are the only intended
 * consumers.
 *
 * @packageDocumentation
 */

import type { ApiKeyService } from "../../services/auth/api-key-service";
import type { AuthService } from "../../services/auth/auth-service";
import type { PermissionService } from "../../services/auth/permission-service";
import type { RBACAccessControlService } from "../../services/auth/rbac-access-control-service";
import type { RolePermissionService } from "../../services/auth/role-permission-service";
import type { RoleService } from "../../services/auth/role-service";
import type { CollectionsHandler } from "../../services/collections-handler";
import type { ComponentRegistryService } from "../../services/components/component-registry-service";
import type { EmailProviderService } from "../../services/email/email-provider-service";
import type { EmailService } from "../../services/email/email-service";
import type { EmailTemplateService } from "../../services/email/email-template-service";
import type { MediaService } from "../../services/media/media-service";
import type { SingleEntryService } from "../../services/singles/single-entry-service";
import type { SingleRegistryService } from "../../services/singles/single-registry-service";
import type { UserAccountService } from "../../services/users/user-account-service";
import type { UserFieldDefinitionService } from "../../services/users/user-field-definition-service";
import type { UserService } from "../../services/users/user-service";
import type { DirectAPIConfig } from "../types/index";

/**
 * Services and config exposed to namespace modules by the `Nextly` core class.
 *
 * @internal
 */
export interface NextlyContext {
  /** @internal */ readonly defaultConfig: DirectAPIConfig;
  /** @internal */ readonly formsCollectionSlug: string;
  /** @internal */ readonly submissionsCollectionSlug: string;

  /** @internal */ readonly collectionsHandler: CollectionsHandler;
  /** @internal */ readonly singleEntryService: SingleEntryService;
  /** @internal */ readonly singleRegistryService: SingleRegistryService;
  /** @internal */ readonly authService: AuthService;
  /** @internal */ readonly userAccountService: UserAccountService;
  /** @internal */ readonly userService: UserService;
  /** @internal */ readonly mediaService: MediaService;
  /** @internal */ readonly componentRegistryService: ComponentRegistryService;
  /** @internal */ readonly emailProviderService: EmailProviderService;
  /** @internal */ readonly emailTemplateService: EmailTemplateService;
  /** @internal */ readonly userFieldDefinitionService: UserFieldDefinitionService;
  /** @internal */ readonly emailSendService: EmailService;
  /** @internal */ readonly rbacRoleService: RoleService;
  /** @internal */ readonly rbacPermissionService: PermissionService;
  /** @internal */ readonly rbacRolePermissionService: RolePermissionService;
  /** @internal */ readonly rbacAccessControlService: RBACAccessControlService;
  /** @internal */ readonly apiKeyService: ApiKeyService;
}
