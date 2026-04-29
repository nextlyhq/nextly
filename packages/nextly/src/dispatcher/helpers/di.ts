/**
 * Safe DI-container accessors for the dispatcher.
 *
 * The dispatcher sometimes runs before `registerServices()` has been
 * called (e.g. in early request paths or during tests). Every getter
 * swallows the "not initialized" error and returns `undefined`, which
 * lets individual handlers decide whether a missing service is fatal.
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { container } from "../../di/container";
import type { NextlyServiceConfig } from "../../di/register";
import type { SingleEntryService } from "../../domains/singles/services/single-entry-service";
import type { SingleRegistryService } from "../../domains/singles/services/single-registry-service";
import type { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import type { CollectionsHandler } from "../../services/collections-handler";
import type { ComponentRegistryService } from "../../services/components/component-registry-service";
import type { EmailProviderService } from "../../services/email/email-provider-service";
import type { EmailTemplateService } from "../../services/email/email-template-service";
import type { UserExtSchemaService } from "../../services/users/user-ext-schema-service";
import type { UserFieldDefinitionService } from "../../services/users/user-field-definition-service";

export function getAdapterFromDI(): DrizzleAdapter | undefined {
  try {
    if (container.has("adapter")) {
      return container.get<DrizzleAdapter>("adapter");
    }
  } catch {
    // DI not initialized
  }
  return undefined;
}

export function getCollectionsHandlerFromDI(): CollectionsHandler | undefined {
  try {
    if (container.has("collectionsHandler")) {
      return container.get<CollectionsHandler>("collectionsHandler");
    }
  } catch {
    // DI not initialized
  }
  return undefined;
}

export function getSingleRegistryFromDI(): SingleRegistryService | undefined {
  try {
    if (container.has("singleRegistryService")) {
      return container.get<SingleRegistryService>("singleRegistryService");
    }
  } catch {
    // DI not initialized
  }
  return undefined;
}

export function getSingleEntryServiceFromDI(): SingleEntryService | undefined {
  try {
    if (container.has("singleEntryService")) {
      return container.get<SingleEntryService>("singleEntryService");
    }
  } catch {
    // DI not initialized
  }
  return undefined;
}

export function getComponentRegistryFromDI():
  | ComponentRegistryService
  | undefined {
  try {
    if (container.has("componentRegistryService")) {
      return container.get<ComponentRegistryService>(
        "componentRegistryService"
      );
    }
  } catch {
    // DI not initialized
  }
  return undefined;
}

export function getConfigFromDI(): NextlyServiceConfig | undefined {
  try {
    if (container.has("config")) {
      return container.get<NextlyServiceConfig>("config");
    }
  } catch {
    // DI not initialized
  }
  return undefined;
}

export function getEmailProviderServiceFromDI():
  | EmailProviderService
  | undefined {
  try {
    if (container.has("emailProviderService")) {
      return container.get<EmailProviderService>("emailProviderService");
    }
  } catch {
    // DI not initialized
  }
  return undefined;
}

export function getEmailTemplateServiceFromDI():
  | EmailTemplateService
  | undefined {
  try {
    if (container.has("emailTemplateService")) {
      return container.get<EmailTemplateService>("emailTemplateService");
    }
  } catch {
    // DI not initialized
  }
  return undefined;
}

export function getUserFieldDefinitionServiceFromDI():
  | UserFieldDefinitionService
  | undefined {
  try {
    if (container.has("userFieldDefinitionService")) {
      return container.get<UserFieldDefinitionService>(
        "userFieldDefinitionService"
      );
    }
  } catch {
    // DI not initialized
  }
  return undefined;
}

export function getUserExtSchemaServiceFromDI():
  | UserExtSchemaService
  | undefined {
  try {
    if (container.has("userExtSchemaService")) {
      return container.get<UserExtSchemaService>("userExtSchemaService");
    }
  } catch {
    // DI not initialized
  }
  return undefined;
}

// F8 PR 3 deleted `getSchemaChangeServiceFromDI`. The legacy preview
// path now goes through `pipeline/preview.ts` + `legacy-preview/translate.ts`
// (no DI lookup needed). The legacy `SchemaChangeService` class itself is
// deleted in PR 4.

export function getCollectionRegistryFromDI():
  | CollectionRegistryService
  | undefined {
  try {
    if (container.has("collectionRegistryService")) {
      return container.get<CollectionRegistryService>(
        "collectionRegistryService"
      );
    }
  } catch {
    // DI not initialized
  }
  return undefined;
}
