/**
 * Cases for the codes `nextly migrate:create` raises itself, through the helpers it calls.
 *
 * @module cli/__tests__/error-cases/migrate-create
 */
import {
  migrationCreateCancelled,
  migrationNameRequired,
} from "../../errors/areas/migrate-create";

import type { ErrorCases } from "./types";

export const MIGRATE_CREATE_CASES = {
  MIGRATION_NAME_REQUIRED: () => migrationNameRequired(),
  MIGRATION_CREATE_CANCELLED: () => migrationCreateCancelled(),
} satisfies ErrorCases;
