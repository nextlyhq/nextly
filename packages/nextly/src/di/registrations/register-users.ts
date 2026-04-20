/**
 * Users domain DI registrations.
 *
 * Registers the user stack:
 * - UserFieldDefinitionService — CRUD for custom user field metadata.
 * - UserExtSchemaService — generates the `user_ext` table schema for
 *   arbitrary user field extensions. Reads merged fields (code + UI)
 *   via the UserFieldDefinitionService when available.
 * - UserService — orchestration layer over UserQueryService,
 *   UserMutationService, and UserAccountService. Optionally consumes
 *   EmailService for verification/reset flows.
 */

import { EmailService } from "../../services/email/email-service";
import { UserAccountService } from "../../services/users/user-account-service";
import { UserExtSchemaService } from "../../services/users/user-ext-schema-service";
import { UserFieldDefinitionService } from "../../services/users/user-field-definition-service";
import { UserMutationService } from "../../services/users/user-mutation-service";
import { UserQueryService } from "../../services/users/user-query-service";
import { UserService } from "../../services/users/user-service";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerUserServices(ctx: RegistrationContext): void {
  const { adapter, logger, config, passwordHasher } = ctx;

  // UserFieldDefinitionService — CRUD for custom user field metadata.
  container.registerSingleton<UserFieldDefinitionService>(
    "userFieldDefinitionService",
    () => new UserFieldDefinitionService(adapter, logger)
  );

  // UserExtSchemaService — generates user_ext table schemas.
  // Receives UserFieldDefinitionService (if registered) for merged field
  // loading so code-defined and UI-defined fields are combined.
  container.registerSingleton<UserExtSchemaService>(
    "userExtSchemaService",
    () => {
      const dialect = adapter.getCapabilities().dialect;
      const fieldDefService = container.has("userFieldDefinitionService")
        ? container.get<UserFieldDefinitionService>(
            "userFieldDefinitionService"
          )
        : undefined;
      return new UserExtSchemaService(dialect, fieldDefService);
    }
  );

  // UserService — composes query/mutation/account services.
  container.registerSingleton<UserService>("userService", () => {
    const userExtSchema = container.get<UserExtSchemaService>(
      "userExtSchemaService"
    );

    const queryService = new UserQueryService(
      adapter,
      logger,
      config.users,
      userExtSchema
    );

    const emailService = container.has("emailService")
      ? container.get<EmailService>("emailService")
      : undefined;

    const mutationService = new UserMutationService(
      adapter,
      logger,
      config.users,
      userExtSchema,
      emailService
    );

    const accountService = new UserAccountService(adapter, logger);

    return new UserService(
      queryService,
      mutationService,
      accountService,
      passwordHasher,
      logger
    );
  });
}
