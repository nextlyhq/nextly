/**
 * Auth Domain Types
 *
 * Consolidated re-exports of all auth-domain-specific types.
 * Shared access-control types (MinimalUser, CollectionAccessControl, etc.)
 * live in `src/shared/types/access.ts` — they are not repeated here.
 *
 * @module domains/auth/types
 */

export type {
  ApiKeyTokenType,
  ExpiresIn,
  GeneratedApiKey,
  ApiKeyMeta,
  CreateApiKeyInput,
  UpdateApiKeyInput,
} from "./services/api-key-service";

export type { SeedResult } from "./services/permission-seed-service";

export type {
  PermissionCondition,
  PermissionContext,
  FieldPermissionRule,
  FieldAccessResult,
} from "@nextly/types/field-permissions";

export type {
  MinimalUser,
  AccessControlContext,
  CollectionAccessControl,
  SingleAccessControl,
  CheckAccessParams,
} from "../../shared/types/access";
