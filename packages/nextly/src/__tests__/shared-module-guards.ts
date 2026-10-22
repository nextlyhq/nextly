/**
 * What a unit file must take down before the next file in its worker starts.
 *
 * Loaded only by the unit project that shares a worker's modules across files
 * (`vitest.config.ts`). There a module-level value one file leaves set is the
 * next file's starting state: an extension schema left active makes
 * `previewDesiredSchema` plan tables the next file never declared. Isolated
 * files start from fresh modules, so they need no check.
 *
 * Each check runs after the file's own hooks, takes the value down so the
 * files after it start clean, and fails the file that left it, rather than
 * whichever file happens to run next.
 *
 * @module __tests__/shared-module-guards
 */
import { afterAll, expect } from "vitest";

import {
  activeExtensionSchema,
  clearActiveExtensionSchema,
} from "../domains/schema/extension/active-schema";

afterAll(() => {
  if (activeExtensionSchema() === null) return;
  clearActiveExtensionSchema();
  expect.fail(
    "This file left an extension schema active. Clear it after the tests that set it (`clearActiveExtensionSchema`)."
  );
});
